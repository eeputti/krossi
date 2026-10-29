// BillingScreen — Laskutus (/valmentaja/laskutus): one button to bill ("Laskuta"), then the
// invoices: drafts (Lähetä kaikki), open ones (overdue first) and paid ones. The gear opens the
// settings. Before the first invoice: "Aloita" walks through Laskuttaja → Hinnat.
// Shown only while Laskutus is on for the coach (useBilling().enabled); ?lasku=<id> opens one invoice.
import { useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { dropQueryParam, useRoute } from '../app/router.js';
import { Button, Chip, EmptyState, IconButton, Page, PageHeader, Section, SkeletonList, useConfirm } from '../ui/index.js';
import { koutsiTodayStr } from '../domain/core.js';
import { INVOICE_STATES, countsLine, euros, fiDate, invoiceState, lineCounts, totalOf } from '../domain/billing.js';
import { useBilling } from '../shared/billing/BillingProvider.jsx';
import { BillerSheet, InvoiceSheet, NewBillingSheet, PricesSheet, SettingsSheet, TermsSheet } from './BillingSheets.jsx';
import { track } from './usage.js';

const PAID_SHOWN = 10;

function InvoiceRow({ inv, name, today, onOpen }) {
  const st = invoiceState(inv, today);
  const draft = inv.status === 'draft';
  const sub = draft
    ? countsLine(lineCounts(inv.lines.filter((l) => l.charged)))
    : `Nro ${inv.number} · ${st === 'maksettu' ? 'maksettu' : `eräpäivä ${fiDate(inv.dueDate)}`}`;
  return (
    <button type="button" className="k-row bill-row" onClick={() => onOpen(inv.id)}>
      <span className="k-row-main">
        <span className="k-row-title truncate">{name}</span>
        <span className="k-row-sub truncate">{sub}</span>
      </span>
      <span className="bill-row-end">
        <span className="bill-amount t-num">{euros(draft ? totalOf(inv.lines) : inv.totalCents)}</span>
        {(st === 'myohassa' || st === 'avoin') && <Chip size="sm" tone={INVOICE_STATES[st].tone}>{INVOICE_STATES[st].label}</Chip>}
      </span>
    </button>
  );
}

export function BillingScreen() {
  const { state } = useData();
  const billing = useBilling();
  const route = useRoute();
  const confirm = useConfirm();
  const [sheet, setSheet] = useState(null); // asetukset | laskuttaja | hinnat | ehdot | laskuta
  const [openId, setOpenId] = useState(() => route.query.lasku || null);
  const [showAllPaid, setShowAllPaid] = useState(false);
  const [sending, setSending] = useState(false);
  const today = koutsiTodayStr();

  const lists = useMemo(() => {
    const inv = billing.invoices || [];
    const open = inv.filter((x) => x.status === 'sent')
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '') || (b.number || 0) - (a.number || 0));
    return {
      drafts: inv.filter((x) => x.status === 'draft'),
      open,
      paid: inv.filter((x) => x.status === 'paid').sort((a, b) => (b.paidAt || '').localeCompare(a.paidAt || '')),
      openTotal: open.reduce((s, x) => s + x.totalCents, 0),
      overdue: open.filter((x) => invoiceState(x, today) === 'myohassa').length,
    };
  }, [billing.invoices, today]);

  const nameOf = (inv) => state.students.find((s) => s.id === inv.studentId)?.name || inv.payerName;
  const openInvoice = (id) => { track('laskutus.avaa'); setOpenId(id); };
  const closeInvoice = () => { setOpenId(null); if (route.query.lasku) dropQueryParam('lasku'); };
  const sendAll = async () => {
    const n = lists.drafts.length;
    const sum = lists.drafts.reduce((s, x) => s + totalOf(x.lines), 0);
    if (sending || !(await confirm({ title: `Lähetetäänkö ${n} ${n === 1 ? 'lasku' : 'laskua'}?`, message: `Yhteensä ${euros(sum)}.`, confirmLabel: 'Lähetä' }))) return;
    setSending(true);
    await billing.run(() => api.billing.send(lists.drafts.map((x) => x.id)), `${n} ${n === 1 ? 'lasku' : 'laskua'} lähetetty.`);
    setSending(false);
  };

  const sheets = (
    <>
      <SettingsSheet open={sheet === 'asetukset'} onClose={() => setSheet(null)} onPick={setSheet} />
      <BillerSheet open={sheet === 'laskuttaja'} onClose={() => setSheet(null)} onSaved={() => { if (!billing.biller) setSheet('hinnat'); }} />
      <PricesSheet open={sheet === 'hinnat'} onClose={() => setSheet(null)} />
      <TermsSheet open={sheet === 'ehdot'} onClose={() => setSheet(null)} />
      <NewBillingSheet open={sheet === 'laskuta'} onClose={() => setSheet(null)} onPrices={() => setSheet('hinnat')} />
      <InvoiceSheet invoiceId={openId} onClose={closeInvoice} />
    </>
  );

  if (!billing.loaded) {
    return <Page className="stack-5"><PageHeader title="Laskutus" /><SkeletonList count={3} /></Page>;
  }
  if (!billing.ready || !billing.enabled) {
    return <Page className="stack-5"><PageHeader title="Laskutus" /><EmptyState art="court" title="Laskutus ei ole käytössä" /></Page>;
  }
  if (!billing.biller) {
    return (
      <Page className="stack-5">
        <PageHeader title="Laskutus" />
        <EmptyState art="court" title="Laskut suoraan läsnäoloista"
          action={<Button variant="lime" size="lg" onClick={() => { track('laskutus.aloita'); setSheet('laskuttaja'); }}>Aloita</Button>} />
        {sheets}
      </Page>
    );
  }

  const nothing = !lists.drafts.length && !lists.open.length && !lists.paid.length;
  const paidShown = showAllPaid ? lists.paid : lists.paid.slice(0, PAID_SHOWN);
  return (
    <Page className="stack-5">
      <PageHeader title="Laskutus" actions={<IconButton icon="settings" label="Asetukset" variant="soft" onClick={() => setSheet('asetukset')} />} />
      <div className="bill-top">
        <Button variant="lime" size="lg" icon="plus" onClick={() => { track('laskutus.laskuta'); setSheet('laskuta'); }}>Laskuta</Button>
        {lists.open.length > 0 && (
          <div className="bill-open">
            <span className="bill-open-label">Avoinna</span>
            <span className="bill-open-sum t-num">{euros(lists.openTotal)}</span>
            {lists.overdue > 0 && <Chip size="sm" tone="danger">{lists.overdue} erääntynyt</Chip>}
          </div>
        )}
      </div>

      {lists.drafts.length > 0 && (
        <Section title="Luonnokset" action={{ label: sending ? 'Lähetetään…' : 'Lähetä kaikki', onClick: sendAll }}>
          <div className="k-list">{lists.drafts.map((x) => <InvoiceRow key={x.id} inv={x} name={nameOf(x)} today={today} onOpen={openInvoice} />)}</div>
        </Section>
      )}
      {lists.open.length > 0 && (
        <Section title="Avoimet">
          <div className="k-list">{lists.open.map((x) => <InvoiceRow key={x.id} inv={x} name={nameOf(x)} today={today} onOpen={openInvoice} />)}</div>
        </Section>
      )}
      {lists.paid.length > 0 && (
        <Section title="Maksetut">
          <div className="k-list">{paidShown.map((x) => <InvoiceRow key={x.id} inv={x} name={nameOf(x)} today={today} onOpen={openInvoice} />)}</div>
          {lists.paid.length > PAID_SHOWN && !showAllPaid && (
            <button type="button" className="k-textlink bill-more" onClick={() => setShowAllPaid(true)}>Näytä kaikki ({lists.paid.length})</button>
          )}
        </Section>
      )}
      {nothing && <p className="k-quiet">Ei vielä laskuja.</p>}
      {sheets}
    </Page>
  );
}
