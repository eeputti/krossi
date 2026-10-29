// BillingSheets.jsx — Laskutus's sheets. Settings: Laskuttaja (name, logo, IBAN, VAT, payment days),
// Hinnat (per group: per session / season fee / not billed; private lessons per hour), Peruutukset
// (limit, late and no-show charged) and Verkkomaksut (optional: a light Stripe account, money to the IBAN).
// "Laskuta": who owes what for a period, each line can be switched off, then send (or keep as drafts).
// One invoice: a draft is edited as the invoice itself (payer, message, lines); a sent one is the
// document with Lataa PDF, Lähetä sähköpostiin, Muistuta, Jaa, Maksettu and Mitätöi. Sending e-mails
// the invoice (PDF attached) to every payer with an e-mail.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import {
  Button, Chip, ChipSelect, EmptyState, Field, Icon, Input, ListRow, Select, Sheet, Switch, Textarea, Toggle, useConfirm, useToast,
} from '../ui/index.js';
import { koutsiSortGroupsBySchedule, koutsiTodayStr } from '../domain/core.js';
import { currentSeason } from '../domain/season.js';
import {
  EMPTY_BILLER, INVOICE_STATES, PRICE_MODES, VAT_MODES, billablePlayers, billedKeys, centsToInput, countsLine, deliveryOf, draftsFrom,
  euros, fiDate, formatIban, invoiceGroups, invoiceShareText, invoiceState, lineCounts, lineLabel, parseEuros, payCost, payCostRate,
  paymentsLine, periodPresets, termsText, totalOf, validBusinessId, validEmail, validIban,
} from '../domain/billing.js';
import { invoiceLink, useBilling } from '../shared/billing/BillingProvider.jsx';
import { InvoiceView, downloadPdf, useInvoicePrint } from '../shared/billing/InvoiceView.jsx';
import { ShareTextButton } from '../shared/bits.jsx';
import { FilePick } from '../shared/fields.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

/** Resets a form whenever its sheet opens (the pattern the other sheets use). */
function useOnOpen(open, init) {
  const [last, setLast] = useState(false);
  if (open !== last) {
    setLast(open);
    if (open) init();
  }
}

/** The database has vaihe 3 (logo, message, e-mail, "En tarvitse laskutusta vielä"). */
export const mailReadyOf = (billing) => Boolean(billing.biller?.mailReady || billing.prefsReady);

/** "8 laskua lähetetty, 7 sähköpostiin." */
export const sentLine = (n, mailed) => `${n} ${n === 1 ? 'lasku' : 'laskua'} lähetetty${mailed ? `, ${mailed} sähköpostiin` : ''}.`;

/**
 * Where an invoice goes, in one line with an icon: the payer's e-mail written on it (and who pays), the
 * player's own e-mail (their account's, not shown), or a warning when it reaches no one. `long` adds
 * what to do.
 */
export function DeliveryLine({ inv, student, long = false }) {
  const to = deliveryOf(inv, student);
  let text;
  if (to.kind === 'email') text = to.payer ? `${to.payer}, ${to.email}` : to.email;
  else if (to.kind === 'account') {
    text = long ? 'Pelaajan sähköpostiin, jolla hän kirjautuu Koutsiin' : 'Pelaajan sähköpostiin';
    if (to.payer) text += `, maksaja ${to.payer}`;
  } else {
    text = to.payer ? `Ei sähköpostia, maksaja ${to.payer}` : 'Ei sähköpostia';
    if (long) text += '. Lisää maksajan sähköposti, niin lasku menee perille.';
  }
  return (
    <span className={cx('bill-to', `is-${to.kind}`, long && 'is-long')}>
      <Icon name={to.kind === 'none' ? 'alert' : 'mail'} size={15} />
      <span className={long ? null : 'truncate'}>{text}</span>
    </span>
  );
}

/** Where the drafts go, for "Lähetä kaikki": "37 sähköpostiin. 2 ilman sähköpostia: jaa niiden linkki itse." */
export function deliverySummary(drafts, studentOf) {
  const n = { email: 0, account: 0, none: 0 };
  drafts.forEach((inv) => { n[deliveryOf(inv, studentOf(inv)).kind] += 1; });
  const parts = [];
  if (n.email + n.account) parts.push(`${n.email + n.account} sähköpostiin.`);
  if (n.none) parts.push(`${n.none} ilman sähköpostia: jaa ${n.none === 1 ? 'sen' : 'niiden'} linkki itse.`);
  return parts.join(' ');
}

/**
 * Sends the drafts (numbers, the players' notifications), then e-mails them, the PDF attached: to the
 * payer's e-mail on the invoice, else to the player's own (koutsi-invoice; a player added by name only
 * with no e-mail is skipped). An e-mail that doesn't go is said; the invoices are sent anyway.
 */
export async function sendAndMail(ids, mailReady) {
  await api.billing.send(ids);
  if (!mailReady || !ids.length) return { mailed: 0, mailError: null };
  try {
    const r = await api.billing.mailInvoices(ids);
    return { mailed: (r?.sent || []).length, mailError: null };
  } catch (err) {
    return { mailed: 0, mailError: err };
  }
}

/** A logo picked from the phone or computer, made small: at most 600 × 300 px, PNG (JPEG stays JPEG). */
async function shrinkLogo(file) {
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('Valitse PNG- tai JPEG-kuva.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Kuvaa ei voitu lukea.'));
      el.src = url;
    });
    const scale = Math.min(1, 600 / img.naturalWidth, 300 / img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
    if (!blob || blob.size > 1024 * 1024) throw new Error('Kuva on liian suuri (enintään 1 Mt).');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── settings ────────────────────────────────────────────────────────────────

export function SettingsSheet({ open, onClose, onPick }) {
  const { biller } = useBilling();
  if (!biller) return null;
  const priced = Object.values(biller.prices?.groups || {}).filter((p) => p.mode !== 'ei' && p.cents > 0).length;
  const hour = biller.prices?.privateHourCents;
  const pick = (which) => { onClose(); onPick(which); };
  return (
    <Sheet open={open} onClose={onClose} size="sm" title="Asetukset">
      <div className="list-group">
        <ListRow icon="user" title="Laskuttaja" subtitle={biller.name} onClick={() => pick('laskuttaja')} />
        <ListRow icon="euro" title="Hinnat" subtitle={[priced ? `${priced} ${priced === 1 ? 'ryhmä' : 'ryhmää'}` : 'Ei hintoja', hour ? `yksityistunti ${euros(hour)}/h` : ''].filter(Boolean).join(', ')} onClick={() => pick('hinnat')} />
        <ListRow icon="clock" title="Peruutukset" subtitle={biller.cancelHours ? `Viimeistään ${biller.cancelHours} h ennen` : 'Ei rajaa'} onClick={() => pick('ehdot')} />
        {biller.payReady && <ListRow icon="bolt" title="Verkkomaksut" subtitle={paymentsLine(biller)} onClick={() => pick('maksut')} />}
      </div>
    </Sheet>
  );
}

export function BillerSheet({ open, onClose, onSaved }) {
  const { state, ownerId } = useData();
  const billing = useBilling();
  const toast = useToast();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const mailReady = mailReadyOf(billing);
  useOnOpen(open, () => {
    const b = billing.biller || { ...EMPTY_BILLER, name: state.coach?.name || '' };
    setF({
      name: b.name || '', businessId: b.businessId || '', iban: b.iban ? formatIban(b.iban) : '', address: b.address || '',
      email: b.email || '', vatMode: b.vatMode || 'none', paymentDays: String(b.paymentDays ?? 14), nextNumber: String(b.nextNumber || 1),
      logoPath: b.logoPath || null,
    });
  });
  if (!f) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const days = [...new Set([7, 14, 21, 30, Number(f.paymentDays)])].sort((a, b) => a - b).map((d) => ({ value: String(d), label: `${d} päivää` }));
  const missing = !f.name.trim() ? 'Kirjoita nimi.'
    : !validIban(f.iban) ? 'Tarkista tilinumero.'
      : f.businessId.trim() && !validBusinessId(f.businessId) ? 'Tarkista Y-tunnus (muoto 1234567-8).'
        : f.email.trim() && !validEmail(f.email) ? 'Tarkista sähköposti.'
          : !(Number(f.nextNumber) >= 1) ? 'Tarkista laskunumero.' : null;
  const save = async () => {
    if (missing || busy) return;
    setBusy(true);
    const base = billing.biller || EMPTY_BILLER;
    const res = await billing.run(() => api.billing.saveBiller(ownerId, {
      ...base, ...f, businessId: f.businessId.trim(), paymentDays: Number(f.paymentDays), nextNumber: Math.round(Number(f.nextNumber)),
      payReady: Boolean(base.payReady || billing.prefsReady), mailReady,
    }), 'Tallennettu.');
    setBusy(false);
    if (res.ok) { onClose(); onSaved?.(); }
  };
  const pickLogo = async (file) => {
    setLogoBusy(true);
    try {
      const path = await api.billing.uploadLogo(ownerId, await shrinkLogo(file));
      setF((x) => ({ ...x, logoPath: path }));
      if (billing.biller) await billing.reload();
    } catch (err) {
      toast(err);
    }
    setLogoBusy(false);
  };
  const dropLogo = async () => {
    setLogoBusy(true);
    const res = await billing.run(() => api.billing.removeLogo(ownerId));
    setLogoBusy(false);
    if (res.ok) setF((x) => ({ ...x, logoPath: null }));
  };
  const logo = f.logoPath ? api.billing.logoUrl(f.logoPath) : null;
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="md" title="Laskuttaja"
      footer={<Button variant="dark" size="lg" block loading={busy} missing={missing} onClick={save}>Tallenna</Button>}>
      <div className="stack-4">
        <Field label="Nimi" hint="Näkyy laskussa laskuttajana." htmlFor="bill-name"><Input id="bill-name" value={f.name} maxLength={120} autoComplete="organization" onChange={set('name')} /></Field>
        {mailReady && (
          <Field label="Logo" optional>
            <div className="bill-logo-pick">
              {logo ? <img className="bill-logo-preview" src={logo} alt="" /> : <span className="bill-logo-empty">{f.name.trim() || 'Ei logoa'}</span>}
              <span className="bill-logo-actions">
                <FilePick accept="image/png,image/jpeg" onPick={pickLogo} className={cx('btn btn-outline btn-sm', logoBusy && 'is-loading')}>{logo ? 'Vaihda' : 'Valitse kuva'}</FilePick>
                {logo && <button type="button" className="k-textlink is-danger" disabled={logoBusy} onClick={dropLogo}>Poista</button>}
              </span>
            </div>
          </Field>
        )}
        <Field label="Tilinumero" htmlFor="bill-iban"><Input id="bill-iban" value={f.iban} autoCapitalize="characters" spellCheck={false} placeholder="FI00 0000 0000 0000 00" onChange={set('iban')} /></Field>
        <Field label="Y-tunnus" optional htmlFor="bill-ytunnus"><Input id="bill-ytunnus" value={f.businessId} placeholder="1234567-8" onChange={set('businessId')} /></Field>
        <Field label="Osoite" optional htmlFor="bill-address"><Textarea id="bill-address" rows={2} value={f.address} maxLength={300} onChange={set('address')} /></Field>
        <Field label="Sähköposti" optional hint="Maksajien vastaukset laskuihin tulevat tänne." htmlFor="bill-email"><Input id="bill-email" type="email" value={f.email} onChange={set('email')} /></Field>
        <div className="bill-two">
          <Field label="ALV" htmlFor="bill-vat"><Select id="bill-vat" options={VAT_MODES} value={f.vatMode} onChange={set('vatMode')} /></Field>
          <Field label="Maksuaika" htmlFor="bill-days"><Select id="bill-days" options={days} value={f.paymentDays} onChange={set('paymentDays')} /></Field>
        </div>
        <Field label="Seuraava laskunumero" htmlFor="bill-next"><Input id="bill-next" type="number" min={1} inputMode="numeric" value={f.nextNumber} onChange={set('nextNumber')} /></Field>
      </div>
    </Sheet>
  );
}

export function PricesSheet({ open, onClose }) {
  const { state, ownerId } = useData();
  const billing = useBilling();
  const groups = useMemo(() => koutsiSortGroupsBySchedule(state.groups || []), [state.groups]);
  const [rows, setRows] = useState({});
  const [hour, setHour] = useState('');
  const [busy, setBusy] = useState(false);
  useOnOpen(open, () => {
    const prices = billing.biller?.prices || {};
    setRows(Object.fromEntries(groups.map((g) => {
      const p = prices.groups?.[g.id];
      return [g.id, { mode: p?.mode || 'ei', amount: p?.mode && p.mode !== 'ei' ? centsToInput(p.cents) : '' }];
    })));
    setHour(centsToInput(prices.privateHourCents));
  });
  const setRow = (id, patch) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const unpriced = groups.find((g) => rows[g.id] && rows[g.id].mode !== 'ei' && !(parseEuros(rows[g.id].amount) > 0));
  const missing = unpriced ? `Kirjoita hinta: ${unpriced.name}.` : hour.trim() && parseEuros(hour) == null ? 'Tarkista tuntihinta.' : null;
  const save = async () => {
    if (missing || busy || !billing.biller) return;
    setBusy(true);
    const groupsPrices = { ...(billing.biller.prices?.groups || {}) };
    for (const g of groups) {
      const r = rows[g.id];
      groupsPrices[g.id] = r.mode === 'ei' ? { mode: 'ei', cents: 0 } : { mode: r.mode, cents: parseEuros(r.amount) };
    }
    const prices = { ...billing.biller.prices, groups: groupsPrices, privateHourCents: hour.trim() ? parseEuros(hour) : null };
    const res = await billing.run(() => api.billing.saveBiller(ownerId, { ...billing.biller, prices }), 'Hinnat tallennettu.');
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="md" title="Hinnat"
      footer={<Button variant="dark" size="lg" block loading={busy} missing={missing} onClick={save}>Tallenna</Button>}>
      <div className="bill-prices">
        {groups.map((g) => {
          const r = rows[g.id] || { mode: 'ei', amount: '' };
          return (
            <div key={g.id} className="bill-price">
              <span className="bill-price-name">
                <span className="k-row-title truncate">{g.name}</span>
                <span className="k-row-sub">{[g.day, g.time].filter(Boolean).join(' ')}</span>
              </span>
              <span className="bill-price-ctrl">
                <Select aria-label={`${g.name}: laskutus`} options={PRICE_MODES} value={r.mode} onChange={(e) => setRow(g.id, { mode: e.target.value })} />
                {r.mode !== 'ei' && (
                  <span className="bill-euro">
                    <Input aria-label={`${g.name}: hinta`} inputMode="decimal" value={r.amount} placeholder="0" onChange={(e) => setRow(g.id, { amount: e.target.value })} />
                    <span aria-hidden="true">€</span>
                  </span>
                )}
              </span>
            </div>
          );
        })}
        <div className="bill-price">
          <span className="bill-price-name"><span className="k-row-title">Yksityistunti</span><span className="k-row-sub">Tuntihinta</span></span>
          <span className="bill-price-ctrl">
            <span className="bill-euro">
              <Input aria-label="Yksityistunnin tuntihinta" inputMode="decimal" value={hour} placeholder="0" onChange={(e) => setHour(e.target.value)} />
              <span aria-hidden="true">€/h</span>
            </span>
          </span>
        </div>
      </div>
    </Sheet>
  );
}

const CANCEL_OPTIONS = [
  { value: '0', label: 'Ei rajaa' }, { value: '12', label: '12 h' }, { value: '24', label: '24 h' }, { value: '48', label: '48 h' },
];

export function TermsSheet({ open, onClose }) {
  const { ownerId } = useData();
  const billing = useBilling();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useOnOpen(open, () => {
    const b = billing.biller || EMPTY_BILLER;
    setF({ cancelHours: String(b.cancelHours ?? 24), chargeLate: b.chargeLate !== false, chargeNoShow: b.chargeNoShow !== false });
  });
  if (!f || !billing.biller) return null;
  const hours = Number(f.cancelHours);
  const options = CANCEL_OPTIONS.some((o) => o.value === f.cancelHours) ? CANCEL_OPTIONS : [...CANCEL_OPTIONS, { value: f.cancelHours, label: `${f.cancelHours} h` }];
  const save = async () => {
    if (busy) return;
    setBusy(true);
    const res = await billing.run(() => api.billing.saveBiller(ownerId, { ...billing.biller, cancelHours: hours, chargeLate: f.chargeLate, chargeNoShow: f.chargeNoShow }), 'Tallennettu.');
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="md" title="Peruutukset"
      footer={<Button variant="dark" size="lg" block loading={busy} onClick={save}>Tallenna</Button>}>
      <div className="stack-4">
        <Field label="Peruutus viimeistään">
          <ChipSelect size="sm" options={options} value={f.cancelHours} onChange={(v) => v && setF((x) => ({ ...x, cancelHours: v }))} ariaLabel="Peruutusraja" />
        </Field>
        <div className="list-group">
          {hours > 0 && <Toggle label="Myöhäinen peruutus laskutetaan" checked={f.chargeLate} onChange={(v) => setF((x) => ({ ...x, chargeLate: v }))} />}
          <Toggle label="Poissaolo ilman ilmoitusta laskutetaan" checked={f.chargeNoShow} onChange={(v) => setF((x) => ({ ...x, chargeNoShow: v }))} />
        </div>
        <div className="bill-terms">
          <span className="inv-label">Pelaaja näkee</span>
          <p>{termsText({ ...billing.biller, terms: '', cancelHours: hours, chargeLate: f.chargeLate, chargeNoShow: f.chargeNoShow })}</p>
        </div>
      </div>
    </Sheet>
  );
}

/** Verkkomaksut: what a payment costs the coach, said plainly and as a 100 € example. */
function PayCostExample() {
  const total = 10000;
  const cost = payCost(total);
  return (
    <div className="stack-3">
      <p className="k-body-text">Pelaaja maksaa laskun summan. Stripe vähentää maksusta kulunsa, ja loput tulevat tilillesi viikoittain.</p>
      <div className="bill-example">
        <span className="inv-label">Esimerkki</span>
        <div className="bill-example-row"><span>Pelaaja maksaa</span><span className="t-num">{euros(total)}</span></div>
        <div className="bill-example-row"><span>Stripen kulu</span><span className="t-num">{euros(-cost)}</span></div>
        <div className="bill-example-row is-total"><span>Tilillesi</span><span className="t-num">{euros(total - cost)}</span></div>
      </div>
      <p className="k-fine">Kulu on {payCostRate('card')} (MobilePay, Apple Pay, Google Pay ja kortti). Klarnalla se on {payCostRate('klarna')}.</p>
    </div>
  );
}

// Verkkomaksut, optional: a bank transfer with the reference is the default and needs nothing but the IBAN.
// With this on, "Maksa" on the invoices takes MobilePay, Apple / Google Pay and cards, "Maksa Klarnalla"
// Klarna, and Stripe pays the money to the coach's bank account weekly, less its fee (PayCostExample).
// Connecting = Stripe's own form once (koutsi-pay); then a switch for "Maksa" and a link to the payouts.
export function PaymentsSheet({ open, onClose }) {
  const { ownerId } = useData();
  const billing = useBilling();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const b = billing.biller;
  if (!b) return null;
  const state = !b.stripeAccountId ? 'none' : b.stripeChargesEnabled ? 'ready' : 'pending';
  const connect = async () => {
    if (busy) return;
    setBusy(true);
    const res = await billing.run(() => api.billing.connectPayments(ownerId));
    setBusy(false);
    if (res.ok && res.result?.url) window.location.assign(res.result.url);
    else if (res.ok && res.result?.ready) toast('Verkkomaksut käytössä.');
  };
  const payouts = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.billing.paymentsDashboard(ownerId);
      if (r?.url) window.open(r.url, '_blank', 'noopener');
    } catch (err) {
      toast(err);
    }
    setBusy(false);
  };
  const toggle = (on) => billing.run(() => api.billing.saveBiller(ownerId, { ...b, payOnline: on }), on ? 'Verkkomaksu päällä.' : 'Verkkomaksu pois päältä.');
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="sm" title="Verkkomaksut"
      footer={state === 'ready'
        ? <Button variant="soft" size="lg" block loading={busy} icon="external" onClick={payouts}>Tilitykset</Button>
        : <Button variant="dark" size="lg" block loading={busy} onClick={connect}>{state === 'none' ? 'Ota käyttöön' : 'Jatka käyttöönottoa'}</Button>}>
      {state === 'ready' ? (
        <div className="stack-4">
          <div className="list-group">
            <Toggle label="Pelaaja voi maksaa laskun verkossa" checked={b.payOnline !== false} onChange={toggle} />
          </div>
          <PayCostExample />
        </div>
      ) : (
        <div className="stack-4">
          <p className="k-body-text">{state === 'none'
            ? 'Pelaaja voi maksaa laskun MobilePaylla, Apple Paylla, Google Paylla, kortilla tai Klarnalla. Täytät kerran Stripen lomakkeen (henkilötiedot ja tilinumero), ja rahat tulevat tilillesi.'
            : 'Stripe tarvitsee vielä tietoja ennen kuin maksut toimivat.'}</p>
          {state === 'none' && <PayCostExample />}
          {state === 'none' && <p className="k-fine">Valinnainen: ilman tätä pelaaja maksaa tilisiirrolla laskun viitenumerolla.</p>}
        </div>
      )}
    </Sheet>
  );
}

// ── "Laskuta" ───────────────────────────────────────────────────────────────

function LineRow({ line, onToggle, busy = false, onRemove = null }) {
  const { when, text } = lineLabel(line);
  return (
    <div className={cx('bill-line', !line.charged && 'is-off')}>
      <span className="bill-line-text">{when && <span className="t-num">{when}</span>}<span>{text}</span></span>
      <span className="bill-line-sum t-num">{euros(line.amountCents)}</span>
      {onRemove
        ? <button type="button" className="bill-line-x" aria-label="Poista rivi" disabled={busy} onClick={onRemove}><Icon name="close" size={16} /></button>
        : <Switch size="sm" checked={line.charged} label={line.charged ? 'Veloitetaan' : 'Ei veloiteta'} disabled={busy} onChange={onToggle} />}
    </div>
  );
}

export function NewBillingSheet({ open, onClose, onPrices }) {
  const { state, ownerId } = useData();
  const billing = useBilling();
  const confirm = useConfirm();
  const toast = useToast();
  const today = koutsiTodayStr();
  const presets = useMemo(() => periodPresets(today, currentSeason(state, today)), [state, today]);
  const [period, setPeriod] = useState(presets[0].value);
  const [skipped, setSkipped] = useState(() => new Set());
  const [overrides, setOverrides] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [busy, setBusy] = useState(false);
  useOnOpen(open, () => { setPeriod(presets[0].value); setSkipped(new Set()); setOverrides({}); setExpanded(null); });
  const p = presets.find((x) => x.value === period) || presets[0];
  const biller = billing.biller;
  const result = useMemo(() => (biller ? billablePlayers({
    trainings: state.trainings, groups: state.allGroups || state.groups, students: state.students, memberships: billing.memberships,
    biller, from: p.from, to: p.to, now: new Date(), billed: billedKeys(billing.invoices),
  }) : { players: [], missingPrivatePrice: false }), [state, billing.memberships, billing.invoices, biller, p.from, p.to]);
  const players = result.players.map((pl) => {
    const lines = pl.lines.map((l) => (l.key in overrides ? { ...l, charged: overrides[l.key] } : l));
    return { ...pl, lines, counts: lineCounts(lines), totalCents: totalOf(lines) };
  });
  const chosen = players.filter((pl) => pl.totalCents > 0 && !skipped.has(pl.studentId));
  const total = chosen.reduce((s, pl) => s + pl.totalCents, 0);
  const noPrices = biller && !Object.values(biller.prices?.groups || {}).some((x) => x.mode !== 'ei' && x.cents > 0) && !(biller.prices?.privateHourCents > 0);
  const toggle = (id) => setSkipped((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const go = async (send) => {
    if (!chosen.length || busy) return;
    const n = chosen.length;
    if (send && !(await confirm({ title: `Lähetetäänkö ${n} ${n === 1 ? 'lasku' : 'laskua'}?`, message: `Yhteensä ${euros(total)}.`, confirmLabel: 'Lähetä' }))) return;
    setBusy(true);
    const drafts = draftsFrom(chosen, { biller, students: state.students, from: p.from, to: p.to });
    const res = await billing.run(async () => {
      const ids = await api.billing.createDrafts(ownerId, drafts);
      if (!send) return null;
      return sendAndMail(ids, mailReadyOf(billing));
    });
    setBusy(false);
    if (!res.ok) return;
    if (!send) toast(`${n} ${n === 1 ? 'luonnos' : 'luonnosta'} tallennettu.`);
    else if (res.result?.mailError) toast(`Laskut lähetetty, mutta sähköposti ei lähtenyt: ${res.result.mailError.userMessage || res.result.mailError.message}`, { tone: 'info', duration: 6000 });
    else toast(sentLine(n, res.result?.mailed));
    onClose();
  };

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="lg" title="Laskuta"
      footer={players.length > 0 && !noPrices ? (
        <div className="sheet-actions">
          <Button variant="soft" size="lg" disabled={busy || !chosen.length} onClick={() => go(false)}>Luonnoksiksi</Button>
          <Button variant="dark" size="lg" loading={busy} missing={chosen.length ? null : 'Valitse ainakin yksi pelaaja.'} onClick={() => go(true)}>
            Lähetä{chosen.length ? ` (${chosen.length})` : ''}
          </Button>
        </div>
      ) : null}>
      <div className="stack-4">
        <ChipSelect size="sm" layout="scroll" options={presets.map((x) => ({ value: x.value, label: x.label }))} value={period}
          onChange={(v) => { if (v) { setPeriod(v); setOverrides({}); setSkipped(new Set()); } }} ariaLabel="Jakso" />
        {noPrices ? (
          <EmptyState compact art="court" title="Aseta ensin hinnat" action={<Button variant="dark" onClick={onPrices}>Hinnat</Button>} />
        ) : players.length === 0 ? (
          <p className="k-quiet">Ei laskutettavaa tältä ajalta.</p>
        ) : (
          <>
            <div className="bill-sumline"><span>{chosen.length} {chosen.length === 1 ? 'lasku' : 'laskua'}</span><strong className="t-num">{euros(total)}</strong></div>
            <div className="bill-picks">
              {players.map((pl) => {
                const on = pl.totalCents > 0 && !skipped.has(pl.studentId);
                const isOpen = expanded === pl.studentId;
                return (
                  <div key={pl.studentId} className={cx('bill-pick', on && 'is-on')}>
                    <div className="bill-pick-head">
                      <label className="bill-pick-main">
                        <input type="checkbox" checked={on} disabled={pl.totalCents === 0} onChange={() => toggle(pl.studentId)} />
                        <span className="bill-pick-text">
                          <span className="k-pick-title truncate">{pl.name}</span>
                          <span className="k-row-sub truncate">{countsLine(pl.counts)}</span>
                        </span>
                        <span className="bill-amount t-num">{euros(pl.totalCents)}</span>
                      </label>
                      <button type="button" className={cx('bill-pick-more', isOpen && 'is-open')} aria-expanded={isOpen} aria-label={`${pl.name}: rivit`}
                        onClick={() => setExpanded(isOpen ? null : pl.studentId)}>
                        <Icon name="chevron-down" size={18} />
                      </button>
                    </div>
                    {isOpen && (
                      <div className="bill-lines">
                        {pl.lines.map((l) => <LineRow key={l.key} line={l} onToggle={(v) => setOverrides((o) => ({ ...o, [l.key]: v }))} />)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
        {result.missingPrivatePrice && !noPrices && (
          <p className="k-fine">Yksityistunneilla ei ole hintaa. <button type="button" className="k-textlink" onClick={onPrices}>Aseta hinta</button></p>
        )}
      </div>
    </Sheet>
  );
}

// ── one invoice ─────────────────────────────────────────────────────────────

function PayerSheet({ open, onClose, invoice, student }) {
  const { ownerId } = useData();
  const billing = useBilling();
  const [f, setF] = useState({ name: '', email: '' });
  const [busy, setBusy] = useState(false);
  useOnOpen(open, () => setF({ name: invoice?.payerName || '', email: invoice?.payerEmail || '' }));
  if (!invoice) return null;
  const missing = !f.name.trim() ? 'Kirjoita nimi.' : f.email.trim() && !validEmail(f.email) ? 'Tarkista sähköposti.' : null;
  const save = async () => {
    if (missing || busy) return;
    setBusy(true);
    const res = await billing.run(async () => {
      await api.billing.updateDraft(invoice.id, { payerName: f.name, payerEmail: f.email });
      // remembered for the player's next invoices; the player themselves needs no entry
      if (student && billing.biller) {
        const payers = { ...(billing.biller.payers || {}) };
        if (f.name.trim() === student.name && !f.email.trim()) delete payers[student.id];
        else payers[student.id] = { name: f.name.trim(), email: f.email.trim() };
        await api.billing.saveBiller(ownerId, { ...billing.biller, payers });
      }
    }, 'Tallennettu.');
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="sm" title="Maksaja"
      footer={<Button variant="dark" size="lg" block loading={busy} missing={missing} onClick={save}>Tallenna</Button>}>
      <div className="stack-4">
        <Field label="Nimi" htmlFor="bill-payer-name"><Input id="bill-payer-name" value={f.name} maxLength={120} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} /></Field>
        <Field label="Maksajan sähköposti" optional htmlFor="bill-payer-email"
          hint={student && !student.isPlaceholder ? 'Tyhjä: lasku lähtee pelaajan omaan sähköpostiin. Huoltajan tai yrityksen osoite tähän.' : 'Lasku lähtee tähän PDF-liitteenä, kun lähetät sen.'}>
          <Input id="bill-payer-email" type="email" value={f.email} onChange={(e) => setF((x) => ({ ...x, email: e.target.value }))} />
        </Field>
      </div>
    </Sheet>
  );
}

/** Add a line, or edit one: its text and sum. */
function LineSheet({ open, onClose, invoice, line }) {
  const billing = useBilling();
  const [f, setF] = useState({ text: '', amount: '' });
  const [busy, setBusy] = useState(false);
  useOnOpen(open, () => setF(line ? { text: line.description, amount: centsToInput(line.amountCents) } : { text: '', amount: '' }));
  if (!invoice) return null;
  const cents = parseEuros(f.amount);
  const missing = !f.text.trim() ? 'Kirjoita selite.' : !(cents > 0) ? 'Kirjoita summa.' : null;
  const save = async () => {
    if (missing || busy) return;
    setBusy(true);
    const res = await billing.run(() => (line
      ? api.billing.updateLine(line.id, { description: f.text, amountCents: cents })
      : api.billing.addLine(invoice.id, { description: f.text, amountCents: cents, date: koutsiTodayStr() })));
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="sm" title={line ? 'Muokkaa riviä' : 'Lisää rivi'}
      footer={<Button variant="dark" size="lg" block loading={busy} missing={missing} onClick={save}>{line ? 'Tallenna' : 'Lisää'}</Button>}>
      <div className="stack-4">
        <Field label="Selite" htmlFor="bill-line-text"><Input id="bill-line-text" value={f.text} maxLength={200} placeholder="esim. 10 kerran kortti" onChange={(e) => setF((x) => ({ ...x, text: e.target.value }))} /></Field>
        <Field label="Summa" htmlFor="bill-line-sum">
          <span className="bill-euro"><Input id="bill-line-sum" inputMode="decimal" value={f.amount} placeholder="0" onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))} /><span aria-hidden="true">€</span></span>
        </Field>
      </div>
    </Sheet>
  );
}

/** "Lähetä sähköpostiin" for a sent invoice: to the payer's e-mail, or another one this time. */
function MailSheet({ open, onClose, invoice, student }) {
  const billing = useBilling();
  const toast = useToast();
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  useOnOpen(open, () => setTo(invoice?.payerEmail || invoice?.mailTo || ''));
  if (!invoice) return null;
  // empty = the e-mail the player's account was made with (a player added by name only has none)
  const own = Boolean(student && !student.isPlaceholder);
  const missing = to.trim() ? (validEmail(to) ? null : 'Tarkista sähköposti.') : own ? null : 'Kirjoita sähköposti.';
  const send = async () => {
    if (missing || busy) return;
    setBusy(true);
    const res = await billing.run(() => api.billing.mailInvoices([invoice.id], to.trim() ? { to: to.trim() } : {}));
    setBusy(false);
    if (!res.ok) return;
    if ((res.result?.sent || []).length) { toast(to.trim() ? `Lasku lähetetty: ${to.trim()}` : 'Lasku lähetetty pelaajan sähköpostiin.'); onClose(); }
    else toast('Sähköposti ei lähtenyt. Yritä hetken päästä uudelleen.', { tone: 'info' });
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="sm" title="Lähetä sähköpostiin"
      footer={<Button variant="dark" size="lg" block loading={busy} missing={missing} onClick={send}>Lähetä</Button>}>
      <Field label="Sähköposti" optional={own}
        hint={own ? 'Tyhjä: pelaajan omaan sähköpostiin. Lasku lähtee PDF-liitteenä.' : 'Lasku lähtee PDF-liitteenä, ja viestissä on linkki laskuun.'}
        htmlFor="bill-mail-to">
        <Input id="bill-mail-to" type="email" value={to} placeholder={own ? 'Pelaajan oma sähköposti' : ''} onChange={(e) => setTo(e.target.value)} />
      </Field>
    </Sheet>
  );
}

/** One line of a draft: tap it to edit the text and sum, the switch to leave it out (a line of your own: ×). */
function EditLine({ line, busy, onEdit, onToggle, onRemove }) {
  const { when, text } = lineLabel(line);
  return (
    <div className={cx('bill-line', 'is-editable', !line.charged && 'is-off')}>
      <button type="button" className="bill-line-edit" disabled={busy} onClick={onEdit}>
        <span className="bill-line-text">{when && <span className="t-num">{when}</span>}<span>{text}</span></span>
        <span className="bill-line-sum t-num">{euros(line.amountCents)}</span>
      </button>
      {line.kind === 'manual'
        ? <button type="button" className="bill-line-x" aria-label="Poista rivi" disabled={busy} onClick={onRemove}><Icon name="close" size={16} /></button>
        : <Switch size="sm" checked={line.charged} label={line.charged ? 'Veloitetaan' : 'Ei veloiteta'} disabled={busy} onChange={onToggle} />}
    </div>
  );
}

/** A draft, edited as the invoice it will be: the seller, the payer, the message, the lines and the total. */
function DraftEditor({ inv, student, busy, onPayer, onAddLine, onEditLine, act }) {
  const billing = useBilling();
  const b = billing.biller || {};
  const mailReady = mailReadyOf(billing);
  const [note, setNote] = useState(inv.note || '');
  useEffect(() => { setNote(inv.note || ''); }, [inv.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveNote = () => {
    if ((inv.note || '') === note.trim()) return;
    act('note', () => api.billing.updateDraft(inv.id, { note }));
  };
  const logo = b.logoPath ? api.billing.logoUrl(b.logoPath) : null;
  return (
    <article className="inv-doc is-draft">
      <header className="inv-head">
        <div className="inv-from">
          {logo && <img className="inv-logo" src={logo} alt="" />}
          <div className="inv-seller">{b.name}</div>
        </div>
        <div className="inv-title"><span>Lasku</span><span className="inv-stamp is-draft">Luonnos</span></div>
      </header>
      <button type="button" className="inv-edit-block" onClick={onPayer}>
        <span className="inv-label">Maksaja</span>
        <span className="inv-strong">{inv.payerName}</span>
        <DeliveryLine inv={inv} student={student} long />
        <Icon name="edit" size={16} className="inv-edit-icon" />
      </button>
      {mailReady && (
        <Textarea className="inv-note-input" rows={2} maxLength={500} placeholder="Viesti laskulle (valinnainen)" value={note}
          onChange={(e) => setNote(e.target.value)} onBlur={saveNote} />
      )}
      <div className="bill-lines">
        {inv.lines.map((l) => (
          <EditLine key={l.id} line={l} busy={Boolean(busy)} onEdit={() => onEditLine(l)}
            onToggle={(v) => act('line', () => api.billing.setLineCharged(l.id, v))}
            onRemove={() => act('line', () => api.billing.removeLine(l.id))} />
        ))}
        <button type="button" className="bill-add" onClick={onAddLine}><Icon name="plus" size={16} />Lisää rivi</button>
      </div>
      <div className="inv-totals">
        <div className="inv-total-row inv-grand"><span>Yhteensä</span><span className="t-num">{euros(totalOf(inv.lines))}</span></div>
      </div>
      <p className="inv-muted">Numero, viitenumero ja eräpäivä ({b.paymentDays ?? 14} pv) tulevat, kun lähetät.</p>
    </article>
  );
}

export function InvoiceSheet({ invoiceId, onClose }) {
  const { state } = useData();
  const billing = useBilling();
  const confirm = useConfirm();
  const toast = useToast();
  const { print, portal } = useInvoicePrint();
  const live = invoiceId ? billing.invoices.find((x) => x.id === invoiceId) || null : null;
  // keeps showing while the sheet slides away (and after a draft is deleted)
  const [shown, setShown] = useState(null);
  useEffect(() => { if (live) setShown(live); }, [live]);
  const inv = live || shown;
  const [busy, setBusy] = useState(null);
  const [payerOpen, setPayerOpen] = useState(false);
  const [lineSheet, setLineSheet] = useState(null); // { line } to edit, { line: null } to add
  const [mailOpen, setMailOpen] = useState(false);
  const open = Boolean(invoiceId && live);
  if (!inv) return null;
  const mailReady = mailReadyOf(billing);
  const student = state.students.find((s) => s.id === inv.studentId) || null;
  const st = invoiceState(inv, koutsiTodayStr());
  const act = async (key, fn, message) => {
    setBusy(key);
    const res = await billing.run(fn, message);
    setBusy(null);
    return res;
  };
  const send = async () => {
    setBusy('send');
    const res = await billing.run(() => sendAndMail([inv.id], mailReady));
    setBusy(null);
    if (!res.ok) return;
    if (res.result?.mailError) toast(`Lasku lähetetty, mutta sähköposti ei lähtenyt: ${res.result.mailError.userMessage || res.result.mailError.message}`, { tone: 'info', duration: 6000 });
    else if (res.result?.mailed) toast(inv.payerEmail ? `Lasku lähetetty osoitteeseen ${inv.payerEmail}.` : 'Lasku lähetetty pelaajan sähköpostiin.');
    else toast(student && !student.isPlaceholder ? 'Lasku lähetetty pelaajan Koutsiin.' : 'Lasku lähetetty. Jaa linkki maksajalle.');
  };
  const remind = async () => {
    const res = await act('remind', () => api.billing.remindInvoice(inv.id));
    if (!res.ok) return;
    const r = res.result || {};
    toast(r.tooSoon ? 'Muistutus lähti jo tänään.' : r.mailed ? (r.to ? `Muistutus lähetetty: ${r.to}` : 'Muistutus lähetetty pelaajan sähköpostiin.') : 'Muistutus lähetetty pelaajan Koutsiin.');
  };
  const removeDraft = async () => {
    if (!(await confirm({ title: 'Poistetaanko luonnos?', confirmLabel: 'Poista', danger: true }))) return;
    const res = await act('remove', () => api.billing.removeDrafts([inv.id]), 'Luonnos poistettu.');
    if (res.ok) onClose();
  };
  const voidIt = async () => {
    if (!(await confirm({ title: 'Mitätöidäänkö lasku?', message: 'Laskua ei tarvitse maksaa. Sen treenit voi laskuttaa uudelleen.', confirmLabel: 'Mitätöi', danger: true }))) return;
    await act('void', () => api.billing.voidInvoice(inv.id), 'Lasku mitätöity.');
  };
  const total = inv.status === 'draft' ? totalOf(inv.lines) : inv.totalCents;
  const reachesPlayer = Boolean(student && !student.isPlaceholder);
  const mailedOn = inv.mailedAt ? fiDate(String(inv.mailedAt).slice(0, 10)) : '';
  const mailLine = inv.mailedAt ? (inv.mailTo ? `Lähetetty sähköpostiin ${inv.mailTo} ${mailedOn}` : `Lähetetty pelaajan sähköpostiin ${mailedOn}`)
    : inv.status === 'sent' && !reachesPlayer && !inv.payerEmail ? 'Maksaja ei saa laskua sähköpostiin. Jaa linkki.' : null;

  let footer = null;
  if (inv.status === 'draft') {
    footer = (
      <Button variant="dark" size="lg" block loading={busy === 'send'} missing={total > 0 ? null : 'Laskulla ei ole veloitettavaa.'} onClick={send}>
        Lähetä lasku
      </Button>
    );
  } else if (inv.status === 'sent') {
    footer = (
      <div className="sheet-actions">
        <ShareTextButton variant="soft" size="lg" label="Jaa" text={invoiceShareText(inv, invoiceLink(inv.publicToken))} title={`Lasku ${inv.number}`} />
        <Button variant="dark" size="lg" loading={busy === 'paid'} onClick={() => act('paid', () => api.billing.setPaid(inv.id, true), 'Merkitty maksetuksi.')}>Maksettu</Button>
      </div>
    );
  } else if (inv.status === 'paid' && inv.paidVia !== 'stripe') {
    footer = <Button variant="soft" size="lg" block loading={busy === 'unpaid'} onClick={() => act('unpaid', () => api.billing.setPaid(inv.id, false), 'Merkitty maksamattomaksi.')}>Ei maksettu</Button>;
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} size="lg" title={student?.name || inv.payerName}
        subtitle={invoiceGroups(inv, state.groups) || undefined} footer={footer}>
        {inv.status === 'draft' ? (
          <div className="stack-4">
            <DraftEditor inv={inv} student={student} busy={busy} act={act} onPayer={() => setPayerOpen(true)}
              onAddLine={() => setLineSheet({ line: null })} onEditLine={(l) => setLineSheet({ line: l })} />
            <button type="button" className="k-textlink is-danger bill-remove" disabled={Boolean(busy)} onClick={removeDraft}>Poista luonnos</button>
          </div>
        ) : (
          <div className="stack-4">
            <div className="bill-sent-head">
              <Chip size="sm" tone={INVOICE_STATES[st].tone}>{INVOICE_STATES[st].label}{inv.paidVia === 'stripe' && st === 'maksettu' ? ' verkossa' : ''}</Chip>
              {mailLine && <span className="k-fine">{mailLine}</span>}
            </div>
            <InvoiceView invoice={inv} />
            <div className="bill-doc-actions">
              <Button variant="outline" size="sm" icon="download" onClick={() => downloadPdf(inv, print)}>Lataa PDF</Button>
              {inv.status === 'sent' && mailReady && (
                <Button variant="outline" size="sm" icon="mail" onClick={() => setMailOpen(true)}>{inv.mailedAt ? 'Lähetä uudelleen' : 'Lähetä sähköpostiin'}</Button>
              )}
              {inv.status === 'sent' && mailReady && (reachesPlayer || inv.payerEmail) && (
                <Button variant="outline" size="sm" icon="bell" loading={busy === 'remind'} onClick={remind}>Muistuta</Button>
              )}
              {inv.status !== 'void' && <button type="button" className="k-textlink is-danger" disabled={Boolean(busy)} onClick={voidIt}>Mitätöi</button>}
            </div>
          </div>
        )}
      </Sheet>
      <PayerSheet open={payerOpen} onClose={() => setPayerOpen(false)} invoice={inv} student={student} />
      <LineSheet open={Boolean(lineSheet)} onClose={() => setLineSheet(null)} invoice={inv} line={lineSheet?.line || null} />
      <MailSheet open={mailOpen} onClose={() => setMailOpen(false)} invoice={inv} student={student} />
      {portal}
    </>
  );
}
