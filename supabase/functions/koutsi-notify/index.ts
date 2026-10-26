// koutsi-notify — drains public.koutsi_notifications into transactional email.
//
// Invoked on a schedule by the koutsi_dispatch_notification_emails() cron job (see the
// koutsi_notification_cron migration), never by a browser: verify_jwt is off, so the only
// gate is the shared KOUTSI_CRON_KEY below.
//
// Mail goes through Resend. An earlier version used Brevo; that account belongs to an
// unrelated business (mums.fi) and must never be used for Koutsi.
//
// Required secrets (supabase secrets set ...):
//   KOUTSI_CRON_KEY   - shared with the cron job's vault secret
//   RESEND_API_KEY    - Resend API key
//   KOUTSI_MAIL_FROM  - sender on a domain verified in Resend, e.g. koutsi@krossi.app
// Optional:
//   KOUTSI_MAIL_FROM_NAME (default "Krossi Koutsi")
//   KOUTSI_MAIL_REPLY_TO
//   KOUTSI_APP_ORIGIN     (default https://koutsi.krossi.app)
//
// Until RESEND_API_KEY is set the function reports "mailer not configured" and leaves the
// queue untouched, so notifications still show up in-app and nothing is silently lost.
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface Pending {
  id: string;
  email: string;
  recipient_name: string;
  kind: string;
  title: string;
  body: string | null;
  link_path: string | null;
}

const APP_ORIGIN = Deno.env.get('KOUTSI_APP_ORIGIN') ?? 'https://koutsi.krossi.app';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

// The Krossi look (koutsi/web/src/styles/tokens.css): white, neutral greys, near-black text and
// the lime tennis-ball green as the one accent. Flat: borders, no shadows.
const C = { ink: '#121212', ink2: '#333333', muted: '#6A6A6A', line: '#E8E8E8', page: '#F7F7F7', lime: '#CFE414', lime200: '#E8F29A' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif";

/** Escaped text with its line breaks kept; in a reminder each session's first line is bold. */
function paragraphs(text: string, boldFirstLines = false): string {
  return text.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n').map(escapeHtml);
    if (boldFirstLines && lines.length) lines[0] = `<strong style="color:${C.ink}">${lines[0]}</strong>`;
    return `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${C.ink2}">${lines.join('<br>')}</p>`;
  }).join('');
}

const isCoach = (n: Pending) => (n.link_path ?? '').startsWith('/valmentaja');
const settingsLink = (n: Pending) => `${APP_ORIGIN}${isCoach(n) ? '/valmentaja/profiili' : '/pelaaja/profiili'}`;

/** The frame every Koutsi mail shares: wordmark, white card, footer with the e-mail choices. */
function frame(n: Pending, inner: string): string {
  return `<!doctype html><html lang="fi"><body style="margin:0;background:${C.page};font-family:${FONT};color:${C.ink}">
  <div style="max-width:520px;margin:0 auto;padding:28px 16px">
    <div style="margin:0 0 18px;font-size:20px;font-weight:800;letter-spacing:-0.4px;color:${C.ink}">Krossi <span style="display:inline-block;vertical-align:2px;margin-left:2px;padding:3px 9px;border-radius:999px;background:${C.lime};color:${C.ink};font-size:12px;font-weight:800;letter-spacing:0">Koutsi</span></div>
    <div style="background:#ffffff;border:1px solid ${C.line};border-radius:12px;padding:24px 22px">
      <p style="margin:0 0 12px;font-size:15px;color:${C.muted}">${escapeHtml(`Moi ${n.recipient_name},`)}</p>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:800;letter-spacing:-0.3px;color:${C.ink}">${escapeHtml(n.title)}</h1>
      ${inner}
    </div>
    <p style="margin:16px 4px 0;font-size:12px;line-height:1.5;color:${C.muted}">Saat tämän viestin, koska käytät Krossi Koutsia. <a href="${settingsLink(n)}" style="color:${C.ink};font-weight:700">Valitse, mitkä sähköpostit saat</a></p>
  </div>
</body></html>`;
}

const button = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;margin-top:4px;background:${C.lime};color:${C.ink};text-decoration:none;font-weight:800;font-size:15px;padding:13px 24px;border-radius:999px">${escapeHtml(label)}</a>`;

const MOOD_LABELS = ['Raskas', 'Vaisu', 'Ihan ok', 'Hyvä', 'Loistava'];

// "Treenit ohi! Miten meni?" (koutsi_queue_session_checkins): the answer is one tap on a number.
// Each button opens the app's pop-up with that number; the app saves it, so a mail scanner that
// opens the links changes nothing (it isn't signed in).
function renderCheckInEmail(n: Pending): { subject: string; html: string; text: string } {
  const base = APP_ORIGIN + (n.link_path ?? '/pelaaja?uusi=1');
  const scoreLink = (score: number) => `${base}${base.includes('?') ? '&' : '?'}arvo=${score}`;
  const wishLink = `${APP_ORIGIN}/pelaaja?uusi=1&toive=1`;
  const bodyText = n.body ?? '';
  const subject = `${n.title} — Krossi Koutsi`;
  const text = [`Moi ${n.recipient_name},`, '', n.title, bodyText, '',
    ...MOOD_LABELS.map((label, i) => `${i + 1} ${label}: ${scoreLink(i + 1)}`), '',
    `Haluatko jotain seuraavaan treeniin? Lähetä valmentajalle toive: ${wishLink}`, '',
    `Valitse, mitkä sähköpostit saat: ${settingsLink(n)}`].join('\n');
  const buttons = MOOD_LABELS.map((label, i) => `
        <td style="padding:0 2px;width:20%" align="center">
          <a href="${scoreLink(i + 1)}" style="display:block;padding:12px 2px 10px;border-radius:12px;border:1px solid ${C.line};background:${i >= 3 ? C.lime200 : '#ffffff'};color:${C.ink};text-decoration:none">
            <span style="display:block;font-size:20px;font-weight:800;line-height:1">${i + 1}</span>
            <span style="display:block;margin-top:4px;font-size:10.5px;font-weight:600;white-space:nowrap;color:${C.muted}">${label}</span>
          </a>
        </td>`).join('');
  const inner = `${bodyText ? paragraphs(bodyText) : ''}
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;border-collapse:collapse;margin-top:4px"><tr>${buttons}
      </tr></table>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.5;color:${C.ink2}">Haluatko jotain seuraavaan treeniin? <a href="${wishLink}" style="color:${C.ink};font-weight:800">Lähetä valmentajalle toive</a></p>`;
  return { subject, html: frame(n, inner), text };
}

function renderEmail(n: Pending): { subject: string; html: string; text: string } {
  if (n.kind === 'session_checkin') return renderCheckInEmail(n);
  const link = APP_ORIGIN + (n.link_path ?? '/pelaaja');
  const bodyText = n.body ? n.body : '';
  const subject = `${n.title} — Krossi Koutsi`;
  const label = n.kind === 'session_reminder' ? 'Katso treenit' : 'Avaa Koutsi';
  const text = [`Moi ${n.recipient_name},`, '', n.title, bodyText, '', `${label}: ${link}`, '',
    `Valitse, mitkä sähköpostit saat: ${settingsLink(n)}`].filter((x, i, all) => x !== '' || all[i - 1] !== '').join('\n');
  const inner = `${bodyText ? paragraphs(bodyText, n.kind === 'session_reminder') : ''}
      ${button(link, label)}`;
  return { subject, html: frame(n, inner), text };
}

Deno.serve(async (req: Request) => {
  const cronKey = Deno.env.get('KOUTSI_CRON_KEY');
  if (!cronKey || req.headers.get('x-koutsi-cron-key') !== cronKey) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'content-type': 'application/json' },
    });
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const mailFrom = Deno.env.get('KOUTSI_MAIL_FROM');
  if (!resendKey || !mailFrom) {
    return new Response(JSON.stringify({ error: 'mailer not configured', sent: 0 }), {
      status: 503, headers: { 'content-type': 'application/json' },
    });
  }
  const mailFromName = Deno.env.get('KOUTSI_MAIL_FROM_NAME') ?? 'Krossi Koutsi';
  const replyTo = Deno.env.get('KOUTSI_MAIL_REPLY_TO');
  const from = `${mailFromName} <${mailFrom}>`;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  await supabase.rpc('koutsi_requeue_stuck_notifications');

  const { data, error } = await supabase.rpc('koutsi_claim_notification_batch', { batch_size: 25 });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }

  const pending = (data ?? []) as Pending[];
  if (pending.length === 0) {
    return new Response(JSON.stringify({ sent: 0, failed: 0 }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const sent: string[] = [];
  const failed: string[] = [];
  let lastError = '';

  for (const n of pending) {
    const { subject, html, text } = renderEmail(n);
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'content-type': 'application/json',
          // one send per notification row, so a retry cannot deliver the same mail twice
          'Idempotency-Key': n.id,
        },
        body: JSON.stringify({
          from,
          to: [n.email],
          subject,
          html,
          text,
          ...(replyTo ? { reply_to: replyTo } : {}),
          tags: [{ name: 'app', value: 'koutsi' }, { name: 'kind', value: n.kind }],
        }),
      });
      if (res.ok) {
        sent.push(n.id);
      } else {
        failed.push(n.id);
        lastError = `resend ${res.status}: ${(await res.text()).slice(0, 200)}`;
      }
    } catch (err) {
      failed.push(n.id);
      lastError = String(err).slice(0, 200);
    }
  }

  if (sent.length > 0) await supabase.rpc('koutsi_mark_notifications_sent', { ids: sent });
  if (failed.length > 0) {
    await supabase.rpc('koutsi_mark_notifications_sent', { ids: failed, failed_error: lastError });
  }

  return new Response(JSON.stringify({ sent: sent.length, failed: failed.length }), {
    headers: { 'content-type': 'application/json' },
  });
});
