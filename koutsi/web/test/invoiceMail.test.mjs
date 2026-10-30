// invoiceMail.test.mjs — the invoice e-mail (supabase/functions/_shared/invoiceMail.ts): a reminder says
// "eräpäivä on" until the due date and "eräpäivä oli" after it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { helsinkiToday, renderInvoiceEmail } from '../../../supabase/functions/_shared/invoiceMail.ts';

const inv = {
  number: 12, totalCents: 24000, dueDate: '2026-11-13', reference: '10120', payerName: 'Sari Laine',
  seller: { name: 'Anna Virtanen Tennis', iban: 'FI2112345600000785' },
};

test('a reminder before or on the due date: "eräpäivä on"; after it: "eräpäivä oli"', () => {
  for (const today of ['2026-11-01', '2026-11-13']) {
    const { text, html } = renderInvoiceEmail(inv, 'https://koutsi.krossi.app/lasku/x', { reminder: true, today });
    assert.match(text, /eräpäivä on 13\.11\.2026\./, today);
    assert.ok(!/eräpäivä oli/.test(html), today);
  }
  const late = renderInvoiceEmail(inv, 'https://koutsi.krossi.app/lasku/x', { reminder: true, today: '2026-11-14' });
  assert.match(late.text, /eräpäivä oli 13\.11\.2026\./);
  assert.match(renderInvoiceEmail(inv, 'https://koutsi.krossi.app/lasku/x').text, /Eräpäivä on 13\.11\.2026\./, 'the invoice itself');
});

test('helsinkiToday: the date in Finland', () => {
  assert.equal(helsinkiToday(new Date('2026-10-30T22:30:00Z')), '2026-10-31', 'past midnight in Helsinki');
  assert.equal(helsinkiToday(new Date('2026-10-30T10:00:00Z')), '2026-10-30');
});
