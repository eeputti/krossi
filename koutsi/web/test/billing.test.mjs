// billing.test.mjs — Laskutus (domain/billing.js): money, Finnish bank details, late cancellations,
// who owes what for a period, and what an invoice shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  absenceKind, billablePlayers, billedKeys, lateCancelNote, billerMissing, canPayKlarna, canPayOnline, centsToInput, countsLine, deliveryOf,
  draftsFrom, euros, formatIban, formatReference, invoiceDoc, invoiceGroups, invoiceState, lineCounts, membershipWindows, parseEuros,
  payCost, payCostRate, periodPresets, referenceCheckDigit, referenceFor, termsText, totalOf, validBusinessId, validIban, validReference,
  vatBreakdown, virtualBarcode, NO_VAT_NOTE,
} from '../src/domain/billing.js';

const NBSP = ' ';
/** A local wall-clock time as the ISO timestamp the database would hold. */
const at = (date, time) => new Date(`${date}T${time}:00`).toISOString();

test('euros, parseEuros and centsToInput', () => {
  assert.equal(euros(12000), `120,00${NBSP}€`);
  assert.equal(euros(5), `0,05${NBSP}€`);
  assert.equal(euros(123456789), `1${NBSP}234${NBSP}567,89${NBSP}€`);
  assert.equal(parseEuros('30'), 3000);
  assert.equal(parseEuros('30,5'), 3050);
  assert.equal(parseEuros('1 200,00 €'), 120000);
  assert.equal(parseEuros('29.90'), 2990);
  assert.equal(parseEuros(''), null);
  assert.equal(parseEuros('abc'), null);
  assert.equal(parseEuros('30,555'), null);
  assert.equal(parseEuros('-5'), null);
  assert.equal(centsToInput(3000), '30');
  assert.equal(centsToInput(3050), '30,50');
  assert.equal(centsToInput(null), '');
});

test('viitenumero: 7-3-1 check digit, built from the invoice number, printed in fives', () => {
  assert.equal(referenceCheckDigit('123456'), 1);
  assert.ok(validReference('1234561'));
  assert.ok(!validReference('1234562'));
  assert.equal(referenceFor(1), '10016');
  assert.equal(referenceFor(42), '10427');
  assert.ok(validReference(referenceFor(1)) && validReference(referenceFor(12345)));
  assert.equal(formatReference('1234561'), '12 34561');
  assert.equal(formatReference('868516259619897'), '86851 62596 19897');
});

test('IBAN, Y-tunnus', () => {
  assert.ok(validIban('FI21 1234 5600 0007 85'));
  assert.ok(!validIban('FI21 1234 5600 0007 86'));
  assert.ok(!validIban('FI21 1234'));
  assert.equal(formatIban('fi2112345600000785'), 'FI21 1234 5600 0007 85');
  assert.ok(validBusinessId('3413406-6'));
  assert.ok(validBusinessId('0112038-9'));
  assert.ok(!validBusinessId('0112038-8'));
  assert.ok(!validBusinessId('112038-9'));
});

test('pankkiviivakoodi version 4 (the banks\' own example)', () => {
  assert.equal(
    virtualBarcode({ iban: 'FI79 4405 2020 0360 82', cents: 488315, reference: '86851 62596 19897', dueDate: '2010-06-12' }),
    '479440520200360820048831500000000868516259619897100612',
  );
  assert.equal(virtualBarcode({ iban: 'DE89370400440532013000', cents: 1000, reference: '10016', dueDate: '2026-11-12' }), null, 'only Finnish accounts');
  assert.equal(virtualBarcode({ iban: 'FI2112345600000785', cents: 0, reference: '10016' }), null, 'nothing to pay');
  assert.equal(virtualBarcode({ iban: 'FI2112345600000785', cents: 3000, reference: '10016' }).length, 54);
});

test('vatBreakdown splits a VAT-inclusive price', () => {
  assert.deepEqual(vatBreakdown(12550, 25.5), { net: 10000, vat: 2550, gross: 12550 });
  assert.deepEqual(vatBreakdown(3000, 0), { net: 3000, vat: 0, gross: 3000 });
  assert.deepEqual(vatBreakdown(11400, 14), { net: 10000, vat: 1400, gross: 11400 });
});

test('absenceKind: in time, late, or no word at all', () => {
  const t = { date: '2026-11-03', time: '17:00', durationMinutes: 60 };
  const a = (reportedAt, reportedBy = 's1') => ({ studentId: 's1', reportedBy, reportedAt });
  assert.equal(absenceKind(t, a(at('2026-11-01', '17:00')), 24), 'cancelled');
  assert.equal(absenceKind(t, a(at('2026-11-02', '17:00')), 24), 'cancelled', 'exactly 24 h before is in time');
  assert.equal(absenceKind(t, a(at('2026-11-03', '07:00')), 24), 'late');
  assert.equal(absenceKind(t, a(at('2026-11-03', '07:00'), 'coach'), 24), 'late', 'the coach marking it before the start is a cancellation');
  assert.equal(absenceKind(t, a(at('2026-11-03', '17:30')), 24), 'late', 'the player saying it after the start');
  assert.equal(absenceKind(t, a(at('2026-11-03', '18:10'), 'coach'), 24), 'no_show');
  assert.equal(absenceKind(t, a(at('2026-11-03', '16:00')), 0), 'cancelled', 'no limit: every cancellation is in time');
  assert.equal(absenceKind(t, { studentId: 's1' }, 24), 'cancelled', 'an unknown time is the player\'s benefit');
});

const biller = {
  name: 'Anna Virtanen Tennis', iban: 'FI2112345600000785', cancelHours: 24, chargeLate: true, chargeNoShow: true,
  prices: { groups: { g1: { mode: 'kerta', cents: 3000 }, g2: { mode: 'kausi', cents: 28000 }, g3: { mode: 'ei', cents: 0 } }, privateHourCents: 6000 },
  payers: { s3: { name: 'Pirjo Laine', email: 'pirjo@example.test' } },
};
const students = [
  { id: 's1', name: 'Aatu Laine' }, { id: 's2', name: 'Bea Koski' }, { id: 's3', name: 'Cecilia Laine' }, { id: 's4', name: 'Daniel Ek' },
];
const groups = [
  { id: 'g1', name: 'Aikuiset', memberIds: ['s1', 's2', 's4'], createdAt: at('2026-08-20', '12:00') },
  { id: 'g2', name: 'Juniorit', memberIds: ['s3'], createdAt: at('2026-08-20', '12:00') },
  { id: 'g3', name: 'Perjantaipelit', memberIds: ['s1'], createdAt: at('2026-08-20', '12:00') },
];
const session = (id, groupId, date, extra = {}) => ({ id, groupId, studentId: null, date, time: '17:00', durationMinutes: 60, loggedBy: 'coach', absences: [], ...extra });
const now = new Date('2026-11-20T12:00:00');

function world() {
  return {
    trainings: [
      session('t1', 'g1', '2026-11-03', { absences: [{ studentId: 's2', reportedBy: 's2', reportedAt: at('2026-11-03', '09:00') }] }),
      session('t2', 'g1', '2026-11-10', { absences: [{ studentId: 's2', reportedBy: 's2', reportedAt: at('2026-11-07', '09:00') }] }),
      session('t3', 'g1', '2026-11-17', { absences: [{ studentId: 's1', reportedBy: 'coach', reportedAt: at('2026-11-17', '18:20') }] }),
      session('t4', 'g1', '2026-11-24'), // not held yet
      session('t5', 'g2', '2026-11-05'),
      session('t6', 'g3', '2026-11-07'),
      { id: 'p1', groupId: null, studentId: 's4', date: '2026-11-12', time: '15:30', durationMinutes: 90, loggedBy: 'coach', absences: [] },
      { id: 'own', groupId: null, studentId: 's1', date: '2026-11-12', time: '07:00', durationMinutes: 45, loggedBy: 'player', absences: [] },
    ],
    groups,
    students,
    memberships: [
      { groupId: 'g1', studentId: 's1', joinedAt: at('2026-08-21', '10:00'), endedAt: null },
      { groupId: 'g1', studentId: 's2', joinedAt: at('2026-08-21', '10:00'), endedAt: null },
      // joined the group mid-season: billed from the day after joining
      { groupId: 'g1', studentId: 's4', joinedAt: at('2026-11-08', '10:00'), endedAt: null },
      { groupId: 'g2', studentId: 's3', joinedAt: at('2026-08-21', '10:00'), endedAt: null },
      { groupId: 'g3', studentId: 's1', joinedAt: at('2026-08-21', '10:00'), endedAt: null },
    ],
    biller,
    from: '2026-11-01',
    to: '2026-11-30',
    now,
  };
}

test('billablePlayers: sessions held, late cancellations, no-shows, private lessons and season fees', () => {
  const { players, missingPrivatePrice } = billablePlayers(world());
  assert.equal(missingPrivatePrice, false);
  assert.deepEqual(players.map((p) => p.name), ['Aatu Laine', 'Bea Koski', 'Cecilia Laine', 'Daniel Ek']);
  const by = Object.fromEntries(players.map((p) => [p.studentId, p]));

  // Aatu: t1, t2 present, t3 marked absent by the coach after the start; t4 not held; g3 is not billed
  assert.deepEqual(by.s1.lines.map((l) => [l.trainingId, l.kind, l.charged, l.amountCents]),
    [['t1', 'session', true, 3000], ['t2', 'session', true, 3000], ['t3', 'no_show', true, 3000]]);
  assert.equal(by.s1.totalCents, 9000);

  // Bea: late on t1 (charged), in time on t2 (not), present on t3
  assert.deepEqual(by.s2.lines.map((l) => [l.trainingId, l.kind, l.charged]), [['t1', 'late', true], ['t2', 'cancelled', false], ['t3', 'session', true]]);
  assert.equal(by.s2.totalCents, 6000);
  assert.equal(countsLine(by.s2.counts), '1 kerta, 1 myöhäinen peruutus, 1 peruttu ajoissa');

  // Cecilia: the junior group's season fee, once
  assert.deepEqual(by.s3.lines.map((l) => [l.kind, l.description, l.amountCents]), [['season', 'Kausimaksu: Juniorit', 28000]]);

  // Daniel: joined on 8.11. → only the 10.11. and 17.11. sessions, plus a 90 min private lesson at 60 €/h
  assert.deepEqual(by.s4.lines.map((l) => [l.trainingId, l.amountCents]), [['t2', 3000], ['p1', 9000], ['t3', 3000]]);
  assert.equal(by.s4.lines.find((l) => l.trainingId === 'p1').description, 'Yksityistunti 90 min');
});

test('billablePlayers: what is already on an invoice is not billed again; the coach\'s choices count', () => {
  const w = world();
  const invoices = [
    { status: 'sent', studentId: 's1', lines: [{ trainingId: 't1', kind: 'session' }, { trainingId: 't2', kind: 'session' }] },
    { status: 'draft', studentId: 's3', lines: [{ trainingId: null, groupId: 'g2', kind: 'season' }] },
    { status: 'void', studentId: 's2', lines: [{ trainingId: 't1', kind: 'late' }] },
  ];
  const billed = billedKeys(invoices);
  assert.ok(billed.has('t1:s1') && billed.has('season:g2:s1') === false && billed.has('season:g2:s3'));
  assert.ok(!billed.has('t1:s2'), 'a void invoice frees its sessions');
  const { players } = billablePlayers({ ...w, billed });
  const by = Object.fromEntries(players.map((p) => [p.studentId, p]));
  assert.deepEqual(by.s1.lines.map((l) => l.trainingId), ['t3']);
  assert.equal(by.s3, undefined);
  assert.deepEqual(by.s2.lines.map((l) => l.trainingId), ['t1', 't2', 't3']);

  const lenient = billablePlayers({ ...w, biller: { ...biller, chargeLate: false, chargeNoShow: false } }).players;
  const lb = Object.fromEntries(lenient.map((p) => [p.studentId, p]));
  assert.equal(lb.s1.lines.find((l) => l.trainingId === 't3').charged, false);
  assert.equal(lb.s2.lines.find((l) => l.trainingId === 't1').charged, false);

  const noPrivate = billablePlayers({ ...w, biller: { ...biller, prices: { ...biller.prices, privateHourCents: null } } });
  assert.equal(noPrivate.missingPrivatePrice, true);
  assert.ok(!noPrivate.players.find((p) => p.studentId === 's4').lines.some((l) => l.trainingId === 'p1'));
});

test('membershipWindows: the first roster counts from the start, later ones from joining, until leaving', () => {
  const w = membershipWindows(groups, [
    { groupId: 'g1', studentId: 'a', joinedAt: at('2026-08-25', '10:00'), endedAt: null },
    { groupId: 'g1', studentId: 'b', joinedAt: at('2026-10-01', '10:00'), endedAt: at('2026-11-01', '10:00') },
  ]);
  assert.deepEqual(w.get('g1'), [{ studentId: 'a', from: null, until: null }, { studentId: 'b', from: '2026-10-01', until: '2026-11-01' }]);
  assert.deepEqual(w.get('g2'), [{ studentId: 's3', from: null, until: null }], 'no rows: the current members');
});

test('draftsFrom: one invoice per player with something to charge, paid by whoever the coach wrote down', () => {
  const { players } = billablePlayers(world());
  const lonely = { studentId: 's9', name: 'Nobody', lines: [{ kind: 'cancelled', charged: false, amountCents: 3000 }] };
  const drafts = draftsFrom([...players, lonely], { biller, students, from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(drafts.map((d) => [d.studentId, d.payerName, d.payerEmail]), [
    ['s1', 'Aatu Laine', null], ['s2', 'Bea Koski', null], ['s3', 'Pirjo Laine', 'pirjo@example.test'], ['s4', 'Daniel Ek', null],
  ]);
  assert.equal(totalOf(drafts[1].lines), 6000);
  assert.deepEqual(lineCounts(drafts[1].lines), { session: 1, late: 1, no_show: 0, cancelled: 1, season: 0, manual: 0 });
});

test('invoiceState and invoiceDoc', () => {
  const inv = {
    status: 'sent', number: 7, reference: referenceFor(7), issueDate: '2026-11-20', dueDate: '2026-12-04',
    periodStart: '2026-11-01', periodEnd: '2026-11-30', payerName: 'Bea Koski', vatMode: 'none',
    seller: { name: 'Anna Virtanen Tennis', iban: 'FI2112345600000785', businessId: '3413406-6' },
    lines: [
      { id: 'l1', sortOrder: 0, kind: 'late', description: 'Aikuiset', date: '2026-11-03', time: '17:00', amountCents: 3000, charged: true },
      { id: 'l2', sortOrder: 1, kind: 'cancelled', description: 'Aikuiset', date: '2026-11-10', time: '17:00', amountCents: 3000, charged: false },
      { id: 'l3', sortOrder: 2, kind: 'session', description: 'Aikuiset', date: '2026-11-17', time: '17:00', amountCents: 3000, charged: true },
    ],
  };
  assert.equal(invoiceState(inv, '2026-11-25'), 'avoin');
  assert.equal(invoiceState(inv, '2026-12-05'), 'myohassa');
  assert.equal(invoiceState({ ...inv, status: 'paid' }, '2026-12-05'), 'maksettu');
  assert.equal(invoiceState({ ...inv, status: 'void' }, '2026-12-05'), 'mitatoity');
  assert.equal(invoiceState({ status: 'draft' }, '2026-12-05'), 'luonnos');

  const doc = invoiceDoc(inv);
  assert.equal(doc.total, 6000);
  assert.equal(doc.totalText, `60,00${NBSP}€`);
  assert.equal(doc.lines.length, 2);
  assert.equal(doc.freeCount, 1);
  assert.equal(doc.lines[0].text, 'Aikuiset — myöhäinen peruutus');
  assert.equal(doc.lines[0].when, 'Ti 3.11. 17:00');
  assert.equal(doc.vat, null);
  assert.equal(doc.vatNote, NO_VAT_NOTE);
  assert.equal(doc.dueDate, '4.12.2026');
  assert.equal(doc.reference, formatReference(referenceFor(7)));
  assert.equal(doc.iban, 'FI21 1234 5600 0007 85');
  assert.equal(doc.barcode.length, 54);

  const vatDoc = invoiceDoc({ ...inv, vatMode: '25.5' });
  assert.deepEqual(vatDoc.vat, { rate: 25.5, net: 4781, vat: 1219, gross: 6000 });
  assert.equal(vatDoc.vatNote, '');
});

test('periodPresets, termsText and billerMissing', () => {
  const p = periodPresets('2026-11-20', { name: 'Syksy 2026', startsOn: '2026-08-24' });
  assert.deepEqual(p.map((x) => [x.value, x.from, x.to]), [
    ['kausi', '2026-08-24', '2026-11-20'], ['kuu', '2026-11-01', '2026-11-20'], ['edellinen', '2026-10-01', '2026-10-31'],
  ]);
  assert.equal(p[2].label, 'Lokakuu');
  assert.deepEqual(periodPresets('2026-01-10').map((x) => [x.value, x.from, x.to]), [['kuu', '2026-01-01', '2026-01-10'], ['edellinen', '2025-12-01', '2025-12-31']]);

  assert.match(termsText({ cancelHours: 24, chargeLate: true, chargeNoShow: true, paymentDays: 14 }), /viimeistään 24 tuntia ennen/);
  assert.equal(termsText({ terms: '  Omat ehdot.  ', cancelHours: 24 }), 'Omat ehdot.');

  assert.equal(billerMissing(null), 'Täytä laskuttajan tiedot.');
  assert.equal(billerMissing({ name: 'A', iban: 'FI2112345600000785' }), '');
  assert.match(billerMissing({ name: 'A', iban: 'FI21' }), /IBAN/);
  assert.match(billerMissing({ name: 'A', iban: 'FI2112345600000785', businessId: '123' }), /Y-tunnus/);
});

test('lateCancelNote: only inside the coach limit, only when late ones are charged', () => {
  const t = { coachId: 'c1', date: '2026-11-03', time: '17:00' };
  const terms = [{ coachId: 'c1', cancelHours: 24, chargeLate: true }];
  assert.equal(lateCancelNote(terms, t, new Date('2026-11-03T08:00:00')), 'Alle 24 h ennen peruttu treeni laskutetaan.');
  assert.equal(lateCancelNote(terms, t, new Date('2026-11-01T08:00:00')), '');
  assert.equal(lateCancelNote([{ ...terms[0], chargeLate: false }], t, new Date('2026-11-03T08:00:00')), '');
  assert.equal(lateCancelNote(terms, { ...t, coachId: 'other' }, new Date('2026-11-03T08:00:00')), '', 'another coach has no terms');
  assert.equal(lateCancelNote([], t), '');
});

test('the demo season: four invoices already sent, the rest still to bill, nothing billed twice', async () => {
  const { seed, PLAYER } = await import('../src/api/demo/seed.js');
  const { seedBilling } = await import('../src/api/demo/billingSeed.js');
  const s = seedBilling(seed());
  const { biller, invoices } = s.billing;
  assert.equal(invoices.length, 4);
  assert.deepEqual(invoices.map((x) => x.number).sort((a, b) => a - b), [1, 2, 3, 4]);
  assert.equal(biller.nextNumber, 5);
  const maria = invoices.find((x) => x.studentId === PLAYER);
  assert.equal(maria.status, 'sent');
  assert.equal(maria.totalCents, totalOf(maria.lines));
  assert.ok(maria.lines.some((l) => l.kind === 'late'), 'her late cancellation is on it');
  for (const inv of invoices) assert.ok(validReference(inv.reference), inv.reference);
  const billed = billedKeys(invoices);
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const to = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const { players } = billablePlayers({ trainings: s.trainings, groups: s.groups, students: s.students, memberships: [], biller, from: s.seasons[0].startsOn, to, billed });
  assert.ok(players.length > 20, 'most players still to bill');
  for (const p of players) for (const l of p.lines) assert.ok(!billed.has(l.key), `${l.key} billed twice`);
});

test('deliveryOf: where an invoice goes, before it is sent', () => {
  const player = { id: 's1', name: 'Aatu Laine', isPlaceholder: false };
  const nameOnly = { id: 's2', name: 'Eetu J.', isPlaceholder: true };
  assert.deepEqual(deliveryOf({ payerName: 'Aatu Laine', payerEmail: 'aatu@example.test' }, player), { kind: 'email', payer: '', email: 'aatu@example.test' });
  assert.deepEqual(deliveryOf({ payerName: 'Sari J.', payerEmail: 'sari@example.test' }, nameOnly), { kind: 'email', payer: 'Sari J.', email: 'sari@example.test' }, 'a guardian pays');
  assert.deepEqual(deliveryOf({ payerName: 'Aatu Laine', payerEmail: '' }, player), { kind: 'account', payer: '', email: '' }, 'the e-mail of the player\'s own account');
  assert.deepEqual(deliveryOf({ payerName: 'Sari L.', payerEmail: '' }, player), { kind: 'account', payer: 'Sari L.', email: '' });
  assert.equal(deliveryOf({ payerName: 'Aatu Laine', mailedAt: '2026-10-29T10:00:00Z', mailTo: null }, player).kind, 'account', 'sent to the account: the address stays hidden');
  assert.deepEqual(deliveryOf({ payerName: 'Eetu J.', payerEmail: null }, nameOnly), { kind: 'none', payer: '', email: '' }, 'reaches no one');
  assert.equal(deliveryOf({ payerName: 'Aatu Laine', payerEmail: 'uusi@example.test', mailedAt: '2026-10-29T10:00:00Z', mailTo: 'vanha@example.test' }, player).email, 'vanha@example.test', 'a sent one: where it went');
  assert.equal(deliveryOf({ payerName: 'X', payerEmail: '' }, null).kind, 'none');
});

test('invoiceGroups: the groups on the invoice, private lessons, or the player\'s groups', () => {
  const groups = [{ id: 'g1', name: 'Juniorit vihreä', memberIds: ['s1'] }, { id: 'g2', name: 'Aikuiset', memberIds: ['s1', 's2'] }, { id: 'g3', name: 'Aikuiset', memberIds: [] }];
  assert.equal(invoiceGroups({ studentId: 's1', lines: [{ groupId: 'g1' }, { groupId: 'g1' }] }, groups), 'Juniorit vihreä');
  assert.equal(invoiceGroups({ studentId: 's2', lines: [{ groupId: 'g2' }, { groupId: 'g3' }] }, groups), 'Aikuiset', 'same name once');
  assert.equal(invoiceGroups({ studentId: 's2', lines: [{ trainingId: 't1', groupId: null }] }, groups), 'Yksityistunnit');
  assert.equal(invoiceGroups({ studentId: 's1', lines: [{ kind: 'manual' }] }, groups), 'Juniorit vihreä, Aikuiset');
  assert.equal(invoiceGroups({ studentId: 's9', lines: [] }, groups), '');
});

test('payCost / payCostRate: what the coach is told an online payment costs', () => {
  assert.equal(payCost(10000), 211, '1,75 % + 0,36 €');
  assert.equal(payCost(10000, 'klarna'), 364, '3,24 % + 0,40 €');
  assert.equal(payCost(10), 10, 'never more than the payment');
  assert.equal(payCostRate(), `1,75${NBSP}% + 0,36${NBSP}€`);
  assert.equal(payCostRate('klarna'), `3,24${NBSP}% + 0,40${NBSP}€`);
});

test('canPayKlarna: online payment on, and the coach\'s account takes Klarna', () => {
  const inv = { status: 'sent', totalCents: 24000, coachId: 'c1' };
  assert.equal(canPayKlarna(inv, [{ coachId: 'c1', payOnline: true, klarna: true }]), true);
  assert.equal(canPayKlarna(inv, [{ coachId: 'c1', payOnline: true, klarna: false }]), false);
  assert.equal(canPayKlarna(inv, [{ coachId: 'c1', payOnline: false, klarna: true }]), false);
  assert.equal(canPayKlarna({ ...inv, status: 'paid' }, [{ coachId: 'c1', payOnline: true, klarna: true }]), false);
  assert.equal(canPayOnline(inv, [{ coachId: 'c1', payOnline: true }]), true);
});
