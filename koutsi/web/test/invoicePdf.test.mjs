// invoicePdf.test.mjs — the invoice as a PDF: supabase/functions/_shared/invoiceDoc.ts and invoicePdf.ts,
// run in Node as they are (type stripping). invoiceDoc.ts is domain/billing.js ported for the edge
// functions, so the two must show the same on the same invoices. The render tests need pdf-lib, which the
// repo doesn't install: they run with PDFLIB=<path to pdf-lib's cjs/index.js or ESM build> (PDF_OUT=<folder>
// keeps the files to look at) and are skipped otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import * as web from '../src/domain/billing.js';
import * as port from '../../../supabase/functions/_shared/invoiceDoc.ts';
import { renderInvoicePdf } from '../../../supabase/functions/_shared/invoicePdf.ts';

const SELLER = {
  name: 'Anna Virtanen Tennis', businessId: '2345670-5', address: 'Rautatienkatu 5 B 12\n15110 Lahti',
  email: 'anna@example.test', phone: '040 123 4567', iban: 'FI2112345600000785', bic: 'NDEAFIHH',
};
const line = (id, sortOrder, kind, date, time, description, amountCents, charged = true) => ({
  id, sortOrder, kind, date, time, description, quantity: 1, unitCents: amountCents, amountCents, charged,
});

/** Sent, no VAT: sessions, a charged late cancellation, two free lines, a manual line. */
const PLAIN = {
  status: 'sent', number: 1042, reference: web.referenceFor(1042), issueDate: '2026-11-02', dueDate: '2026-11-16',
  periodStart: '2026-10-01', periodEnd: '2026-10-31', payerName: 'Sari Mäkinen', payerEmail: 'sari@example.test',
  payerAddress: 'Kauppakatu 12 B 4\n15140 Lahti', seller: SELLER, vatMode: 'none', totalCents: 9500, paidVia: null,
  note: '  Hei Sari! Tässä lokakuun treenit. Kiitos syksystä — nähdään taas kentällä.\n',
  lines: [
    line('l1', 0, 'session', '2026-10-06', '17:00', 'Aikuiset edistyneet', 2500),
    line('l2', 1, 'late', '2026-10-13', '17:00', 'Aikuiset edistyneet', 2500),
    line('l3', 2, 'cancelled', '2026-10-20', '17:00', 'Aikuiset edistyneet', 2500, false),
    line('l4', 3, 'no_show', '2026-10-22', '18:30', 'Aikuiset edistyneet', 2500, false),
    line('l5', 4, 'session', '2026-10-27', '17:00', 'Aikuiset edistyneet', 2500),
    line('l6', 5, 'manual', '2026-10-31', '', 'Pallot (putki)', 2000),
  ],
};

/** Sent, VAT 25,5 %: lines out of order with tied sortOrders, a season fee, a private lesson, a dateless manual line. */
const VAT = {
  ...PLAIN, number: 77, reference: web.referenceFor(77), vatMode: '25.5', payerAddress: null, note: null,
  periodStart: '2026-11-01', periodEnd: '2026-11-30', dueDate: '2026-12-14',
  lines: [
    line('v4', 0, 'session', '2026-11-12', '18:30', 'Juniorit 12–14 v', 2200),
    line('v1', 0, 'session', '2026-11-03', '17:00', 'Juniorit 12–14 v', 2200),
    line('v3', 0, 'session', '2026-11-03', '', 'Yksityistunti 60 min', 6000),
    line('v2', 2, 'season', '2026-11-03', '', 'Kausimaksu: Juniorit 12–14 v', 18000),
    line('v5', 3, 'manual', null, '', 'Mailan jännitys', 2800),
    line('v6', 4, 'no_show', '2026-11-17', '18:30', 'Juniorit 12–14 v', 2200),
    line('v7', 5, 'cancelled', '2026-11-24', '18:30', 'Juniorit 12–14 v', 2200, false),
  ],
};

/** Void, VAT 10 %: no reference, a foreign IBAN (so no virtuaaliviivakoodi), no BIC, lines with keys only. */
const VOID = {
  ...PLAIN, status: 'void', number: 3, reference: null, vatMode: '10', dueDate: null, periodStart: null,
  seller: { ...SELLER, iban: 'de89 3704 0044 0532 0130 00', bic: '' },
  lines: [
    { key: 'k1', kind: 'session', date: '2026-10-08', time: '09:00', description: 'Aamutreeni', quantity: 1, unitCents: 3000, amountCents: 3000, charged: true },
    { key: 'k2', kind: 'late', date: '2026-10-09', time: '09:00', description: 'Aamutreeni', quantity: 1, unitCents: 3000, amountCents: '3000', charged: true },
    { key: 'k3', kind: 'manual', date: '', time: '', description: 'Muu', quantity: 1, unitCents: 0, amountCents: 0, charged: false },
  ],
};

/** Paid, big amounts, a payer name with characters the PDF fonts can't draw. */
const PAID = {
  ...PLAIN, status: 'paid', paidVia: 'stripe', number: 1043, reference: web.referenceFor(1043),
  payerName: 'Žofie Nováková ✓ 🎾', payerAddress: 'Łukasza Wiśniewskiego 4\u202f/\u202f2\n00-001 Warszawa',
  note: 'Kausi on “maksettu” – kiitos!\nAlennus \u221210\u00a0% huomioitu… nähdään\u200b keväällä.',
  lines: [
    line('p1', 0, 'season', '2026-09-01', '', 'Kausimaksu: Kilpajuniorit', 123450),
    line('p2', 1, 'manual', '2026-09-15', '', 'Leiri (Vierumäki) 3\u2011päiväinen', 45000),
  ],
};

const SAMPLES = { PLAIN, VAT, VOID, PAID };

test('invoiceDoc.ts shows what domain/billing.js shows, and the note', () => {
  for (const [name, inv] of Object.entries(SAMPLES)) {
    const ported = port.invoiceDoc(inv);
    const shown = web.invoiceDoc(inv);
    assert.deepEqual(Object.fromEntries(Object.keys(shown).map((k) => [k, ported[k]])), shown, name);
    assert.deepEqual(Object.keys(ported).sort(), [...new Set([...Object.keys(shown), 'note'])].sort(), `${name}: no other fields`);
    assert.equal(ported.note, String(inv.note || '').trim(), name);
  }
  // the samples cover what they claim
  const plain = port.invoiceDoc(PLAIN);
  assert.equal(plain.vat, null);
  assert.equal(plain.vatNote, port.NO_VAT_NOTE);
  assert.equal(plain.freeCount, 2);
  assert.equal(plain.totalText, `95,00\u00a0€`);
  assert.equal(plain.note, 'Hei Sari! Tässä lokakuun treenit. Kiitos syksystä — nähdään taas kentällä.');
  assert.deepEqual(plain.lines.map((l) => l.when), ['Ti 6.10. 17:00', 'Ti 13.10. 17:00', 'Ti 27.10. 17:00', '31.10.2026']);
  assert.equal(plain.lines[1].text, 'Aikuiset edistyneet — myöhäinen peruutus');
  assert.equal(plain.barcode.length, 54);
  const vat = port.invoiceDoc(VAT);
  assert.deepEqual(vat.vat, { rate: 25.5, net: 26614, vat: 6786, gross: 33400 });
  assert.deepEqual(vat.lines.map((l) => l.id), ['v3', 'v1', 'v4', 'v2', 'v5', 'v6']);
  assert.equal(vat.note, '');
  const voided = port.invoiceDoc(VOID);
  assert.equal(voided.reference, '');
  assert.equal(voided.barcode, null);
  assert.equal(voided.iban, 'DE89 3704 0044 0532 0130 00');
  assert.deepEqual(voided.lines.map((l) => l.id), ['k1', 'k2']);
  assert.equal(voided.vat.rate, 10);
  assert.equal(port.invoiceDoc(PAID).totalText, `1\u00a0684,50\u00a0€`);
});

test('the ported helpers match billing.js', () => {
  for (const c of [0, 5, 12000, 123456789, -1250, '1999', null, undefined, 12.6, 'abc']) assert.equal(port.euros(c), web.euros(c), String(c));
  for (const d of ['2026-11-12', '2026-01-05T10:00:00Z', '', null, undefined, '12.11.2026']) assert.equal(port.fiDate(d), web.fiDate(d), String(d));
  for (const r of ['1000123', '10016', '868516259619897', ' 12 34561 ', '', null, 1234561]) {
    assert.equal(port.formatReference(r), web.formatReference(r), String(r));
  }
  for (const i of ['fi21 1234 5600 0007 85', 'FI2112345600000785', 'DE89370400440532013000', '', null]) assert.equal(port.formatIban(i), web.formatIban(i));
  for (const m of ['none', '25.5', '14', '10', 'x', null, undefined]) assert.equal(port.vatRate(m), web.vatRate(m));
  for (const [g, r] of [[12550, 25.5], [10000, 14], [999, 10], [500, 0], [null, 25.5], ['12550', 25.5]]) {
    assert.deepEqual(port.vatBreakdown(g, r), web.vatBreakdown(g, r));
  }
  const iban = 'FI2112345600000785';
  for (const b of [
    { iban, cents: 12550, reference: '10427', dueDate: '2026-11-16' },
    { iban: 'fi21 1234 5600 0007 85', cents: 12550, reference: '10 427', dueDate: null },
    { iban: 'DE89370400440532013000', cents: 100, reference: '10427', dueDate: '2026-11-16' },
    { iban, cents: 0, reference: '10427', dueDate: '2026-11-16' },
    { iban, cents: 99999999, reference: '868516259619897', dueDate: '2026-11-16' },
    { iban, cents: 100000000, reference: '10427', dueDate: '2026-11-16' },
    { iban, cents: 500, reference: 'abc', dueDate: '2026-11-16' },
  ]) assert.equal(port.virtualBarcode(b), web.virtualBarcode(b), JSON.stringify(b));
  const labels = [
    ...['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-03-29', '2026-10-25']
      .map((date) => ({ kind: 'session', date, time: '17:00:00', description: 'Ryhmä' })),
    { kind: 'late', date: '2026-11-03', time: '', description: 'Aikuiset' },
    { kind: 'no_show', date: '2026-11-03', time: '08:15', description: 'Aikuiset' },
    { kind: 'cancelled', date: '2026-11-03', time: '08:15', description: 'Aikuiset' },
    { kind: 'season', date: '2026-11-03', time: '', description: 'Kausimaksu: A' },
    { kind: 'manual', date: '2026-11-03', time: '', description: 'Pallot' },
    { kind: 'manual', date: null, time: '', description: 'Pallot' },
    { kind: 'session', date: '', time: '17:00', description: 'Ilman päivää' },
  ];
  for (const l of labels) assert.deepEqual(port.lineLabel(l), web.lineLabel(l), JSON.stringify(l));
  assert.equal(port.lineLabel(labels[2]).when, 'Ti 3.11. 17:00');
  for (const ls of [PLAIN.lines, VAT.lines, VOID.lines, [], null]) assert.equal(port.totalOf(ls), web.totalOf(ls));
  assert.equal(port.NO_VAT_NOTE, web.NO_VAT_NOTE);
});

// ── rendering (needs PDFLIB) ────────────────────────────────────────────────

const PDFLIB = process.env.PDFLIB || '';
const OUT = process.env.PDF_OUT || '';
const skip = PDFLIB ? false : 'set PDFLIB=<path to pdf-lib/cjs/index.js> to render the PDFs';
let lib = null;
let libError = null;
if (PDFLIB) {
  try {
    lib = await loadPdfLib(PDFLIB);
  } catch (e) {
    libError = e;
  }
}

/** pdf-lib from a file path; its es/ build has extensionless imports Node can't load, so cjs/ or dist/ stand in. */
async function loadPdfLib(spec) {
  const file = resolve(spec);
  const at = file.lastIndexOf(`${sep}pdf-lib${sep}`);
  const root = at >= 0 ? file.slice(0, at + `${sep}pdf-lib`.length) : join(file, 'node_modules', 'pdf-lib');
  for (const p of [file, join(root, 'cjs', 'index.js'), join(root, 'dist', 'pdf-lib.esm.js')]) {
    try {
      const m = await import(pathToFileURL(p).href);
      const mod = m.PDFDocument ? m : m.default;
      if (mod?.PDFDocument) return mod;
    } catch { /* the next one */ }
  }
  throw new Error(`nothing loadable at PDFLIB=${spec}`);
}

/** Renders with just the three exports the edge function passes; keeps the file in PDF_OUT. */
async function render(inv, name, opts) {
  assert.ok(lib, `pdf-lib did not load: ${libError?.message}`);
  const bytes = await renderInvoicePdf({ PDFDocument: lib.PDFDocument, StandardFonts: lib.StandardFonts, rgb: lib.rgb }, inv, opts);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString('latin1'), '%PDF-');
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${name}.pdf`), bytes);
  }
  const pdf = await lib.PDFDocument.load(bytes);
  return { bytes, pdf, pages: drawnText(pdf) };
}

/** The strings each page draws (pdf-lib writes them as <hex> Tj, in WinAnsi). */
function drawnText(pdf) {
  const cp1252 = new TextDecoder('windows-1252');
  return pdf.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof lib.PDFArray ? contents.asArray().map((ref) => pdf.context.lookup(ref)) : [contents];
    const ops = streams.map((s) => {
      const raw = Buffer.from(s.getContents());
      return (String(s.dict.get(lib.PDFName.of('Filter')) || '').includes('FlateDecode') ? inflateSync(raw) : raw).toString('latin1');
    }).join('\n');
    return [...ops.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map((m) => cp1252.decode(Buffer.from(m[1], 'hex')));
  });
}

/** A small RGBA PNG for the logo test (a dark badge, a ball, three bars), made with zlib alone. */
function logoPng(w = 360, h = 120) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const corner = Math.min(x, w - 1 - x) < 16 && Math.min(y, h - 1 - y) < 16
        && (Math.min(x, w - 1 - x) - 16) ** 2 + (Math.min(y, h - 1 - y) - 16) ** 2 > 256;
      const ball = (x - 60) ** 2 + (y - 60) ** 2 < 36 ** 2;
      const bar = x >= 116 && x < 330 && [[34, 50], [62, 72], [80, 88]].some(([a, b]) => y >= a && y < b) && (y < 62 || x < 280);
      const rgba = corner ? [0, 0, 0, 0] : ball ? [196, 228, 58, 255] : bar ? [245, 245, 245, 255] : [24, 24, 24, 255];
      raw.set(rgba, y * stride + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

/** A season's invoice: 45 lines (sessions in three groups, absences, a season fee, a manual line), VAT 25,5 %. */
function seasonInvoice() {
  const groups = ['Aikuiset edistyneet', 'Juniorit 12–14 v',
    'Kilpajuniorit: fysiikka, tekniikka ja ottelupelaaminen Lahden tennishallissa, kentät 3 ja 4'];
  const lines = [];
  for (let i = 0; i < 43; i += 1) {
    const date = new Date(Date.UTC(2026, 7, 31 + Math.floor(i * 2.5))).toISOString().slice(0, 10);
    const kind = i % 11 === 5 ? 'late' : i % 13 === 7 ? 'no_show' : i % 9 === 4 ? 'cancelled' : 'session';
    const cents = 2400 + (i % 3) * 450;
    lines.push(line(`s${i}`, i, kind, date, ['17:00', '18:30', '19:45'][i % 3], groups[i % 3], cents, kind !== 'cancelled' && !(kind === 'no_show' && i % 2)));
  }
  lines.push(line('s43', 43, 'season', '2026-08-31', '', 'Kausimaksu: Kilpajuniorit', 24000));
  lines.push(line('s44', 44, 'manual', '2026-12-18', '', 'Joulucup: osallistumismaksu ja pallot', 3500));
  return {
    ...PLAIN, number: 2001, reference: web.referenceFor(2001), vatMode: '25.5', issueDate: '2026-12-19', dueDate: '2027-01-02',
    periodStart: '2026-08-31', periodEnd: '2026-12-18', payerName: 'Mikko ja Liisa Korhonen (Eetu Korhonen)',
    note: 'Hei! Tässä syyskauden kaikki treenit yhdellä laskulla.\n\nPeruutetut treenit eivät maksa mitään. Kysy rohkeasti, jos jokin rivi näyttää väärältä.',
    lines,
  };
}

test('PDF: a short invoice, one page, everything the app shows', { skip }, async () => {
  const { pdf, pages } = await render(PLAIN, 'lasku-1042-lyhyt');
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getTitle(), 'Lasku 1042 – Anna Virtanen Tennis');
  assert.equal(pdf.getAuthor(), 'Anna Virtanen Tennis');
  const drawn = pages[0];
  const doc = web.invoiceDoc(PLAIN);
  for (const s of ['Anna Virtanen Tennis', 'Rautatienkatu 5 B 12', 'Y-tunnus 2345670-5', 'Sari Mäkinen', '15140 Lahti', 'Yhteensä',
    doc.issueDate, doc.dueDate, doc.reference, doc.period, doc.totalText, doc.iban, doc.bic, doc.barcode, doc.vatNote,
    'Hei Sari! Tässä lokakuun treenit. Kiitos syksystä — nähdään taas kentällä.', 'Lisäksi 2 kertaa ilman veloitusta.',
    ...doc.lines.flatMap((l) => [l.when, l.text, l.amount])]) {
    assert.ok(drawn.includes(s), `draws ${JSON.stringify(s)}`);
  }
  assert.ok(!drawn.join('').includes('MAKSETTU') && !drawn.includes('Veroton'));
});

test('PDF: 45 lines with a logo and VAT flow onto more pages, totals and payment box together', { skip }, async () => {
  const inv = seasonInvoice();
  assert.equal(inv.lines.length, 45);
  const { bytes, pdf, pages } = await render(inv, 'lasku-2001-pitka-logo-alv', { logo: { bytes: logoPng(), type: 'png' } });
  assert.ok(pdf.getPageCount() >= 2, `pages: ${pdf.getPageCount()}`);
  assert.ok(Buffer.from(bytes).toString('latin1').includes('/Subtype /Image'), 'the logo is in');
  const doc = web.invoiceDoc(inv);
  const all = pages.flat();
  const whens = doc.lines.map((l) => l.when).filter(Boolean);
  assert.equal(doc.lines.length + doc.freeCount, 45);
  assert.equal(whens.length, doc.lines.length - 1, 'every charged row but the season fee has a date');
  for (const w of whens) assert.ok(all.includes(w), `row ${w}`);
  assert.equal(all.filter((s) => whens.includes(s)).length, whens.length, 'every row once');
  assert.ok(all.includes('Kausimaksu: Kilpajuniorit'));
  pages.slice(1).forEach((p, i) => {
    assert.ok(p.includes('Lasku 2001 (jatkuu)'), `continuation header on page ${i + 2}`);
    assert.ok(p.includes(`Sivu ${i + 2}/${pages.length}`));
  });
  const last = pages.at(-1);
  for (const s of ['Veroton', web.euros(doc.vat.net), 'ALV 25,5 %', web.euros(doc.vat.vat), 'Yhteensä', doc.totalText, doc.iban, doc.barcode]) {
    assert.ok(last.includes(s), `last page draws ${JSON.stringify(s)}`);
  }
  assert.ok(!all.includes(web.NO_VAT_NOTE));
});

test('PDF: paid, a name outside WinAnsi gets stand-ins instead of an error', { skip }, async () => {
  const { pdf, pages } = await render(PAID, 'lasku-1043-maksettu');
  assert.equal(pdf.getTitle(), 'Lasku 1043 – Anna Virtanen Tennis');
  const drawn = pages.flat();
  assert.ok(drawn.join('').includes('MAKSETTU'), 'the stamp');
  for (const s of ['Žofie Nováková ? ?', 'Lukasza Wisniewskiego 4\u00a0/\u00a02', 'Kausi on “maksettu” – kiitos!',
    'Alennus -10\u00a0% huomioitu… nähdään keväällä.', 'Leiri (Vierumäki) 3-päiväinen', `1\u00a0684,50\u00a0€`]) {
    assert.ok(drawn.includes(s), `draws ${JSON.stringify(s)}`);
  }
  assert.ok(drawn.includes('Tilinumero'), 'a paid invoice still shows where it was paid to');
  assert.ok(!drawn.includes(web.invoiceDoc(PAID).barcode), 'no virtuaaliviivakoodi once paid');
});

test('PDF: void, the stamp and no payment box', { skip }, async () => {
  const { pages } = await render(VOID, 'lasku-3-mitatoity');
  const drawn = pages.flat();
  assert.ok(drawn.join('').includes('MITÄTÖITY'));
  assert.ok(!drawn.includes('Tilinumero') && !drawn.join('').includes('MAKSUTIEDOT'));
  assert.ok(drawn.includes('ALV 10 %') && drawn.includes('Aamutreeni — myöhäinen peruutus'));
});
