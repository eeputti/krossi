// koutsi-invoice — Laskutus: an invoice as a PDF file, and e-mailed to its payer.
//
//   GET  ?pdf=<token>                          -> application/pdf    anyone with the invoice's link (sent, paid, void)
//   POST { action: 'mail', invoiceIds, to? }   -> { sent: [{ id, to }], skipped: [{ id, reason }] }
//        coach: each open invoice by e-mail, PDF attached: to the payer's e-mail when the coach wrote one
//        (a guardian, a company), else to the e-mail the player's Koutsi account was made with
//   POST { action: 'remind', invoiceId }       -> { notified, mailed, to }
//        coach: a reminder — in the app for a player with an account (koutsi_remind_invoice, once a day)
//        and by e-mail to the same address
//
// The account's e-mail is never shown to the coach: it isn't stored on the invoice (mail_to stays empty)
// nor returned (to: null). The player hears about a new invoice in the app too (koutsi_send_invoice); its
// e-mail copy in the notification queue is marked sent, so the invoice e-mail isn't followed by a second
// one about the same invoice.
//
// The PDF is the same document as the invoice page (_shared/invoicePdf.ts, pdf-lib), with the coach's
// logo when they uploaded one (public bucket koutsi-logos). Mail through Resend like koutsi-notify (the
// same secrets: RESEND_API_KEY, KOUTSI_MAIL_FROM, optional KOUTSI_MAIL_REPLY_TO, KOUTSI_APP_ORIGIN);
// Reply-To is the coach's own e-mail, so the payer answers the coach.
//
// Deploy with verify_jwt off (the PDF link has no signed-in user); the coach actions check the JWT here.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import { renderInvoicePdf } from '../_shared/invoicePdf.ts';
import { renderInvoiceEmail } from '../_shared/invoiceMail.ts';
import { UUID_RE, appBase, isAllowedOrigin, KOUTSI_APP } from '../_shared/koutsiPay.ts';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const NOT_FOUND = 'Laskua ei löytynyt.';
const NOT_COACH = 'Vain valmentaja voi tehdä tämän.';
const NO_MAILER = 'Sähköpostin lähetys ei ole juuri nyt käytössä.';
const FAILED = 'Käsittely epäonnistui. Yritä hetken päästä uudelleen.';

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'access-control-allow-origin': isAllowedOrigin(origin) ? origin : KOUTSI_APP,
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'Origin',
  };
}
const json = (req: Request, body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders(req), 'content-type': 'application/json' } },
);

class Reply extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

// deno-lint-ignore no-explicit-any
type PublicInvoice = Record<string, any>;

/** The invoice as its own page shows it (koutsi_invoice_public), or null. */
async function publicInvoice(token: string): Promise<PublicInvoice | null> {
  const { data, error } = await admin.rpc('koutsi_invoice_public', { p_token: token });
  if (error) throw new Error(`invoice lookup failed: ${error.message}`);
  return (data as PublicInvoice) || null;
}

/** The coach's logo from the public bucket, when it is a PNG or JPEG we can embed. */
async function logoOf(path: string | null | undefined) {
  if (!path) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/koutsi-logos/${path}`);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return { bytes, type: 'png' as const };
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, type: 'jpg' as const };
  } catch (err) {
    console.error('koutsi-invoice: logo fetch failed', (err as Error).message);
  }
  return null;
}

async function pdfOf(inv: PublicInvoice): Promise<Uint8Array> {
  return await renderInvoicePdf({ PDFDocument, StandardFonts, rgb }, inv, { logo: await logoOf(inv.seller?.logoPath) });
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

interface Row {
  id: string;
  coach_id: string;
  student_id: string | null;
  status: string;
  number: number;
  payer_email: string | null;
  public_token: string;
  mailed_at: string | null;
}

async function rowsOf(ids: string[]): Promise<Row[]> {
  const { data, error } = await admin.from('koutsi_invoices')
    .select('id, coach_id, student_id, status, number, payer_email, public_token, mailed_at').in('id', ids);
  if (error) throw new Error(`invoices failed: ${error.message}`);
  return (data ?? []) as Row[];
}

/** The e-mail the player's account was made with ('' for a player the coach added by name only). */
async function accountEmail(studentId: string | null): Promise<string> {
  if (!studentId) return '';
  const { data, error } = await admin.auth.admin.getUserById(studentId);
  if (error) return '';
  const email = String(data?.user?.email || '').trim();
  return EMAIL_RE.test(email) ? email : '';
}

/**
 * Where the invoice goes: the address given now, the payer's e-mail on the invoice, else the player's
 * own (fromAccount: kept from the coach). '' when there is none.
 */
async function addressOf(row: Row, override: string | null) {
  const given = override || String(row.payer_email || '').trim();
  if (given) return { to: given, fromAccount: false };
  const own = await accountEmail(row.student_id);
  return { to: own, fromAccount: Boolean(own) };
}

/** The player got the invoice itself by e-mail: the queued e-mail copy of its notification is done too. */
async function markNoticeMailed(row: Row) {
  if (!row.student_id) return;
  const { error } = await admin.from('koutsi_notifications')
    .update({ email_status: 'sent', emailed_at: new Date().toISOString(), email_error: 'invoice_mail' })
    .eq('recipient_id', row.student_id).eq('kind', 'invoice').eq('link_path', `/pelaaja/laskut/${row.id}`)
    .eq('email_status', 'pending');
  if (error) console.error('koutsi-invoice: marking the notice failed', error.message);
}

/** Sends one invoice mail (or reminder) to `to`; throws on failure. */
async function sendMail(inv: PublicInvoice, to: string, link: string, reminder: boolean, idempotency: string) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const mailFrom = Deno.env.get('KOUTSI_MAIL_FROM');
  if (!resendKey || !mailFrom) throw new Reply(503, NO_MAILER);
  const seller = String(inv.seller?.name || 'Krossi Koutsi').replace(/["<>]/g, '');
  const replyTo = inv.seller?.email || Deno.env.get('KOUTSI_MAIL_REPLY_TO') || undefined;
  const { subject, html, text } = renderInvoiceEmail(inv as Parameters<typeof renderInvoiceEmail>[0], link, { reminder });
  const pdf = await pdfOf(inv);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'content-type': 'application/json', 'Idempotency-Key': idempotency },
    body: JSON.stringify({
      from: `${seller} (Krossi Koutsi) <${mailFrom}>`,
      to: [to],
      subject,
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      attachments: [{ filename: `lasku-${inv.number}.pdf`, content: base64(pdf) }],
      tags: [{ name: 'app', value: 'koutsi' }, { name: 'kind', value: reminder ? 'invoice_reminder' : 'invoice' }],
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** The signed-in caller may act as this coach (the coach, or an admin acting as them). */
async function mayActAs(asUser: SupabaseClient, coachId: string) {
  const { data, error } = await asUser.rpc('koutsi_acts_as', { target: coachId });
  if (error) throw new Error(`koutsi_acts_as failed: ${error.message}`);
  return data === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  const url = new URL(req.url);

  try {
    // ── the PDF, for anyone with the link ──
    if (req.method === 'GET') {
      const token = url.searchParams.get('pdf') || '';
      if (!UUID_RE.test(token)) throw new Reply(404, NOT_FOUND);
      const inv = await publicInvoice(token);
      if (!inv) throw new Reply(404, NOT_FOUND);
      const pdf = await pdfOf(inv);
      return new Response(pdf, {
        headers: {
          ...corsHeaders(req),
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="lasku-${inv.number}.pdf"`,
          'cache-control': 'private, no-store',
          'x-robots-tag': 'noindex, nofollow',
        },
      });
    }
    if (req.method !== 'POST') return json(req, { error: 'method not allowed' }, 405);

    let body: { action?: string; invoiceIds?: unknown; invoiceId?: unknown; to?: unknown } = {};
    try { body = await req.json(); } catch { /* unknown action below */ }
    if (!['mail', 'remind'].includes(body.action ?? '')) throw new Reply(400, 'Tuntematon toiminto.');
    const asUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
    });
    const { data: who, error: whoError } = await asUser.auth.getUser();
    if (whoError || !who?.user) return json(req, { error: 'Kirjaudu uudelleen sisään.' }, 401);
    const base = Deno.env.get('KOUTSI_APP_ORIGIN') || appBase(req.headers.get('Origin'));
    const allowed = new Map<string, boolean>();
    const check = async (coachId: string) => {
      if (!allowed.has(coachId)) allowed.set(coachId, await mayActAs(asUser, coachId));
      return allowed.get(coachId) as boolean;
    };

    if (body.action === 'mail') {
      const ids = (Array.isArray(body.invoiceIds) ? body.invoiceIds : []).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).slice(0, 60);
      // another address for one invoice, this time ("Lähetä sähköpostiin" after sending)
      const override = ids.length === 1 && typeof body.to === 'string' && EMAIL_RE.test(body.to.trim()) ? body.to.trim() : null;
      const sent: { id: string; to: string }[] = [];
      const skipped: { id: string; reason: string }[] = [];
      for (const row of await rowsOf(ids)) {
        if (!(await check(row.coach_id))) throw new Reply(403, NOT_COACH);
        if (row.status !== 'sent') { skipped.push({ id: row.id, reason: 'not_open' }); continue; }
        const { to, fromAccount } = await addressOf(row, override);
        if (!to) { skipped.push({ id: row.id, reason: 'no_email' }); continue; }
        if (row.mailed_at && Date.parse(row.mailed_at) > Date.now() - 2 * 60 * 1000) { skipped.push({ id: row.id, reason: 'just_sent' }); continue; }
        const inv = await publicInvoice(row.public_token);
        if (!inv) { skipped.push({ id: row.id, reason: 'not_open' }); continue; }
        try {
          await sendMail(inv, to, `${base}/lasku/${row.public_token}`, false, `koutsi-invoice-${row.id}-${Math.floor(Date.now() / 120000)}`);
        } catch (err) {
          if (err instanceof Reply) throw err;
          console.error('koutsi-invoice: mail failed', row.id, (err as Error).message);
          skipped.push({ id: row.id, reason: 'failed' });
          continue;
        }
        await admin.from('koutsi_invoices').update({ mailed_at: new Date().toISOString(), mail_to: fromAccount ? null : to }).eq('id', row.id);
        if (fromAccount) await markNoticeMailed(row);
        sent.push({ id: row.id, to: fromAccount ? null : to });
      }
      return json(req, { sent, skipped });
    }

    // remind
    const id = typeof body.invoiceId === 'string' && UUID_RE.test(body.invoiceId) ? body.invoiceId : null;
    if (!id) throw new Reply(404, NOT_FOUND);
    const [row] = await rowsOf([id]);
    if (!row) throw new Reply(404, NOT_FOUND);
    if (!(await check(row.coach_id))) throw new Reply(403, NOT_COACH);
    const { data: notified, error: remindError } = await asUser.rpc('koutsi_remind_invoice', { p_invoice: id });
    if (remindError) throw new Reply(409, remindError.message || FAILED);
    if (notified !== true) return json(req, { notified: false, mailed: false, tooSoon: true });
    const { to, fromAccount } = await addressOf(row, null);
    let mailed = false;
    if (to) {
      const inv = await publicInvoice(row.public_token);
      if (inv) {
        await sendMail(inv, to, `${base}/lasku/${row.public_token}`, true, `koutsi-invoice-reminder-${id}-${new Date().toISOString().slice(0, 10)}`);
        mailed = true;
        if (fromAccount) await markNoticeMailed(row);
      }
    }
    return json(req, { notified: true, mailed, to: mailed && !fromAccount ? to : null });
  } catch (err) {
    if (err instanceof Reply) return json(req, { error: err.message }, err.status);
    console.error('koutsi-invoice failed', (err as Error).message);
    return json(req, { error: FAILED }, 500);
  }
});
