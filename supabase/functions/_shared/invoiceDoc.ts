// _shared/invoiceDoc.ts — what an invoice shows: invoiceDoc() and the helpers it needs, ported from
// koutsi/web/src/domain/billing.js for the edge functions (they can't import koutsi/web). Same
// outputs for the same input (koutsi/web/test/invoicePdf.test.mjs compares the two), plus `note`,
// the coach's message. Erasable TypeScript only and no imports, so Node runs it as it is.

export const NO_VAT_NOTE = 'Myyjä ei ole arvonlisäverovelvollinen (AVL 3 §, vähäinen toiminta).';

const VAT_MODES = [
  { value: 'none', rate: 0 },
  { value: '25.5', rate: 25.5 },
  { value: '14', rate: 14 },
  { value: '10', rate: 10 },
] as const;

const LINE_KINDS: Record<string, string> = {
  session: 'Treeni',
  late: 'Myöhäinen peruutus',
  no_show: 'Poissa ilmoittamatta',
  cancelled: 'Peruttu ajoissa',
  season: 'Kausimaksu',
  manual: 'Muu',
};

export type LineKind = 'session' | 'late' | 'no_show' | 'cancelled' | 'season' | 'manual';

/** One invoice line as koutsi_invoice_public() returns it (camelCase). */
export interface InvoiceLine {
  id?: string;
  key?: string;
  sortOrder?: number | null;
  kind: LineKind | string;
  date?: string | null;
  time?: string | null;
  description: string;
  quantity?: number;
  unitCents?: number;
  amountCents: number | string;
  charged: boolean;
}

/** The seller's details as frozen on the invoice when it was sent. */
export interface InvoiceSeller {
  name?: string;
  businessId?: string;
  address?: string;
  email?: string;
  phone?: string;
  iban?: string;
  bic?: string;
  vatMode?: string;
  terms?: string;
  logoPath?: string | null;
}

/** An invoice as koutsi_invoice_public() returns it (the app's invoices have the same fields). All optional, so a loosely typed row fits. */
export interface Invoice {
  status?: 'draft' | 'sent' | 'paid' | 'void' | string;
  number?: number | null;
  reference?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  payerName?: string | null;
  payerEmail?: string | null;
  payerAddress?: string | null;
  seller?: InvoiceSeller | null;
  vatMode?: string | null;
  totalCents?: number;
  note?: string | null;
  paidVia?: string | null;
  lines?: InvoiceLine[] | null;
}

export interface InvoiceDocLine {
  when: string;
  text: string;
  amount: string;
  id: string | undefined;
}

export interface InvoiceDoc {
  seller: InvoiceSeller;
  number: number | null | undefined;
  reference: string;
  issueDate: string;
  dueDate: string;
  period: string;
  payer: { name: string; email: string; address: string };
  lines: InvoiceDocLine[];
  freeCount: number;
  total: number;
  totalText: string;
  vat: { rate: number; net: number; vat: number; gross: number } | null;
  vatNote: string;
  iban: string;
  bic: string;
  barcode: string | null;
  terms: string;
  /** The coach's message on the invoice ('' without one). */
  note: string;
}

type Cents = number | string | null | undefined;

// ── money ───────────────────────────────────────────────────────────────────

/** 12000 → "120,00 €" (no-break spaces: thousands and before the euro sign). */
export function euros(cents: Cents): string {
  const n = Math.round(Number(cents) || 0);
  const abs = Math.abs(n);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${n < 0 ? '\u2212' : ''}${whole},${String(abs % 100).padStart(2, '0')}\u00a0€`;
}

export const vatRate = (mode: string | null | undefined): number => VAT_MODES.find((v) => v.value === mode)?.rate || 0;

/** The VAT inside a VAT-inclusive total. */
export function vatBreakdown(grossCents: Cents, rate: number): { net: number; vat: number; gross: number } {
  const gross = Math.round(Number(grossCents) || 0);
  if (!rate) return { net: gross, vat: 0, gross };
  const vat = Math.round((gross * rate) / (100 + rate));
  return { net: gross - vat, vat, gross };
}

// ── Finnish bank details ────────────────────────────────────────────────────

/** "1000123" → "10 00123": groups of five from the right, the way banks print it. */
export function formatReference(ref: string | number | null | undefined): string {
  const s = String(ref || '').replace(/\s/g, '');
  const parts: string[] = [];
  for (let end = s.length; end > 0; end -= 5) parts.unshift(s.slice(Math.max(0, end - 5), end));
  return parts.join(' ');
}

export const normalizeIban = (s: string | null | undefined): string => String(s || '').replace(/\s+/g, '').toUpperCase();
export const formatIban = (s: string | null | undefined): string => normalizeIban(s).replace(/(.{4})(?=.)/g, '$1 ');

/**
 * Pankkiviivakoodi, version 4 (Finnish IBAN + national reference), as its 54 digits — the
 * "virtuaaliviivakoodi" a bank app accepts in one paste. null when it doesn't apply.
 */
export function virtualBarcode({ iban, cents, reference, dueDate }: {
  iban?: string | null;
  cents: Cents;
  reference?: string | null;
  dueDate?: string | null;
}): string | null {
  const v = normalizeIban(iban);
  if (!/^FI\d{16}$/.test(v)) return null;
  const c = Math.round(Number(cents) || 0);
  if (!(c > 0) || c >= 100000000) return null;
  const ref = String(reference || '').replace(/\s/g, '');
  if (!/^\d{4,20}$/.test(ref)) return null;
  const d = String(dueDate || '');
  const due = /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}` : '000000';
  return `4${v.slice(2)}${String(Math.floor(c / 100)).padStart(6, '0')}${String(c % 100).padStart(2, '0')}000${ref.padStart(20, '0')}${due}`;
}

// ── dates ───────────────────────────────────────────────────────────────────

/** "2026-11-12" → "12.11.2026" */
export function fiDate(date: string | null | undefined): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(date || '')) return '';
  const d = String(date);
  return `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.${d.slice(0, 4)}`;
}

// ── lines ───────────────────────────────────────────────────────────────────

const DAYS = ['Su', 'Ma', 'Ti', 'Ke', 'To', 'Pe', 'La'];

/** The charged lines' sum. */
export function totalOf(lines: ReadonlyArray<Pick<InvoiceLine, 'charged' | 'amountCents'>> | null | undefined): number {
  return (lines || []).reduce((sum, l) => sum + (l.charged ? Math.round(Number(l.amountCents) || 0) : 0), 0);
}

/** How a line reads on the invoice: "Ti 4.11. 17:00 Aikuiset edistyneet — myöhäinen peruutus". */
export function lineLabel(line: Pick<InvoiceLine, 'kind' | 'date' | 'time' | 'description'>): { when: string; text: string } {
  let when = '';
  if (line.date && line.kind !== 'season' && line.kind !== 'manual') {
    const [y, m, d] = line.date.split('-').map(Number);
    // the weekday of a calendar date: UTC, so the server's time zone can't move it
    when = `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}.${m}.${line.time ? ` ${line.time.slice(0, 5)}` : ''}`;
  } else if (line.date && line.kind === 'manual') {
    when = fiDate(line.date);
  }
  const extra = line.kind === 'late' || line.kind === 'no_show' || line.kind === 'cancelled' ? ` — ${LINE_KINDS[line.kind].toLowerCase()}` : '';
  return { when, text: `${line.description}${extra}` };
}

// ── the invoice ─────────────────────────────────────────────────────────────

/** Everything an invoice page shows, from a sent (or draft) invoice. */
export function invoiceDoc(inv: Invoice): InvoiceDoc {
  const seller: InvoiceSeller = inv.seller || {};
  const rate = vatRate(inv.vatMode || seller.vatMode);
  const charged = (inv.lines || []).filter((l) => l.charged).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    || `${a.date || ''}T${a.time || ''}`.localeCompare(`${b.date || ''}T${b.time || ''}`));
  const total = totalOf(charged);
  const freeCount = (inv.lines || []).filter((l) => !l.charged).length;
  return {
    seller,
    number: inv.number,
    reference: inv.reference ? formatReference(inv.reference) : '',
    issueDate: fiDate(inv.issueDate),
    dueDate: fiDate(inv.dueDate),
    period: inv.periodStart && inv.periodEnd ? `${fiDate(inv.periodStart)}–${fiDate(inv.periodEnd)}` : '',
    payer: { name: inv.payerName as string, email: inv.payerEmail || '', address: inv.payerAddress || '' }, // a saved invoice always has one
    lines: charged.map((l) => ({ ...lineLabel(l), amount: euros(l.amountCents), id: l.id || l.key })),
    freeCount,
    total,
    totalText: euros(total),
    vat: rate ? { rate, ...vatBreakdown(total, rate) } : null,
    vatNote: rate ? '' : NO_VAT_NOTE,
    iban: seller.iban ? formatIban(seller.iban) : '',
    bic: seller.bic || '',
    barcode: inv.reference ? virtualBarcode({ iban: seller.iban, cents: total, reference: inv.reference, dueDate: inv.dueDate }) : null,
    terms: seller.terms || '',
    note: String(inv.note || '').trim(),
  };
}
