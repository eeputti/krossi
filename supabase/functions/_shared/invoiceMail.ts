// _shared/invoiceMail.ts — the e-mail that carries an invoice to its payer (koutsi-invoice): who it is
// from, the sum and due date, the coach's own message, one button to the invoice's page (where it can
// be paid online when the coach takes payments), the bank details for a transfer, the PDF attached.
// The Krossi look of koutsi-notify's mails: white card, near-black text, the lime button. Pure, so
// koutsi/web/test/invoiceMail.test.mjs runs it in Node.
import { euros, fiDate, formatIban, formatReference } from './invoiceDoc.ts';

const C = { ink: '#121212', ink2: '#333333', muted: '#6A6A6A', line: '#E8E8E8', page: '#F7F7F7', lime: '#CFE414' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif";

export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export interface MailInvoice {
  number: number;
  totalCents: number;
  dueDate: string | null;
  reference: string | null;
  payerName: string;
  note?: string | null;
  payable?: boolean;
  seller: { name?: string; iban?: string; email?: string } | null;
}

/** Today in Finland, 'YYYY-MM-DD'. */
export function helsinkiToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * subject, html and text of the invoice mail (or its reminder). `link` = the invoice's own page. A reminder
 * says "eräpäivä on" until the due date (`today`, Finnish time) and "eräpäivä oli" after it.
 */
export function renderInvoiceEmail(inv: MailInvoice, link: string, { reminder = false, today = helsinkiToday() }: { reminder?: boolean; today?: string } = {}) {
  const seller = inv.seller?.name || 'Valmentajasi';
  const sum = euros(inv.totalCents);
  const due = fiDate(inv.dueDate);
  const ref = inv.reference ? formatReference(inv.reference) : '';
  const iban = inv.seller?.iban ? formatIban(inv.seller.iban) : '';
  const subject = `${reminder ? 'Muistutus: lasku' : 'Lasku'} ${inv.number} – ${seller}`;
  const headline = reminder ? `Muistutus: lasku ${inv.number} on maksamatta` : `Lasku ${inv.number}: ${sum}`;
  const lead = reminder
    ? `Laskun ${inv.number} (${sum}) eräpäivä ${inv.dueDate && String(inv.dueDate).slice(0, 10) >= today ? 'on' : 'oli'} ${due}. Jos olet jo maksanut, tämän voi ohittaa.`
    : `${seller} lähetti sinulle laskun. Eräpäivä on ${due}.`;
  const label = inv.payable ? 'Maksa lasku' : 'Avaa lasku';
  const note = String(inv.note || '').trim();

  const rows = [
    ['Summa', sum], ['Eräpäivä', due],
    ...(iban ? [['Tilinumero', iban]] : []),
    ...(ref ? [['Viitenumero', ref]] : []),
    ['Saaja', seller],
  ];
  const table = rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;font-size:13px;color:${C.muted};white-space:nowrap">${escapeHtml(k)}</td><td style="padding:4px 0;font-size:14px;font-weight:700;color:${C.ink}">${escapeHtml(v)}</td></tr>`).join('');
  const html = `<!doctype html><html lang="fi"><body style="margin:0;background:${C.page};font-family:${FONT};color:${C.ink}">
  <div style="max-width:520px;margin:0 auto;padding:28px 16px">
    <div style="margin:0 0 18px;font-size:16px;font-weight:800;color:${C.ink}">${escapeHtml(seller)}</div>
    <div style="background:#ffffff;border:1px solid ${C.line};border-radius:12px;padding:24px 22px">
      <p style="margin:0 0 12px;font-size:15px;color:${C.muted}">${escapeHtml(`Hei ${inv.payerName},`)}</p>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:800;color:${C.ink}">${escapeHtml(headline)}</h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${C.ink2}">${escapeHtml(lead)}</p>
      ${note ? `<p style="margin:0 0 14px;padding:12px 14px;border-radius:10px;background:${C.page};font-size:15px;line-height:1.55;color:${C.ink};white-space:pre-line">${escapeHtml(note)}</p>` : ''}
      <a href="${escapeHtml(link)}" style="display:inline-block;margin:2px 0 18px;background:${C.lime};color:${C.ink};text-decoration:none;font-weight:800;font-size:15px;padding:13px 24px;border-radius:999px">${label}</a>
      <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${table}</table>
      <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:${C.muted}">Lasku on liitteenä PDF-tiedostona.</p>
    </div>
    <p style="margin:16px 4px 0;font-size:12px;line-height:1.5;color:${C.muted}">Lasku lähetettiin Krossi Koutsin kautta. Kysymykset laskusta: vastaa tähän viestiin${inv.seller?.email ? ` tai ${escapeHtml(inv.seller.email)}` : ''}.</p>
  </div>
</body></html>`;
  const text = [
    `Hei ${inv.payerName},`, '', headline, lead, ...(note ? ['', note] : []), '',
    `${label}: ${link}`, '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '',
    'Lasku on liitteenä PDF-tiedostona.',
  ].join('\n');
  return { subject, html, text };
}
