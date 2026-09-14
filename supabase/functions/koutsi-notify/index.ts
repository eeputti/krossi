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

function renderEmail(n: Pending): { subject: string; html: string; text: string } {
  const link = APP_ORIGIN + (n.link_path ?? '/pelaaja');
  const greeting = `Moi ${n.recipient_name},`;
  const bodyText = n.body ? n.body : '';
  const subject = `${n.title} — Krossi Koutsi`;
  const text = [greeting, '', n.title, bodyText, '', `Avaa Koutsi: ${link}`, '',
    'Voit kytkeä nämä viestit pois Koutsin profiilistasi.'].filter(Boolean).join('\n');
  const html = `<!doctype html><html lang="fi"><body style="margin:0;background:#F7F5EF;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#111">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="font-weight:800;font-size:22px;color:#0E3B2C;letter-spacing:-0.5px;margin-bottom:24px">Krossi <span style="font-size:13px;color:#8a857a;font-weight:700">Koutsi</span></div>
    <div style="background:#fff;border:1px solid #D8D4CA;border-radius:18px;padding:26px 24px">
      <p style="margin:0 0 14px;font-size:15px;color:#514c42">${escapeHtml(greeting)}</p>
      <h1 style="margin:0 0 10px;font-size:19px;font-weight:800;color:#111">${escapeHtml(n.title)}</h1>
      ${bodyText ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#3c382f">${escapeHtml(bodyText)}</p>` : ''}
      <a href="${link}" style="display:inline-block;background:#0E3B2C;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 24px;border-radius:999px">Avaa Koutsi</a>
    </div>
    <p style="margin:18px 0 0;font-size:12px;color:#8a857a;line-height:1.5">Saat tämän viestin, koska käytät Krossi Koutsia. Voit kytkeä sähköposti-ilmoitukset pois profiilisi asetuksista.</p>
  </div>
</body></html>`;
  return { subject, html, text };
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
