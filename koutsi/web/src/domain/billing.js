// billing.js — Laskutus (vaihe 1): the pure rules behind the coach's invoices. No React, no backend.
//
//   * Money is whole cents (integers) everywhere; euros() / parseEuros() are the only conversions.
//   * A price is what the player pays (VAT included). With a VAT rate the invoice splits it into
//     veroton + ALV; "Ei ALV-velvollinen" invoices say so (AVL 3 §) and show no VAT.
//   * What a player owes comes from the sessions that have ended: present = charged, an absence is
//     sorted by when it was first reported (koutsi_training_absences.created_at = `reportedAt`):
//       - at least `cancelHours` before the start  → 'cancelled' (peruttu ajoissa, never charged)
//       - later than that, by the player (or by the coach before the start) → 'late'
//       - marked by the coach after the start      → 'no_show' (poissa ilmoittamatta)
//     The coach's settings say whether late / no-show are charged; every line can still be
//     toggled in the draft.
//   * A session or a season fee is billed once: billedKeys() lists what is already on an invoice
//     (drafts included, void invoices not), and billablePlayers() skips those.
//   * Group members count from the day they joined the group (a member added within a week of the
//     group's creation counts from its first session) until they left it.

const DAY_MS = 86400000;

export const VAT_MODES = [
  { value: 'none', label: 'Ei ALV-velvollinen', rate: 0 },
  { value: '25.5', label: 'ALV 25,5 %', rate: 25.5 },
  { value: '14', label: 'ALV 14 %', rate: 14 },
  { value: '10', label: 'ALV 10 %', rate: 10 },
];
export const NO_VAT_NOTE = 'Myyjä ei ole arvonlisäverovelvollinen (AVL 3 §, vähäinen toiminta).';

/** How a group is billed: per session, one season fee, or not through Koutsi at all. */
export const PRICE_MODES = [
  { value: 'kerta', label: 'Per kerta' },
  { value: 'kausi', label: 'Kausimaksu' },
  { value: 'ei', label: 'Ei laskuteta' },
];

export const LINE_KINDS = {
  session: 'Treeni',
  late: 'Myöhäinen peruutus',
  no_show: 'Poissa ilmoittamatta',
  cancelled: 'Peruttu ajoissa',
  season: 'Kausimaksu',
  manual: 'Muu',
};

export const INVOICE_STATES = {
  luonnos: { label: 'Luonnos', tone: 'neutral' },
  avoin: { label: 'Avoin', tone: 'lime' },
  myohassa: { label: 'Erääntynyt', tone: 'danger' },
  maksettu: { label: 'Maksettu', tone: 'success' },
  mitatoity: { label: 'Mitätöity', tone: 'outline' },
};

// ── money ───────────────────────────────────────────────────────────────────

/** 12000 → "120,00 €" (no-break spaces: thousands and before the euro sign). */
export function euros(cents) {
  const n = Math.round(Number(cents) || 0);
  const abs = Math.abs(n);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n < 0 ? '−' : ''}${whole},${String(abs % 100).padStart(2, '0')} €`;
}

/** "30", "30,5", "1 200,00 €" → cents; anything else → null. */
export function parseEuros(text) {
  const s = String(text ?? '').replace(/[\s €]/g, '').replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** Cents as an input's text: 3000 → "30", 3050 → "30,50", null → "". */
export function centsToInput(cents) {
  if (cents == null || cents === '') return '';
  const n = Math.round(Number(cents));
  if (!Number.isFinite(n)) return '';
  return n % 100 === 0 ? String(n / 100) : `${Math.floor(n / 100)},${String(n % 100).padStart(2, '0')}`;
}

export const vatRate = (mode) => VAT_MODES.find((v) => v.value === mode)?.rate || 0;
export const vatLabel = (mode) => VAT_MODES.find((v) => v.value === mode)?.label || VAT_MODES[0].label;

/** The VAT inside a VAT-inclusive total. */
export function vatBreakdown(grossCents, rate) {
  const gross = Math.round(Number(grossCents) || 0);
  if (!rate) return { net: gross, vat: 0, gross };
  const vat = Math.round((gross * rate) / (100 + rate));
  return { net: gross - vat, vat, gross };
}

// ── Finnish bank details ────────────────────────────────────────────────────

/** The 7-3-1 check digit of a Finnish reference number's base. */
export function referenceCheckDigit(base) {
  const digits = String(base);
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) sum += Number(digits[digits.length - 1 - i]) * weights[i % 3];
  return (10 - (sum % 10)) % 10;
}

/** Invoice number → viitenumero: "1" + the number (at least three digits) + check digit. */
export function referenceFor(invoiceNumber) {
  const base = `1${String(Math.max(1, Math.floor(Number(invoiceNumber) || 1))).padStart(3, '0')}`;
  return `${base}${referenceCheckDigit(base)}`;
}

export function validReference(ref) {
  const s = String(ref || '').replace(/\s/g, '');
  if (!/^\d{4,20}$/.test(s)) return false;
  return referenceCheckDigit(s.slice(0, -1)) === Number(s.slice(-1));
}

/** "1000123" → "10 00123": groups of five from the right, the way banks print it. */
export function formatReference(ref) {
  const s = String(ref || '').replace(/\s/g, '');
  const parts = [];
  for (let end = s.length; end > 0; end -= 5) parts.unshift(s.slice(Math.max(0, end - 5), end));
  return parts.join(' ');
}

export const normalizeIban = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();
export const formatIban = (s) => normalizeIban(s).replace(/(.{4})(?=.)/g, '$1 ');

/** IBAN with its mod-97 check (a Finnish one is FI + 16 digits). */
export function validIban(s) {
  const v = normalizeIban(s);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return false;
  if (v.startsWith('FI') && !/^FI\d{16}$/.test(v)) return false;
  const digits = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0;
  for (const ch of digits) m = (m * 10 + Number(ch)) % 97;
  return m === 1;
}

/** Y-tunnus 1234567-8 with its check digit. */
export function validBusinessId(s) {
  const m = /^(\d{7})-(\d)$/.exec(String(s || '').trim());
  if (!m) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2];
  const r = [...m[1]].reduce((sum, c, i) => sum + Number(c) * weights[i], 0) % 11;
  if (r === 1) return false;
  return Number(m[2]) === (r === 0 ? 0 : 11 - r);
}

export const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());

/**
 * Pankkiviivakoodi, version 4 (Finnish IBAN + national reference), as its 54 digits — the
 * "virtuaaliviivakoodi" a bank app accepts in one paste. null when it doesn't apply.
 */
export function virtualBarcode({ iban, cents, reference, dueDate }) {
  const v = normalizeIban(iban);
  if (!/^FI\d{16}$/.test(v)) return null;
  const c = Math.round(Number(cents) || 0);
  if (!(c > 0) || c >= 100000000) return null;
  const ref = String(reference || '').replace(/\s/g, '');
  if (!/^\d{4,20}$/.test(ref)) return null;
  const due = /^\d{4}-\d{2}-\d{2}$/.test(dueDate || '') ? `${dueDate.slice(2, 4)}${dueDate.slice(5, 7)}${dueDate.slice(8, 10)}` : '000000';
  return `4${v.slice(2)}${String(Math.floor(c / 100)).padStart(6, '0')}${String(c % 100).padStart(2, '0')}000${ref.padStart(20, '0')}${due}`;
}

// ── dates ───────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');
export const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function addDaysStr(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return dateStr(new Date(y, m - 1, d + days));
}
/** "2026-11-12" → "12.11.2026" */
export function fiDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(date || '')) return '';
  return `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}.${date.slice(0, 4)}`;
}
/** A session's start as a local Date. */
export function sessionStart(t) {
  return new Date(`${t.date}T${String(t.time || '00:00').slice(0, 5)}:00`);
}
export function sessionEnd(t) {
  return new Date(sessionStart(t).getTime() + (Number(t.durationMinutes) || 60) * 60000);
}

/** Ready-made billing periods, newest first: this season so far, this month, last month. */
export function periodPresets(today, season = null) {
  const [y, m] = today.split('-').map(Number);
  const monthStart = `${y}-${pad(m)}-01`;
  const prevStart = dateStr(new Date(y, m - 2, 1));
  const prevEnd = dateStr(new Date(y, m - 1, 0));
  const months = ['tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu', 'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu'];
  const out = [];
  if (season?.startsOn && season.startsOn <= today) {
    out.push({ value: 'kausi', label: `Kausi ${season.name || ''}`.trim(), from: season.startsOn, to: today });
  }
  out.push({ value: 'kuu', label: `${months[m - 1][0].toUpperCase()}${months[m - 1].slice(1)} tähän asti`, from: monthStart, to: today });
  out.push({ value: 'edellinen', label: `${months[(m + 10) % 12][0].toUpperCase()}${months[(m + 10) % 12].slice(1)}`, from: prevStart, to: prevEnd });
  return out;
}

// ── the coach's settings ────────────────────────────────────────────────────

export const EMPTY_BILLER = {
  name: '', businessId: '', address: '', email: '', phone: '', iban: '', bic: '',
  vatMode: 'none', paymentDays: 14, cancelHours: 24, chargeLate: true, chargeNoShow: true,
  terms: '', nextNumber: 1, prices: { groups: {}, privateHourCents: null }, payers: {},
};

/** What is still missing before the first invoice can go out ('' when nothing). */
export function billerMissing(b) {
  if (!b) return 'Täytä laskuttajan tiedot.';
  if (!String(b.name || '').trim()) return 'Kirjoita laskuttajan nimi.';
  if (!validIban(b.iban)) return 'Tarkista tilinumero (IBAN).';
  if (b.businessId && !validBusinessId(b.businessId)) return 'Tarkista Y-tunnus (muoto 1234567-8).';
  return '';
}

/** The cancellation terms in plain words, from the coach's settings (their own text wins). */
export function termsText(b) {
  if (!b) return '';
  if (String(b.terms || '').trim()) return String(b.terms).trim();
  const h = Number(b.cancelHours) || 0;
  const parts = [];
  if (h > 0) {
    parts.push(`Peru treeni viimeistään ${h} tuntia ennen alkua Koutsin En pääse -napilla.`);
    parts.push(b.chargeLate ? 'Myöhemmin peruttu treeni laskutetaan.' : 'Myöhäisestä peruutuksesta ei laskuteta.');
  } else {
    parts.push('Ilmoita poissaolosta Koutsin En pääse -napilla.');
  }
  if (b.chargeNoShow) parts.push('Ilmoittamatta jäänyt poissaolo laskutetaan.');
  if (b.paymentDays) parts.push(`Maksuaika ${b.paymentDays} päivää.`);
  return parts.join(' ');
}

export function groupPrice(biller, groupId) {
  const p = biller?.prices?.groups?.[groupId];
  return p && PRICE_MODES.some((m) => m.value === p.mode) ? p : null;
}

/** Who pays a player's invoices: a guardian or company the coach wrote down, else the player. */
export function payerFor(biller, student) {
  const p = biller?.payers?.[student?.id] || null;
  return {
    name: String(p?.name || '').trim() || student?.name || '',
    email: String(p?.email || '').trim(),
    custom: Boolean(p && (String(p.name || '').trim() || String(p.email || '').trim())),
  };
}

// ── what is owed ────────────────────────────────────────────────────────────

/** Sorts one absence: 'cancelled' (in time), 'late' or 'no_show'. */
export function absenceKind(training, absence, cancelHours) {
  const start = sessionStart(training).getTime();
  const reported = Date.parse(absence?.reportedAt || absence?.updatedAt || '');
  if (!Number.isFinite(reported)) return 'cancelled';
  if (reported >= start) return absence.reportedBy && absence.reportedBy === absence.studentId ? 'late' : 'no_show';
  const hours = (start - reported) / 3600000;
  return Number(cancelHours) > 0 && hours < Number(cancelHours) ? 'late' : 'cancelled';
}

/** "En pääse" inside the player's coach's limit: the one line to show, or ''. terms: useBilling().terms. */
export function lateCancelNote(terms, training, now = new Date()) {
  const t = (terms || []).find((x) => x.coachId === training?.coachId);
  if (!t || !(Number(t.cancelHours) > 0) || t.chargeLate === false || !training?.date) return '';
  const hoursLeft = (sessionStart(training).getTime() - now.getTime()) / 3600000;
  return hoursLeft < Number(t.cancelHours) ? `Alle ${t.cancelHours} h ennen peruttu treeni laskutetaan.` : '';
}

/** Keys of what is already on an invoice (drafts too, void ones not): `${trainingId}:${studentId}`, `season:${groupId}:${studentId}`. */
export function billedKeys(invoices) {
  const keys = new Set();
  for (const inv of invoices || []) {
    if (inv.status === 'void') continue;
    for (const l of inv.lines || []) {
      const sid = l.studentId || inv.studentId;
      if (l.trainingId) keys.add(`${l.trainingId}:${sid}`);
      if (l.kind === 'season' && l.groupId) keys.add(`season:${l.groupId}:${sid}`);
    }
  }
  return keys;
}

/**
 * Membership windows per group: [{ studentId, from: 'YYYY-MM-DD' | null, until: 'YYYY-MM-DD' | null }].
 * `memberships` are the backend's rows ({ groupId, studentId, joinedAt, endedAt, groupCreatedAt }); a group without
 * any falls back to its current members, counted from the start.
 */
export function membershipWindows(groups, memberships) {
  const byGroup = new Map();
  const groupCreated = new Map((groups || []).map((g) => [g.id, g.createdAt || null]));
  for (const m of memberships || []) {
    const created = m.groupCreatedAt || groupCreated.get(m.groupId);
    const joined = m.joinedAt ? dateStr(new Date(m.joinedAt)) : null;
    // the first roster, entered while the group was being set up, counts from the first session
    const initial = !joined || (created && Date.parse(m.joinedAt) - Date.parse(created) < 7 * DAY_MS);
    const list = byGroup.get(m.groupId) || [];
    list.push({ studentId: m.studentId, from: initial ? null : joined, until: m.endedAt ? dateStr(new Date(m.endedAt)) : null });
    byGroup.set(m.groupId, list);
  }
  for (const g of groups || []) {
    if (!byGroup.has(g.id)) byGroup.set(g.id, (g.memberIds || []).map((studentId) => ({ studentId, from: null, until: null })));
  }
  return byGroup;
}

function membersOn(windows, date) {
  return (windows || []).filter((w) => (!w.from || w.from <= date) && (!w.until || w.until > date)).map((w) => w.studentId);
}

function chargedByDefault(kind, biller) {
  if (kind === 'cancelled') return false;
  if (kind === 'late') return biller?.chargeLate !== false;
  if (kind === 'no_show') return biller?.chargeNoShow !== false;
  return true;
}

/**
 * What each player owes for the period: [{ studentId, name, lines, counts, totalCents }] sorted by
 * name, players with nothing left out. Lines: { key, kind, trainingId, groupId, date, time,
 * description, quantity, unitCents, amountCents, charged }. `missingPrivatePrice` is true when a
 * private lesson had no hourly price (those lessons are left out until one is set).
 */
export function billablePlayers({ trainings, groups, students, memberships, biller, from, to, now = new Date(), billed = new Set() }) {
  const groupById = new Map((groups || []).map((g) => [g.id, g]));
  const studentById = new Map((students || []).map((s) => [s.id, s]));
  const windows = membershipWindows(groups, memberships);
  const perStudent = new Map();
  let missingPrivatePrice = false;
  const add = (studentId, line) => {
    if (!studentById.has(studentId)) return;
    const list = perStudent.get(studentId) || [];
    list.push(line);
    perStudent.set(studentId, list);
  };
  const lineFor = (t, studentId, unitCents, quantity, description) => {
    const absence = (t.absences || []).find((a) => a.studentId === studentId);
    const kind = absence ? absenceKind(t, absence, biller?.cancelHours) : 'session';
    return {
      key: `${t.id}:${studentId}`, kind, trainingId: t.id, groupId: t.groupId || null, date: t.date, time: t.time || '',
      description, quantity, unitCents, amountCents: Math.round(unitCents * quantity), charged: chargedByDefault(kind, biller),
    };
  };

  const inRange = (trainings || [])
    .filter((t) => t.loggedBy !== 'player' && t.date >= from && t.date <= to && sessionEnd(t) <= now)
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

  for (const t of inRange) {
    if (t.groupId) {
      const g = groupById.get(t.groupId);
      const price = groupPrice(biller, t.groupId);
      if (!g || !price || price.mode !== 'kerta' || !(price.cents > 0)) continue;
      for (const sid of membersOn(windows.get(t.groupId), t.date)) {
        if (billed.has(`${t.id}:${sid}`)) continue;
        add(sid, lineFor(t, sid, price.cents, 1, g.name));
      }
    } else if (t.studentId) {
      if (billed.has(`${t.id}:${t.studentId}`)) continue;
      const hour = biller?.prices?.privateHourCents;
      if (!(hour > 0)) { missingPrivatePrice = true; continue; }
      const minutes = Number(t.durationMinutes) || 60;
      // one lesson = one line: the price for its length (60 min at 60 €/h = 60 €)
      add(t.studentId, lineFor(t, t.studentId, Math.round((hour * minutes) / 60), 1, `Yksityistunti ${minutes} min`));
    }
  }

  // season fees: once per player per group, for groups that had a session in the period
  for (const g of groups || []) {
    const price = groupPrice(biller, g.id);
    if (!price || price.mode !== 'kausi' || !(price.cents > 0)) continue;
    const held = inRange.filter((t) => t.groupId === g.id);
    if (!held.length) continue;
    const ids = new Set(held.flatMap((t) => membersOn(windows.get(g.id), t.date)));
    for (const sid of ids) {
      if (billed.has(`season:${g.id}:${sid}`)) continue;
      add(sid, {
        key: `season:${g.id}:${sid}`, kind: 'season', trainingId: null, groupId: g.id, date: held[0].date, time: '',
        description: `Kausimaksu: ${g.name}`, quantity: 1, unitCents: price.cents, amountCents: price.cents, charged: true,
      });
    }
  }

  const players = [...perStudent.entries()].map(([studentId, lines]) => {
    const counts = { session: 0, late: 0, no_show: 0, cancelled: 0, season: 0 };
    lines.forEach((l) => { counts[l.kind] = (counts[l.kind] || 0) + 1; });
    return { studentId, name: studentById.get(studentId)?.name || '', lines, counts, totalCents: totalOf(lines) };
  }).sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  return { players, missingPrivatePrice };
}

/** The charged lines' sum. */
export function totalOf(lines) {
  return (lines || []).reduce((sum, l) => sum + (l.charged ? Math.round(Number(l.amountCents) || 0) : 0), 0);
}

/** "8 kertaa · 1 myöhäinen peruutus · 2 peruttu ajoissa" */
export function countsLine(counts) {
  const parts = [];
  if (counts.session) parts.push(`${counts.session} ${counts.session === 1 ? 'kerta' : 'kertaa'}`);
  if (counts.season) parts.push(counts.season === 1 ? 'kausimaksu' : `${counts.season} kausimaksua`);
  if (counts.late) parts.push(`${counts.late} myöhäinen peruutus`.replace(/^(\d+) myöhäinen peruutus$/, (all, n) => (n === '1' ? all : `${n} myöhäistä peruutusta`)));
  if (counts.no_show) parts.push(`${counts.no_show} poissa ilmoittamatta`);
  if (counts.cancelled) parts.push(`${counts.cancelled} peruttu ajoissa`);
  if (counts.manual) parts.push(`${counts.manual} muu rivi${counts.manual === 1 ? '' : 'ä'}`);
  return parts.join(' · ');
}

export function lineCounts(lines) {
  const counts = { session: 0, late: 0, no_show: 0, cancelled: 0, season: 0, manual: 0 };
  (lines || []).forEach((l) => { counts[l.kind] = (counts[l.kind] || 0) + 1; });
  return counts;
}

/** How a line reads on the invoice: "Ti 4.11. 17:00 Aikuiset edistyneet — myöhäinen peruutus". */
export function lineLabel(line) {
  const days = ['Su', 'Ma', 'Ti', 'Ke', 'To', 'Pe', 'La'];
  let when = '';
  if (line.date && line.kind !== 'season' && line.kind !== 'manual') {
    const [y, m, d] = line.date.split('-').map(Number);
    when = `${days[new Date(y, m - 1, d).getDay()]} ${d}.${m}.${line.time ? ` ${line.time.slice(0, 5)}` : ''}`;
  } else if (line.date && line.kind === 'manual') {
    when = fiDate(line.date);
  }
  const extra = line.kind === 'late' || line.kind === 'no_show' || line.kind === 'cancelled' ? ` — ${LINE_KINDS[line.kind].toLowerCase()}` : '';
  return { when, text: `${line.description}${extra}` };
}

// ── invoices ────────────────────────────────────────────────────────────────

/** luonnos | avoin | myohassa | maksettu | mitatoity */
export function invoiceState(inv, today) {
  if (!inv) return 'luonnos';
  if (inv.status === 'draft') return 'luonnos';
  if (inv.status === 'void') return 'mitatoity';
  if (inv.status === 'paid') return 'maksettu';
  return inv.dueDate && inv.dueDate < today ? 'myohassa' : 'avoin';
}

/** Draft rows for the backend from the chosen players: one invoice per player. */
export function draftsFrom(players, { biller, students, from, to }) {
  const byId = new Map((students || []).map((s) => [s.id, s]));
  return (players || []).filter((p) => p.lines.some((l) => l.charged)).map((p) => {
    const payer = payerFor(biller, byId.get(p.studentId) || { id: p.studentId, name: p.name });
    return {
      studentId: p.studentId, payerName: payer.name, payerEmail: payer.email || null, periodStart: from, periodEnd: to,
      lines: p.lines.map((l, i) => ({
        sortOrder: i, kind: l.kind, trainingId: l.trainingId, groupId: l.groupId, date: l.date, time: l.time || '',
        description: l.description, quantity: l.quantity, unitCents: l.unitCents, amountCents: l.amountCents, charged: l.charged,
      })),
    };
  });
}

/** Everything an invoice page shows, from a sent (or draft) invoice. */
export function invoiceDoc(inv) {
  const seller = inv.seller || {};
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
    payer: { name: inv.payerName, email: inv.payerEmail || '', address: inv.payerAddress || '' },
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
  };
}

/** The share text for an invoice link (WhatsApp, e-mail). */
export function invoiceShareText(inv, url) {
  const name = inv.seller?.name || 'Valmentajasi';
  return `Hei! Tässä lasku ${inv.number ? `nro ${inv.number} ` : ''}(${euros(inv.totalCents ?? totalOf(inv.lines))}, eräpäivä ${fiDate(inv.dueDate)}). Näet sen ja maksutiedot täältä: ${url}\n\nTerveisin ${name}`;
}

export const invoiceUrl = (token, origin = 'https://koutsi.krossi.app') => `${origin}/lasku/${token}`;
