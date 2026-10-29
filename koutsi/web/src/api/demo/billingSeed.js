// billingSeed.js — Laskutus in Anna's demo season. Her seller details and prices are set (adults per
// session, juniors a season fee, the Friday match night paid on the spot), and the season's first
// weeks are already billed for four players: Maria's and Eetu's invoices are open, Aleksi and Raimo
// have paid. Everything after that, and every other player, is still to bill — "Laskuta" has work.
import { COACH, PLAYER } from './seed.js';
import { addDaysStr, billablePlayers, draftsFrom, referenceFor, totalOf } from '../../domain/billing.js';
import { koutsiTodayStr } from '../../domain/core.js';

export const DEMO_BILLER = {
  id: 'demo-biller', coachId: COACH, name: 'Anna Koskinen Tennis', businessId: '1234567-1', address: 'Kisapuistontie 1\n15110 Lahti',
  email: 'anna@esimerkki.fi', phone: '', iban: 'FI2112345600000785', bic: '', vatMode: 'none', paymentDays: 14,
  cancelHours: 24, chargeLate: true, chargeNoShow: true, terms: '', nextNumber: 1,
  prices: {
    groups: {
      'demo-g-ma-jun': { mode: 'kausi', cents: 24000 },
      'demo-g-ma-kilpa': { mode: 'kausi', cents: 42000 },
      'demo-g-ke-kilpa': { mode: 'ei', cents: 0 },
      'demo-g-ti-aamu': { mode: 'kerta', cents: 2200 },
      'demo-g-ti-aik1': { mode: 'kerta', cents: 2800 },
      'demo-g-ti-aik2': { mode: 'kerta', cents: 2500 },
      'demo-g-ke-jun': { mode: 'kausi', cents: 24000 },
      'demo-g-to-aik': { mode: 'kerta', cents: 2800 },
      'demo-g-to-alkeet': { mode: 'kerta', cents: 2500 },
      'demo-g-pe-kilpa': { mode: 'ei', cents: 0 },
      'demo-g-la-punainen': { mode: 'kausi', cents: 19000 },
    },
    privateHourCents: 6500,
  },
  payers: { 'demo-s-eetu': { name: 'Sari J.', email: 'sari.j@esimerkki.fi' } },
};

/** uuid-shaped, so the demo's links look like the real ones */
const token = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function seedBilling(s) {
  const today = koutsiTodayStr();
  const biller = JSON.parse(JSON.stringify(DEMO_BILLER));
  const season = (s.seasons || [])[0];
  const from = season?.startsOn || addDaysStr(today, -42);
  const to = addDaysStr(today, -15);
  const issued = addDaysStr(today, -14);
  const { players } = billablePlayers({
    trainings: s.trainings, groups: s.groups, students: s.students, memberships: [], biller, from, to, now: new Date(`${to}T23:59:00`),
  });
  const picked = [PLAYER, 'demo-s-aleksi', 'demo-s-raimo', 'demo-s-eetu'];
  const drafts = draftsFrom(players.filter((p) => picked.includes(p.studentId)), { biller, students: s.students, from, to });
  const seller = { name: biller.name, businessId: biller.businessId, address: biller.address, email: biller.email, iban: biller.iban };
  const invoices = drafts.map((d, i) => {
    const number = i + 1;
    const id = `demo-inv-${number}`;
    const paid = d.studentId === 'demo-s-aleksi' || d.studentId === 'demo-s-raimo';
    const lines = d.lines.map((l, j) => ({ ...l, id: `${id}-l${j + 1}`, invoiceId: id, studentId: d.studentId }));
    return {
      id, studentId: d.studentId, status: paid ? 'paid' : 'sent', number, reference: referenceFor(number),
      issueDate: issued, dueDate: addDaysStr(issued, biller.paymentDays), periodStart: from, periodEnd: to,
      payerName: d.payerName, payerEmail: d.payerEmail || '', payerAddress: '', seller, vatMode: biller.vatMode,
      totalCents: totalOf(lines), publicToken: token(number), sentAt: `${issued}T09:00:00.000Z`,
      paidAt: paid ? `${addDaysStr(issued, 3)}T12:00:00.000Z` : null, voidedAt: null, createdAt: `${issued}T08:55:00.000Z`, lines,
    };
  }).reverse();
  biller.nextNumber = drafts.length + 1;
  s.billing = { enabled: true, biller, invoices, tokenSeq: 100 };
  return s;
}
