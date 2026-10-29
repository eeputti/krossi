// _shared/invoicePdf.ts — one invoice as an A4 PDF with the content of the app's InvoiceView.jsx:
// the seller (or their logo), LASKU + number, dates and viitenumero, the payer, the coach's note,
// the charged lines, totals (VAT split or the AVL 3 § note) and the payment details. pdf-lib comes
// in as `lib` (the edge function passes npm:pdf-lib@1.17.1, the tests a local copy), so the only
// import is ./invoiceDoc.ts and Node runs this file as it is. Long invoices flow onto more pages;
// the totals and the payment box stay together.
import { euros, invoiceDoc, type Invoice } from './invoiceDoc.ts';

export interface InvoiceLogo {
  bytes: Uint8Array;
  type: 'png' | 'jpg';
}

export interface InvoicePdfOptions {
  /** The seller's logo, fitted into 150 × 56 pt at the top left; without one the seller's name is the header. */
  logo?: InvoiceLogo | null;
}

// pdf-lib's module ({ PDFDocument, StandardFonts, rgb }) and its objects, typed loosely so this
// file needs no pdf-lib types.
// deno-lint-ignore no-explicit-any
type Lib = any;
// deno-lint-ignore no-explicit-any
type Obj = any;

interface Style {
  font: Obj;
  size: number;
  color: Obj;
  /** Extra space between letters (pt), for the small capitals; kept under 0.1 em so text extraction still sees one word. */
  track?: number;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const LEFT = MARGIN;
const RIGHT = A4[0] - MARGIN;
const WIDTH = RIGHT - LEFT;
const TOP = A4[1] - MARGIN;
const BOTTOM = MARGIN;
const LOGO_W = 150;
const LOGO_H = 56;
const CONTINUED_H = 31; // a continuation page's small header

// ── WinAnsi-safe text ───────────────────────────────────────────────────────
// The standard fonts encode only WinAnsi and pdf-lib throws on anything else, so every string is
// made drawable first: what the font can't encode gets a stand-in, its letter without accents
// (ś → s), or '?'. Finnish letters, €, –, ·, § and the no-break space are WinAnsi and stay.

// Used only where the font lacks the character (Helvetica has the curly quotes and the ellipsis).
const STAND_INS: Record<string, string> = {
  '\u2212': '-', '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2015': '-', '\u2043': '-', // minus, hyphens, dashes
  '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u201f': '"', '\u2033': '"',
  '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'", '\u2032': "'",
  '\u2026': '...', '\u202f': '\u00a0', '\u2007': '\u00a0', // narrow and figure spaces stay unbreakable
  'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'ı': 'i', 'Ħ': 'H', 'ħ': 'h',
};
// Invisible characters are dropped: combining marks, zero-width joiners, soft hyphens, controls, skin tones.
const INVISIBLE = /^[\p{M}\p{Cf}\p{Cc}\u{1F3FB}-\u{1F3FF}]$/u;

function textTools() {
  const drawable = new Map<Obj, Map<string, string>>();
  const advance = new Map<Obj, Map<string, number>>();
  const cacheFor = <T>(all: Map<Obj, Map<string, T>>, font: Obj): Map<string, T> => {
    let cache = all.get(font);
    if (!cache) all.set(font, (cache = new Map<string, T>()));
    return cache;
  };
  const encodes = (font: Obj, s: string): boolean => {
    try {
      font.encodeText(s);
      return true;
    } catch {
      return false;
    }
  };
  const standIn = (font: Obj, ch: string): string => {
    if (ch === '\t' || ch === '\n' || ch === '\r') return ' ';
    if (INVISIBLE.test(ch)) return '';
    if (encodes(font, ch)) return ch;
    const mapped = STAND_INS[ch] ?? (/\p{Z}/u.test(ch) ? ' ' : /\p{Pd}/u.test(ch) ? '-' : '');
    if (mapped && encodes(font, mapped)) return mapped;
    const bare = ch.normalize('NFD').replace(/\p{M}/gu, '');
    return bare && bare !== ch && encodes(font, bare) ? bare : '?';
  };

  /** `value` as text the font can draw (checked per character, once). */
  const clean = (font: Obj, value: unknown): string => {
    const cache = cacheFor(drawable, font);
    let out = '';
    for (const ch of String(value ?? '').normalize('NFC')) {
      let s = cache.get(ch);
      if (s === undefined) cache.set(ch, (s = standIn(font, ch)));
      out += s;
    }
    return out;
  };

  /** The drawn width of clean text. Summed per character: drawText doesn't kern, widthOfTextAtSize does. */
  const width = (st: Style, text: string): number => {
    const cache = cacheFor(advance, st.font);
    let units = 0;
    let count = 0;
    for (const ch of text) {
      let w = cache.get(ch);
      if (w === undefined) {
        try {
          w = Number(st.font.widthOfTextAtSize(ch, 1000)) || 0;
        } catch {
          w = 0;
        }
        cache.set(ch, w);
      }
      units += w;
      count += 1;
    }
    return (units * st.size) / 1000 + (st.track || 0) * Math.max(0, count - 1);
  };

  /** `value` wrapped to `max` pt, one clean string per line; its line breaks start new lines (blank ones kept with `blank`). */
  const wrap = (st: Style, value: unknown, max: number, blank = false): string[] => {
    const out: string[] = [];
    for (const para of String(value ?? '').split(/\r\n|\r|\n/)) {
      const words = clean(st.font, para).split(' ').filter(Boolean);
      if (!words.length) {
        if (blank) out.push('');
        continue;
      }
      let line = '';
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (width(st, next) <= max) {
          line = next;
          continue;
        }
        if (line) out.push(line);
        line = '';
        for (const ch of word) { // a word wider than the line is split
          if (line && width(st, line + ch) > max) {
            out.push(line);
            line = '';
          }
          line += ch;
        }
      }
      out.push(line);
    }
    return out;
  };

  return { clean, width, wrap };
}

/** The baseline of a line box `lh` tall whose top is at `top`. */
const baseline = (top: number, st: Style, lh: number): number => top - lh / 2 - st.size * 0.32;

/** The logo as a pdf-lib image (its bytes decide PNG vs JPEG), or null: a broken logo never stops the invoice. */
async function embedLogo(pdf: Obj, logo: InvoiceLogo | null | undefined): Promise<Obj | null> {
  const b = logo?.bytes;
  if (!b || !b.length) return null;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const jpg = b[0] === 0xff && b[1] === 0xd8;
  try {
    const image = png || (!jpg && logo?.type === 'png') ? await pdf.embedPng(b) : await pdf.embedJpg(b);
    return image && image.width > 0 && image.height > 0 ? image : null;
  } catch {
    return null;
  }
}

// ── the document ────────────────────────────────────────────────────────────

/**
 * The invoice as PDF bytes. `lib` is pdf-lib ({ PDFDocument, StandardFonts, rgb }); `inv` is the
 * invoice as koutsi_invoice_public() returns it; `opts.logo` the seller's logo (PNG or JPEG).
 */
export async function renderInvoicePdf(lib: Lib, inv: Invoice, opts: InvoicePdfOptions = {}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = lib;
  const doc = invoiceDoc(inv);
  const sellerName = String(doc.seller.name || '').trim();
  const title = doc.number ? `Lasku ${doc.number}` : 'Lasku';

  const pdf = await PDFDocument.create();
  pdf.setTitle(sellerName ? `${title} – ${sellerName}` : title, { showInWindowTitleBar: true });
  if (sellerName) pdf.setAuthor(sellerName);
  pdf.setCreator('Koutsi');
  pdf.setLanguage('fi');

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const ink = rgb(0.07, 0.07, 0.07);
  const grey = rgb(0x6a / 255, 0x6a / 255, 0x6a / 255);
  const hair = rgb(0.8, 0.8, 0.8);
  const boxFill = rgb(0.955, 0.955, 0.955);
  const S: Record<string, Style> = {
    title: { font: bold, size: 20, color: ink },
    titleNumber: { font: regular, size: 20, color: ink },
    seller: { font: bold, size: 15, color: ink },
    stamp: { font: bold, size: 10, color: ink, track: 0.8 },
    label: { font: bold, size: 7.5, color: grey, track: 0.6 },
    body: { font: regular, size: 9.5, color: ink },
    strong: { font: bold, size: 9.5, color: ink },
    muted: { font: regular, size: 9.5, color: grey },
    when: { font: regular, size: 9, color: grey },
    small: { font: regular, size: 8.5, color: grey },
    payer: { font: bold, size: 11, color: ink },
    grand: { font: bold, size: 12.5, color: ink },
    value: { font: bold, size: 10, color: ink },
    code: { font: mono, size: 9, color: ink },
  };
  const { clean, width, wrap } = textTools();
  const LH = 13.5;

  const pages: Obj[] = [];
  let page: Obj = null;
  let y = TOP;

  /** Draws `value` with its left edge at x (or its right edge, with 'right') on the baseline `base`. */
  const put = (st: Style, value: unknown, x: number, base: number, align: 'left' | 'right' = 'left') => {
    const text = clean(st.font, value);
    if (!text) return;
    let cx = align === 'right' ? x - width(st, text) : x;
    if (!st.track) {
      page.drawText(text, { x: cx, y: base, size: st.size, font: st.font, color: st.color });
      return;
    }
    for (const ch of text) {
      page.drawText(ch, { x: cx, y: base, size: st.size, font: st.font, color: st.color });
      cx += width(st, ch) + st.track;
    }
  };
  const rule = (at: number, x0 = LEFT, x1 = RIGHT, thickness = 0.5, color = hair) =>
    page.drawLine({ start: { x: x0, y: at }, end: { x: x1, y: at }, thickness, color });

  const addPage = () => {
    page = pdf.addPage(A4);
    pages.push(page);
    y = TOP;
    if (pages.length === 1) return;
    // a continuation page: a small header
    const head = clean(S.small.font, `${title} (jatkuu)`);
    put(S.small, head, LEFT, TOP - 7);
    const name = clean(S.small.font, sellerName);
    if (name && width(S.small, head) + width(S.small, name) + 24 <= WIDTH) put(S.small, name, RIGHT, TOP - 7, 'right');
    rule(TOP - 13);
    y = TOP - CONTINUED_H;
  };
  /** Room for `h` pt more, or a new page (where `onBreak` redraws what repeats). */
  const ensure = (h: number, onBreak?: () => void) => {
    if (y - h >= BOTTOM) return;
    addPage();
    onBreak?.();
  };

  addPage();

  // ── header: logo or seller name | LASKU + number, the stamp under it ──
  const numberText = doc.number ? ` ${doc.number}` : '';
  const numberW = width(S.titleNumber, clean(regular, numberText));
  const titleW = width(S.title, 'LASKU') + numberW;
  put(S.title, 'LASKU', RIGHT - numberW, TOP - 16, 'right');
  if (numberText) put(S.titleNumber, numberText, RIGHT, TOP - 16, 'right');
  let rightH = 21;
  const stamp = inv.status === 'paid' ? 'MAKSETTU' : inv.status === 'void' ? 'MITÄTÖITY' : '';
  if (stamp) {
    const bw = width(S.stamp, stamp) + 20;
    const bh = 22;
    const bottom = TOP - rightH - 9 - bh;
    page.drawRectangle({ x: RIGHT - bw, y: bottom, width: bw, height: bh, borderColor: ink, borderWidth: 1.4 });
    put(S.stamp, stamp, RIGHT - bw + 10, bottom + (bh - S.stamp.size * 0.718) / 2);
    rightH += 9 + bh;
  }

  const logo = await embedLogo(pdf, opts.logo);
  let leftH = 0;
  if (logo) {
    const k = Math.min(LOGO_W / logo.width, LOGO_H / logo.height);
    const w = logo.width * k;
    const h = logo.height * k;
    page.drawImage(logo, { x: LEFT, y: TOP - h, width: w, height: h });
    leftH = h;
  } else if (sellerName) {
    const lines = wrap(S.seller, sellerName, WIDTH - titleW - 28);
    lines.forEach((t, i) => put(S.seller, t, LEFT, TOP - 12 - i * 18));
    leftH = lines.length * 18;
  }
  y = TOP - Math.max(leftH, rightH) - 26;

  // ── seller details | Päiväys, Eräpäivä, Viitenumero, Jakso ──
  const meta: [string, string][] = [
    ['Päiväys', doc.issueDate], ['Eräpäivä', doc.dueDate], ['Viitenumero', doc.reference], ['Jakso', doc.period],
  ];
  const metaRows = meta.filter(([, value]) => value);
  const metaX = RIGHT - 190;
  const infoW = metaX - LEFT - 24;
  const info: [Style, string][] = [];
  const addInfo = (st: Style, value: unknown) => wrap(st, value, infoW).forEach((t) => info.push([st, t]));
  if (logo) addInfo(S.strong, sellerName);
  addInfo(S.muted, doc.seller.address);
  if (doc.seller.businessId) addInfo(S.muted, `Y-tunnus ${doc.seller.businessId}`);
  if (doc.seller.email) addInfo(S.muted, doc.seller.email);
  info.forEach(([st, t], i) => put(st, t, LEFT, baseline(y - i * LH, st, LH)));
  metaRows.forEach(([label, value], i) => {
    put(S.muted, label, metaX, baseline(y - i * LH, S.muted, LH));
    put(S.body, value, RIGHT, baseline(y - i * LH, S.body, LH), 'right');
  });
  y -= Math.max(info.length, metaRows.length) * LH + 24;

  // ── payer ──
  ensure(14 + 15);
  put(S.label, 'MAKSAJA', LEFT, baseline(y, S.label, 12));
  y -= 14;
  for (const t of wrap(S.payer, doc.payer.name, WIDTH * 0.62)) {
    ensure(15);
    put(S.payer, t, LEFT, baseline(y, S.payer, 15));
    y -= 15;
  }
  for (const t of wrap(S.body, doc.payer.address, WIDTH * 0.62)) {
    ensure(LH);
    put(S.body, t, LEFT, baseline(y, S.body, LH));
    y -= LH;
  }
  y -= 22;

  // ── the coach's note, with a quote bar ──
  if (doc.note) {
    for (const t of wrap(S.body, doc.note, WIDTH - 14, true)) {
      ensure(LH);
      page.drawLine({ start: { x: LEFT + 1, y }, end: { x: LEFT + 1, y: y - LH }, thickness: 2, color: hair });
      put(S.body, t, LEFT + 14, baseline(y, S.body, LH));
      y -= LH;
    }
    y -= 22;
  }

  // ── totals and the payment box: measured first, drawn after the lines, kept together ──
  const showPay = inv.status !== 'void' && Boolean(doc.iban);
  const barcode = inv.status === 'sent' && doc.barcode ? doc.barcode : '';
  const payItems: [string, string][] = [['Saaja', sellerName], ['Tilinumero', doc.iban]];
  if (doc.bic) payItems.push(['BIC', doc.bic]);
  if (doc.reference) payItems.push(['Viitenumero', doc.reference]);
  payItems.push(['Summa', doc.totalText]);
  if (doc.dueDate) payItems.push(['Eräpäivä', doc.dueDate]);
  const PAD_X = 16;
  const PAD_Y = 14;
  const COLS = 3;
  const COL_GAP = 16;
  const colW = (WIDTH - 2 * PAD_X - (COLS - 1) * COL_GAP) / COLS;

  /** The payment box with its top at `top`: its height, drawn too when `draw`. */
  const payBox = (top: number, draw: boolean): number => {
    let cy = top - PAD_Y;
    if (draw) put(S.label, 'MAKSUTIEDOT', LEFT + PAD_X, baseline(cy, S.label, 12));
    cy -= 12 + 8;
    for (let i = 0; i < payItems.length; i += COLS) {
      if (i) cy -= 10;
      let rowH = 0;
      payItems.slice(i, i + COLS).forEach(([label, value], j) => {
        const x = LEFT + PAD_X + j * (colW + COL_GAP);
        const lines = wrap(S.value, value, colW);
        if (draw) {
          put(S.small, label, x, baseline(cy, S.small, 12));
          lines.forEach((t, k) => put(S.value, t, x, baseline(cy - 12 - k * 14, S.value, 14)));
        }
        rowH = Math.max(rowH, 12 + lines.length * 14);
      });
      cy -= rowH;
    }
    if (barcode) {
      cy -= 10;
      if (draw) rule(cy, LEFT + PAD_X, RIGHT - PAD_X, 0.5, hair);
      cy -= 9;
      const code = wrap(S.code, barcode, WIDTH - 2 * PAD_X);
      if (draw) {
        put(S.small, 'Virtuaaliviivakoodi', LEFT + PAD_X, baseline(cy, S.small, 12));
        code.forEach((t, k) => put(S.code, t, LEFT + PAD_X, baseline(cy - 12 - k * 13, S.code, 13)));
      }
      cy -= 12 + code.length * 13;
    }
    return top - (cy - PAD_Y);
  };

  const totalsX = RIGHT - 230;
  /** Everything from the totals down, from the current y: its height, drawn too when `draw`. */
  const closing = (draw: boolean): number => {
    let cy = y - 14;
    if (draw) rule(cy, LEFT, RIGHT, 1, ink);
    cy -= 8;
    if (doc.vat) {
      const vatRows: [string, number][] = [['Veroton', doc.vat.net], [`ALV ${String(doc.vat.rate).replace('.', ',')} %`, doc.vat.vat]];
      for (const [label, cents] of vatRows) {
        if (draw) {
          put(S.muted, label, totalsX, baseline(cy, S.muted, 16));
          put(S.body, euros(cents), RIGHT, baseline(cy, S.body, 16), 'right');
        }
        cy -= 16;
      }
    }
    if (draw) {
      put(S.grand, 'Yhteensä', totalsX, baseline(cy, S.grand, 22));
      put(S.grand, doc.totalText, RIGHT, baseline(cy, S.grand, 22), 'right');
    }
    cy -= 22;
    if (doc.vatNote) {
      const note = wrap(S.small, doc.vatNote, WIDTH);
      if (draw) note.forEach((t, i) => put(S.small, t, RIGHT, baseline(cy - i * 12, S.small, 12), 'right'));
      cy -= note.length * 12;
    }
    if (showPay) {
      cy -= 24;
      const h = payBox(cy, false);
      if (draw) {
        page.drawRectangle({ x: LEFT, y: cy - h, width: WIDTH, height: h, color: boxFill });
        payBox(cy, true);
      }
      cy -= h;
    }
    return y - cy;
  };

  // ── the charged lines: when | text | amount ──
  const WHEN_W = 86;
  const SUM_W = 80;
  const GAP = 12;
  const textX = LEFT + WHEN_W + GAP;
  const textW = RIGHT - SUM_W - GAP - textX;
  const ROW_LH = 12.5;
  const PAD = 5.5;
  const HEAD_H = 18;
  const FREE_H = doc.freeCount > 0 ? 20 : 0;
  let firstRow = true;
  const tableHead = () => {
    put(S.label, 'AIKA', LEFT, baseline(y, S.label, HEAD_H));
    put(S.label, 'KUVAUS', textX, baseline(y, S.label, HEAD_H));
    put(S.label, 'SUMMA', RIGHT, baseline(y, S.label, HEAD_H), 'right');
    y -= HEAD_H;
    rule(y, LEFT, RIGHT, 0.75, ink);
    firstRow = true;
  };
  const rows = doc.lines.map((l) => {
    const when = wrap(S.when, l.when, WHEN_W);
    const text = wrap(S.body, l.text, textW);
    return { when, text, amount: l.amount, h: Math.max(when.length, text.length, 1) * ROW_LH + 2 * PAD };
  });
  // The last row goes over with the totals, so a carried-over page never stands without a line
  // (unless the two wouldn't fit on any page).
  const tailH = FREE_H + closing(false);
  const roomOnNewPage = TOP - CONTINUED_H - HEAD_H - BOTTOM;
  const needFor = (i: number) => {
    const h = rows[i].h + (i === rows.length - 1 ? tailH : 0);
    return h <= roomOnNewPage ? h : rows[i].h;
  };
  if (rows.length) {
    ensure(HEAD_H + needFor(0));
    tableHead();
    rows.forEach((r, i) => {
      ensure(needFor(i), tableHead);
      if (!firstRow) rule(y);
      r.when.forEach((t, k) => put(S.when, t, LEFT, baseline(y - PAD - k * ROW_LH, S.when, ROW_LH)));
      r.text.forEach((t, k) => put(S.body, t, textX, baseline(y - PAD - k * ROW_LH, S.body, ROW_LH)));
      put(S.body, r.amount, RIGHT, baseline(y - PAD, S.body, ROW_LH), 'right');
      y -= r.h;
      firstRow = false;
    });
  }
  if (FREE_H) {
    ensure(FREE_H);
    y -= 6;
    put(S.small, `Lisäksi ${doc.freeCount} ${doc.freeCount === 1 ? 'kerta' : 'kertaa'} ilman veloitusta.`, LEFT, baseline(y, S.small, 14));
    y -= 14;
  }
  ensure(closing(false));
  y -= closing(true);

  // page numbers, when there is more than one page
  if (pages.length > 1) {
    pages.forEach((p, i) => {
      page = p;
      put(S.small, `Sivu ${i + 1}/${pages.length}`, RIGHT, BOTTOM - 24, 'right');
    });
  }
  return await pdf.save();
}
