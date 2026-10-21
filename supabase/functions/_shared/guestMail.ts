// _shared/guestMail.ts — the emails a guest (a court booked without an account, migration
// 20261021075544_krossi_booking_guest) gets. A guest has no profile, so krossi-notify (which mails
// players by user id and respects their settings) can't reach them: these go straight to the
// address the guest typed, through Resend like krossi-notify's.
//
//   mailGuestConfirmed     the booking is paid: when and where, the price, and the booking's own link
//                          (krossi.app/pelaa/varaus/<token>) to see or cancel it. Sent once per
//                          booking (krossi_guest_mail_claim); a failed send is left for
//                          krossi-booking-cron (krossi_guest_mails_due).
//   mailGuestHallCancelled the hall cancelled the booking: the money goes back.
//
// Never throws: the booking itself already happened. Secrets: RESEND_API_KEY (+ KROSSI_MAIL_FROM,
// KROSSI_MAIL_FROM_NAME as in krossi-notify).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const APP_ORIGIN = 'https://krossi.app';
const RESEND_URL = 'https://api.resend.com/emails';

/** The guest's own page: the booking, its cancellation and the payment's return. */
export const guestBookingPath = (token: string) => `/pelaa/varaus/${encodeURIComponent(token)}`;

interface Facts {
  bookingId: string;
  name: string;
  email: string;
  token: string;
  startsAt: string;
  endsAt: string;
  priceCents: number;
  courtName: string;
  locationName: string;
  venueName: string;
  timezone: string;
  cancelLimitHours: number;
  cancellableUntil: string;
}

// 1500 -> "15 €", 1125 -> "11,25 €"
export function euros(cents: number): string {
  return `${cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace('.', ',')} €`;
}

const WEEKDAYS: Record<string, string> = { Mon: 'ma', Tue: 'ti', Wed: 'ke', Thu: 'to', Fri: 'pe', Sat: 'la', Sun: 'su' };
/** { label: 'ti 21.10. klo 18.00', time: '18.00' } in the hall's time. */
function slot(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const time = `${Number(part('hour'))}.${part('minute').padStart(2, '0')}`;
  return { label: `${WEEKDAYS[part('weekday')] ?? ''} ${Number(part('day'))}.${Number(part('month'))}. klo ${time}`, time };
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'hei';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

interface Content {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  details: string[];
  cta: { label: string; url: string } | null;
}

/** The same look as krossi-notify's mails, without the settings footer (a guest has no settings). */
function render(content: Content, name: string) {
  const greeting = `Moi ${firstName(name)},`;
  const footer = 'Sait tämän viestin, koska varasit kentän Krossissa tällä sähköpostiosoitteella.';
  const text = [
    greeting, '', content.heading, ...content.paragraphs, '', ...content.details,
    ...(content.cta ? ['', `${content.cta.label}: ${content.cta.url}`] : []), '', '—', footer,
  ].join('\n');
  const paragraphs = content.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#3A372F">${escapeHtml(p)}</p>`).join('');
  const details = `<div style="margin:0 0 22px;padding:14px 16px;border:1px solid #E5E1D7;border-radius:14px;font-size:14px;line-height:1.7;color:#121212">${
    content.details.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div>`;
  const cta = content.cta
    ? `<a href="${escapeHtml(content.cta.url)}" style="display:inline-block;background:#CFE414;color:#121212;text-decoration:none;font-weight:800;font-size:15px;padding:13px 26px;border-radius:999px">${escapeHtml(content.cta.label)}</a>`
    : '';
  const html = `<!doctype html><html lang="fi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;background:#F7F5EF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;color:#121212">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.preheader)}</div>
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="font-weight:800;font-size:22px;color:#0E3B2C;letter-spacing:-0.5px;margin-bottom:24px">Krossi</div>
    <div style="background:#FFFFFF;border:1px solid #D8D4CA;border-radius:18px;padding:26px 24px">
      <p style="margin:0 0 14px;font-size:15px;color:#6B665C">${escapeHtml(greeting)}</p>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:800;color:#121212">${escapeHtml(content.heading)}</h1>
      ${paragraphs}${details}${cta}
    </div>
    <p style="margin:18px 0 0;font-size:12px;color:#8A857A;line-height:1.5">${escapeHtml(footer)}</p>
  </div>
</body></html>`;
  return { subject: content.subject, html, text };
}

async function send(to: string, name: string, content: Content): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.error('guest mail: RESEND_API_KEY missing');
    return false;
  }
  const mailFrom = Deno.env.get('KROSSI_MAIL_FROM') ?? Deno.env.get('KOUTSI_MAIL_FROM') ?? 'messages@krossi.app';
  const from = `${Deno.env.get('KROSSI_MAIL_FROM_NAME') ?? 'Krossi'} <${mailFrom}>`;
  try {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], ...render(content, name) }),
    });
    if (!response.ok) console.error('guest mail rejected', response.status, await response.text().catch(() => ''));
    return response.ok;
  } catch (err) {
    console.error('guest mail failed', (err as Error).message);
    return false;
  }
}

function place(f: Facts) {
  return [f.courtName, f.locationName, f.venueName].filter(Boolean).join(', ');
}

function when(f: Facts) {
  const tz = f.timezone || 'Europe/Helsinki';
  return `${slot(f.startsAt, tz).label}–${slot(f.endsAt, tz).time}`;
}

/** Sends the confirmation of a paid guest booking once (→ true when sent now). */
export async function mailGuestConfirmed(admin: SupabaseClient, bookingId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc('krossi_guest_mail_claim', { booking_id_input: bookingId });
    if (error) throw new Error(error.message);
    const f = data as Facts | null;
    if (!f) return false;
    const tz = f.timezone || 'Europe/Helsinki';
    const until = slot(f.cancellableUntil, tz).label;
    const sent = await send(f.email, f.name, {
      subject: `Kenttä varattu: ${when(f)}`,
      preheader: `${place(f)} · ${euros(f.priceCents)} maksettu`,
      heading: 'Kenttävarauksesi on vahvistettu',
      paragraphs: [
        `Maksu ${euros(f.priceCents)} on vastaanotettu, ja kenttä on varattu sinulle. Kuitti tulee erikseen.`,
        Date.parse(f.cancellableUntil) > Date.now()
          ? `Voit perua varauksen viimeistään ${until}. Palautuksesta pidätetään 1 € peruutuskulu.`
          : 'Varausta ei voi enää perua verkossa. Ota tarvittaessa yhteyttä halliin.',
      ],
      details: [`🗓 ${when(f)}`, `📍 ${place(f)}`, `💳 ${euros(f.priceCents)}`],
      cta: { label: 'Katso tai peru varaus', url: `${APP_ORIGIN}${guestBookingPath(f.token)}` },
    });
    if (!sent) {
      const { error: undoError } = await admin.rpc('krossi_guest_mail_failed', { booking_id_input: bookingId });
      if (undoError) console.error('guest mail: could not leave it for the cron', bookingId, undoError.message);
    }
    return sent;
  } catch (err) {
    console.error('guest confirmation mail failed', bookingId, (err as Error).message);
    return false;
  }
}

/** The hall cancelled a guest's booking: tell them (refundedCents = what goes back to their card). */
export async function mailGuestHallCancelled(admin: SupabaseClient, bookingId: string, refundedCents: number): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc('krossi_guest_mail_facts', { booking_id_input: bookingId });
    if (error) throw new Error(error.message);
    const f = data as Facts | null;
    if (!f) return false;
    return await send(f.email, f.name, {
      subject: `Varauksesi peruttiin: ${when(f)}`,
      preheader: `${place(f)}`,
      heading: 'Halli perui kenttävarauksesi',
      paragraphs: [
        refundedCents > 0
          ? `${f.venueName} perui varauksesi. Saat ${euros(refundedCents)} takaisin maksutavallesi — palautus näkyy tililläsi yleensä muutamassa päivässä.`
          : `${f.venueName} perui varauksesi. Kysy tarvittaessa lisää hallilta.`,
      ],
      details: [`🗓 ${when(f)}`, `📍 ${place(f)}`],
      cta: null,
    });
  } catch (err) {
    console.error('guest cancellation mail failed', bookingId, (err as Error).message);
    return false;
  }
}
