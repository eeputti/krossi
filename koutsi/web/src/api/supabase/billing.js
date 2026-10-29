// billing.js — Laskutus over koutsi_billers / koutsi_invoices / koutsi_invoice_lines (migration
// supabase/migrations/20261029162350_koutsi_billing.sql, applied 2026-10-29). Without it overview() and
// mine() answer { ready: false } and both apps keep Laskutus hidden. Row security decides who reads
// and writes; numbering, sending, paid and void are the database's functions.

import { db, isMissingFunction, isMissingTable, must, requireSession, selectIn } from './client.js';
import { ApiError } from '../errors.js';
import { normalizeIban } from '../../domain/billing.js';

const from = (table) => db().from(table);
const missing = (error) => isMissingFunction(error) || isMissingTable(error);
const OFF = { ready: false, enabled: false, biller: null, invoices: [], memberships: [] };
const text = (v) => {
  const s = String(v ?? '').trim();
  return s || null;
};

export function mapBiller(r) {
  if (!r) return null;
  return {
    id: r.id, coachId: r.coach_id, name: r.name || '', businessId: r.business_id || '', address: r.address || '',
    email: r.email || '', phone: r.phone || '', iban: r.iban || '', bic: r.bic || '', vatMode: r.vat_mode || 'none',
    paymentDays: r.payment_days ?? 14, cancelHours: r.cancel_hours ?? 24, chargeLate: r.charge_late !== false,
    chargeNoShow: r.charge_no_show !== false, terms: r.terms || '', nextNumber: r.next_number || 1,
    prices: { groups: {}, privateHourCents: null, ...(r.prices || {}) }, payers: r.payers || {},
  };
}

export function mapLine(r) {
  return {
    id: r.id, invoiceId: r.invoice_id, studentId: r.student_id || null, sortOrder: r.sort_order ?? 0, kind: r.kind,
    trainingId: r.training_id || null, groupId: r.group_id || null, date: r.line_date || null, time: r.line_time || '',
    description: r.description, quantity: Number(r.quantity) || 1, unitCents: r.unit_cents || 0,
    amountCents: r.amount_cents || 0, charged: r.charged !== false,
  };
}

export function mapInvoice(r, lines = []) {
  return {
    id: r.id, studentId: r.student_id || null, status: r.status, number: r.number || null, reference: r.reference || '',
    issueDate: r.issue_date || null, dueDate: r.due_date || null, periodStart: r.period_start || null, periodEnd: r.period_end || null,
    payerName: r.payer_name || '', payerEmail: r.payer_email || '', payerAddress: r.payer_address || '',
    seller: r.seller || null, vatMode: r.vat_mode || 'none', totalCents: r.total_cents || 0, publicToken: r.public_token,
    sentAt: r.sent_at || null, paidAt: r.paid_at || null, voidedAt: r.voided_at || null, createdAt: r.created_at,
    lines: lines.map(mapLine).sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

async function withLines(rows) {
  const lines = await selectIn(rows.map((r) => r.id), (ids) => from('koutsi_invoice_lines').select('*').in('invoice_id', ids));
  const byInvoice = new Map();
  for (const l of lines) {
    const list = byInvoice.get(l.invoice_id) || [];
    list.push(l);
    byInvoice.set(l.invoice_id, list);
  }
  return rows.map((r) => mapInvoice(r, byInvoice.get(r.id) || []));
}

function billerRow(coachId, f) {
  return {
    coach_id: coachId,
    name: String(f.name || '').trim(),
    business_id: text(f.businessId),
    address: text(f.address),
    email: text(f.email),
    phone: text(f.phone),
    iban: normalizeIban(f.iban),
    bic: text(f.bic) ? String(f.bic).replace(/\s+/g, '').toUpperCase() : null,
    vat_mode: f.vatMode || 'none',
    payment_days: Math.max(0, Math.min(90, Math.round(Number(f.paymentDays) || 0))),
    cancel_hours: Math.max(0, Math.min(168, Math.round(Number(f.cancelHours) || 0))),
    charge_late: f.chargeLate !== false,
    charge_no_show: f.chargeNoShow !== false,
    terms: text(f.terms),
    next_number: Math.max(1, Math.round(Number(f.nextNumber) || 1)),
    prices: f.prices || {},
    payers: f.payers || {},
  };
}

export const billing = {
  async overview(coachId) {
    // The gate is asked first: before the migration it is one quiet miss and nothing else is read.
    const gate = await db().rpc('koutsi_billing_enabled', { p_coach: coachId });
    if (gate.error) {
      if (!missing(gate.error)) console.warn('billing unavailable:', gate.error.message || gate.error);
      return OFF;
    }
    if (gate.data !== true) return { ...OFF, ready: true };
    const [billerRow_, invoiceRows, memberRows] = await Promise.all([
      from('koutsi_billers').select('*').eq('coach_id', coachId).maybeSingle(),
      from('koutsi_invoices').select('*').eq('coach_id', coachId).order('created_at', { ascending: false }).limit(1000),
      db().rpc('koutsi_billing_memberships', { p_coach: coachId }),
    ]);
    const invoices = await withLines(must(invoiceRows) || []);
    return {
      ready: true,
      enabled: true,
      biller: mapBiller(must(billerRow_)),
      invoices,
      memberships: (must(memberRows) || []).map((m) => ({
        groupId: m.group_id, studentId: m.student_id, joinedAt: m.joined_at, endedAt: m.ended_at || null, groupCreatedAt: m.group_created_at || null,
      })),
    };
  },
  async saveBiller(coachId, fields) {
    const row = billerRow(coachId, fields);
    if (!row.name) throw new ApiError('Kirjoita laskuttajan nimi.');
    return mapBiller(must(await from('koutsi_billers').upsert(row, { onConflict: 'coach_id' }).select('*').single()));
  },
  async createDrafts(coachId, drafts) {
    if (!drafts?.length) throw new ApiError('Valitse ainakin yksi pelaaja.');
    return must(await db().rpc('koutsi_create_invoice_drafts', { p_coach: coachId, p_drafts: drafts })) || [];
  },
  async updateDraft(invoiceId, { payerName, payerEmail }) {
    const name = String(payerName || '').trim();
    if (!name) throw new ApiError('Kirjoita maksajan nimi.');
    const rows = must(await from('koutsi_invoices').update({ payer_name: name, payer_email: text(payerEmail) })
      .eq('id', invoiceId).eq('status', 'draft').select('id'));
    if (!rows?.length) throw new ApiError('Lasku on jo lähetetty tai poistettu. Päivitä näkymä.');
  },
  async setLineCharged(lineId, charged) {
    must(await from('koutsi_invoice_lines').update({ charged: Boolean(charged) }).eq('id', lineId));
  },
  async addLine(invoiceId, { description, amountCents, date = null }) {
    const desc = String(description || '').trim();
    if (!desc) throw new ApiError('Kirjoita rivin selite.');
    if (!(amountCents > 0)) throw new ApiError('Kirjoita summa.');
    must(await from('koutsi_invoice_lines').insert({
      invoice_id: invoiceId, kind: 'manual', description: desc, quantity: 1, unit_cents: amountCents, amount_cents: amountCents,
      line_date: date, sort_order: 10000,
    }));
  },
  async removeLine(lineId) {
    must(await from('koutsi_invoice_lines').delete().eq('id', lineId));
  },
  async removeDrafts(ids) {
    if (!ids?.length) return;
    must(await from('koutsi_invoices').delete().in('id', ids).eq('status', 'draft'));
  },
  async send(ids) {
    if (!ids?.length) return [];
    return must(await db().rpc('koutsi_send_invoices', { p_ids: ids })) || [];
  },
  async setPaid(invoiceId, paid) {
    must(await db().rpc('koutsi_set_invoice_paid', { p_invoice: invoiceId, p_paid: Boolean(paid) }));
  },
  async voidInvoice(invoiceId) {
    must(await db().rpc('koutsi_void_invoice', { p_invoice: invoiceId }));
  },
  async mine() {
    const session = await requireSession();
    const [rows, terms] = await Promise.all([
      from('koutsi_invoices').select('*').eq('student_id', session.user.id).in('status', ['sent', 'paid'])
        .order('sent_at', { ascending: false }).limit(200),
      db().rpc('koutsi_my_billing_terms'),
    ]);
    if (rows.error) {
      if (!missing(rows.error)) console.warn('billing unavailable:', rows.error.message || rows.error);
      return { ready: false, invoices: [], terms: [] };
    }
    return {
      ready: true,
      invoices: await withLines(rows.data || []),
      terms: (terms.error ? [] : terms.data || []).map((t) => ({
        coachId: t.coach_id, sellerName: t.seller_name, cancelHours: t.cancel_hours, chargeLate: t.charge_late,
        chargeNoShow: t.charge_no_show, terms: t.terms || '', paymentDays: t.payment_days,
      })),
    };
  },
  async byToken(token) {
    if (!/^[0-9a-f-]{36}$/i.test(String(token || ''))) return null;
    const res = await db().rpc('koutsi_invoice_public', { p_token: token });
    if (res.error) {
      if (missing(res.error)) return null;
      throw res.error;
    }
    const d = res.data;
    if (!d) return null;
    return { ...d, lines: (d.lines || []).map((l) => ({ ...l, quantity: Number(l.quantity) || 1 })) };
  },
};
