// BillingSheets.jsx — Laskutus's sheets. Settings: Laskuttaja (name, IBAN, VAT, payment days),
// Hinnat (per group: per session / season fee / not billed; private lessons per hour) and
// Peruutukset (limit, late and no-show charged). "Laskuta": who owes what for a period, each line
// can be switched off, then send (or keep as drafts). One invoice: a draft's lines and payer, or a
// sent one as the document with Jaa, Tulosta, Merkitse maksetuksi and Mitätöi.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import {
  Button, ChipSelect, EmptyState, Field, Icon, Input, ListRow, Select, Sheet, Switch, Textarea, Toggle, useConfirm,
} from '../ui/index.js';
import { koutsiSortGroupsBySchedule, koutsiTodayStr } from '../domain/core.js';
import { currentSeason } from '../domain/season.js';
import {
  EMPTY_BILLER, INVOICE_STATES, PRICE_MODES, VAT_MODES, billablePlayers, billedKeys, centsToInput, countsLine, draftsFrom, euros,
  formatIban, invoiceShareText, invoiceState, lineCounts, lineLabel, parseEuros, periodPresets, termsText, totalOf, validBusinessId,
  validEmail, validIban,
} from '../domain/billing.js';
import { invoiceLink, useBilling } from '../shared/billing/BillingProvider.jsx';
import { InvoiceView, useInvoicePrint } from '../shared/billing/InvoiceView.jsx';
import { ShareTextButton } from '../shared/bits.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

/** Resets a form whenever its sheet opens (the pattern the other sheets use). */
function useOnOpen(open, init) {
  const [last, setLast] = useState(false);
  if (open !== last) {
    setLast(open);
    if (open) init();
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
        <ListRow icon="euro" title="Hinnat" subtitle={[priced ? `${priced} ${priced === 1 ? 'ryhmä' : 'ryhmää'}` : 'Ei hintoja', hour ? `yksityistunti ${euros(hour)}/h` : ''].filter(Boolean).join(' · ')} onClick={() => pick('hinnat')} />
        <ListRow icon="clock" title="Peruutukset" subtitle={biller.cancelHours ? `Viimeistään ${biller.cancelHours} h ennen` : 'Ei rajaa'} onClick={() => pick('ehdot')} />
      </div>
    </Sheet>
  );
}

export function BillerSheet({ open, onClose, onSaved }) {
  const { state, ownerId } = useData();
  const billing = useBilling();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useOnOpen(open, () => {
    const b = billing.biller || { ...EMPTY_BILLER, name: state.coach?.name || '' };
    setF({
      name: b.name || '', businessId: b.businessId || '', iban: b.iban ? formatIban(b.iban) : '', address: b.address || '',
      email: b.email || '', vatMode: b.vatMode || 'none', paymentDays: String(b.paymentDays ?? 14), nextNumber: String(b.nextNumber || 1),
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
    }), 'Tallennettu.');
    setBusy(false);
    if (res.ok) { onClose(); onSaved?.(); }
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="md" title="Laskuttaja"
      footer={<Button variant="dark" size="lg" block loading={busy} missing={missing} onClick={save}>Tallenna</Button>}>
      <div className="stack-4">
        <Field label="Nimi" htmlFor="bill-name"><Input id="bill-name" value={f.name} maxLength={120} autoComplete="organization" onChange={set('name')} /></Field>
        <Field label="Tilinumero" htmlFor="bill-iban"><Input id="bill-iban" value={f.iban} autoCapitalize="characters" spellCheck={false} placeholder="FI00 0000 0000 0000 00" onChange={set('iban')} /></Field>
        <Field label="Y-tunnus" optional htmlFor="bill-ytunnus"><Input id="bill-ytunnus" value={f.businessId} placeholder="1234567-8" onChange={set('businessId')} /></Field>
        <Field label="Osoite" optional htmlFor="bill-address"><Textarea id="bill-address" rows={2} value={f.address} maxLength={300} onChange={set('address')} /></Field>
        <Field label="Sähköposti" optional htmlFor="bill-email"><Input id="bill-email" type="email" value={f.email} onChange={set('email')} /></Field>
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
      if (send) await api.billing.send(ids);
    }, send ? `${n} ${n === 1 ? 'lasku' : 'laskua'} lähetetty.` : `${n} ${n === 1 ? 'luonnos' : 'luonnosta'} tallennettu.`);
    setBusy(false);
    if (res.ok) onClose();
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
        <Field label="Sähköposti" optional htmlFor="bill-payer-email"><Input id="bill-payer-email" type="email" value={f.email} onChange={(e) => setF((x) => ({ ...x, email: e.target.value }))} /></Field>
      </div>
    </Sheet>
  );
}

function AddLineSheet({ open, onClose, invoice }) {
  const billing = useBilling();
  const [f, setF] = useState({ text: '', amount: '' });
  const [busy, setBusy] = useState(false);
  useOnOpen(open, () => setF({ text: '', amount: '' }));
  if (!invoice) return null;
  const cents = parseEuros(f.amount);
  const missing = !f.text.trim() ? 'Kirjoita selite.' : !(cents > 0) ? 'Kirjoita summa.' : null;
  const save = async () => {
    if (missing || busy) return;
    setBusy(true);
    const res = await billing.run(() => api.billing.addLine(invoice.id, { description: f.text, amountCents: cents, date: koutsiTodayStr() }));
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="sm" title="Lisää rivi"
      footer={<Button variant="dark" size="lg" block loading={busy} missing={missing} onClick={save}>Lisää</Button>}>
      <div className="stack-4">
        <Field label="Selite" htmlFor="bill-line-text"><Input id="bill-line-text" value={f.text} maxLength={200} placeholder="esim. 10 kerran kortti" onChange={(e) => setF((x) => ({ ...x, text: e.target.value }))} /></Field>
        <Field label="Summa" htmlFor="bill-line-sum">
          <span className="bill-euro"><Input id="bill-line-sum" inputMode="decimal" value={f.amount} placeholder="0" onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))} /><span aria-hidden="true">€</span></span>
        </Field>
      </div>
    </Sheet>
  );
}

export function InvoiceSheet({ invoiceId, onClose }) {
  const { state } = useData();
  const billing = useBilling();
  const confirm = useConfirm();
  const { print, portal } = useInvoicePrint();
  const live = invoiceId ? billing.invoices.find((x) => x.id === invoiceId) || null : null;
  // keeps showing while the sheet slides away (and after a draft is deleted)
  const [shown, setShown] = useState(null);
  useEffect(() => { if (live) setShown(live); }, [live]);
  const inv = live || shown;
  const [busy, setBusy] = useState(null);
  const [payerOpen, setPayerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const open = Boolean(invoiceId && live);
  if (!inv) return null;
  const student = state.students.find((s) => s.id === inv.studentId) || null;
  const st = invoiceState(inv, koutsiTodayStr());
  const act = async (key, fn, message) => {
    setBusy(key);
    const res = await billing.run(fn, message);
    setBusy(null);
    return res;
  };
  const send = () => act('send', () => api.billing.send([inv.id]), 'Lasku lähetetty.');
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
  const noNotice = Boolean(student?.isPlaceholder || inv.payerEmail || !student);

  let footer = null;
  if (inv.status === 'draft') {
    footer = <Button variant="dark" size="lg" block loading={busy === 'send'} missing={total > 0 ? null : 'Laskulla ei ole veloitettavaa.'} onClick={send}>Lähetä · {euros(total)}</Button>;
  } else if (inv.status === 'sent') {
    footer = (
      <div className="sheet-actions">
        <ShareTextButton variant="soft" size="lg" label="Jaa" text={invoiceShareText(inv, invoiceLink(inv.publicToken))} title={`Lasku ${inv.number}`} />
        <Button variant="dark" size="lg" loading={busy === 'paid'} onClick={() => act('paid', () => api.billing.setPaid(inv.id, true), 'Merkitty maksetuksi.')}>Maksettu</Button>
      </div>
    );
  } else if (inv.status === 'paid') {
    footer = <Button variant="soft" size="lg" block loading={busy === 'unpaid'} onClick={() => act('unpaid', () => api.billing.setPaid(inv.id, false), 'Merkitty maksamattomaksi.')}>Ei maksettu</Button>;
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} size="lg" title={student?.name || inv.payerName}
        subtitle={`${INVOICE_STATES[st].label} · ${euros(total)}`} footer={footer}>
        {inv.status === 'draft' ? (
          <div className="stack-4">
            <div className="list-group">
              <ListRow icon="user" title="Maksaja" subtitle={[inv.payerName, inv.payerEmail].filter(Boolean).join(' · ')} onClick={() => setPayerOpen(true)} />
            </div>
            <div className="bill-lines is-card">
              {inv.lines.map((l) => (
                <LineRow key={l.id} line={l} busy={Boolean(busy)}
                  onRemove={l.kind === 'manual' ? () => act('line', () => api.billing.removeLine(l.id)) : null}
                  onToggle={(v) => act('line', () => api.billing.setLineCharged(l.id, v))} />
              ))}
              <button type="button" className="bill-add" onClick={() => setAddOpen(true)}><Icon name="plus" size={16} />Lisää rivi</button>
            </div>
            <button type="button" className="k-textlink is-danger bill-remove" disabled={Boolean(busy)} onClick={removeDraft}>Poista luonnos</button>
          </div>
        ) : (
          <div className="stack-4">
            <InvoiceView invoice={inv} />
            {inv.status === 'sent' && noNotice && <p className="k-fine">Maksaja ei saa ilmoitusta Koutsista. Jaa lasku linkkinä.</p>}
            <div className="bill-doc-actions">
              <Button variant="outline" size="sm" icon="download" onClick={() => print(inv)}>Tulosta / PDF</Button>
              {inv.status !== 'void' && <button type="button" className="k-textlink is-danger" disabled={Boolean(busy)} onClick={voidIt}>Mitätöi</button>}
            </div>
          </div>
        )}
      </Sheet>
      <PayerSheet open={payerOpen} onClose={() => setPayerOpen(false)} invoice={inv} student={student} />
      <AddLineSheet open={addOpen} onClose={() => setAddOpen(false)} invoice={inv} />
      {portal}
    </>
  );
}
