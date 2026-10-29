// BillingScreen — Laskutus (/valmentaja/laskutus): one button to bill ("Laskuta"), then the
// invoices: drafts (Lähetä kaikki), open ones (overdue first) and paid ones. The gear opens the
// settings. Before the first invoice: "Aloita" walks through Laskuttaja → Hinnat, and "En tarvitse
// laskutusta vielä" takes Laskutus out of the side nav (Profiili brings it back).
// Shown only while Laskutus is on for the coach (useBilling().enabled); ?lasku=<id> opens one invoice.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { dropQueryParam, navigate, useRoute } from '../app/router.js';
import { Avatar, Button, Chip, EmptyState, IconButton, Page, PageHeader, Section, SkeletonList, useConfirm, useToast } from '../ui/index.js';
import { koutsiTodayStr } from '../domain/core.js';
import { INVOICE_STATES, countsLine, euros, fiDate, invoiceGroups, invoiceState, lineCounts, totalOf } from '../domain/billing.js';
import { useBilling } from '../shared/billing/BillingProvider.jsx';
import {
  BillerSheet, DeliveryLine, InvoiceSheet, NewBillingSheet, PaymentsSheet, PricesSheet, SettingsSheet, TermsSheet, deliverySummary,
  mailReadyOf, sendAndMail, sentLine,
} from './BillingSheets.jsx';
import { track } from './usage.js';

const PAID_SHOWN = 10;

/**
 * One invoice as a card: who it is for (photo, name, group), the sum, where it goes (e-mail, the
 * player's Koutsi, or a warning) and what is billed or its number and due date. Big sums, so all of
 * it shows before anything is sent.
 */
function InvoiceCard({ inv, student, groups, today, onOpen }) {
  const st = invoiceState(inv, today);
  const draft = inv.status === 'draft';
  const name = student?.name || inv.payerName;
  const counts = countsLine(lineCounts(inv.lines.filter((l) => l.charged)));
  const what = draft
    ? counts.charAt(0).toUpperCase() + counts.slice(1)
    : st === 'maksettu' ? `Nro ${inv.number}, maksettu${inv.paidVia === 'stripe' ? ' verkossa' : ''}`
      : `Nro ${inv.number}, eräpäivä ${fiDate(inv.dueDate)}`;
  return (
    <button type="button" className="k-row bill-card" onClick={() => onOpen(inv.id)}>
      <span className="bill-card-head">
        <Avatar person={student} name={name} src={student?.avatarUrl} size={42} />
        <span className="k-row-main">
          <span className="k-row-title truncate">{name}</span>
          {groups && <span className="k-row-sub truncate">{groups}</span>}
        </span>
        <span className="bill-card-amount t-num">{euros(draft ? totalOf(inv.lines) : inv.totalCents)}</span>
      </span>
      {st !== 'maksettu' && <DeliveryLine inv={inv} student={student} />}
      <span className="bill-card-foot">
        <span className="truncate">{what}</span>
        {(st === 'myohassa' || st === 'avoin') && <Chip size="sm" tone={INVOICE_STATES[st].tone}>{INVOICE_STATES[st].label}</Chip>}
      </span>
    </button>
  );
}

export function BillingScreen() {
  const { state, ownerId } = useData();
  const billing = useBilling();
  const route = useRoute();
  const confirm = useConfirm();
  const toast = useToast();
  const [sheet, setSheet] = useState(null); // asetukset | laskuttaja | hinnat | ehdot | maksut | laskuta
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

  // Back from Stripe's onboarding (?tili=valmis), or its link ran out (?tili=uusi: a new one at once).
  const tili = route.query.tili;
  useEffect(() => {
    if (!tili || !billing.ready || !billing.enabled) return;
    dropQueryParam('tili');
    (async () => {
      if (tili === 'uusi') {
        const again = await billing.run(() => api.billing.connectPayments(ownerId));
        if (again.ok && again.result?.url) window.location.assign(again.result.url);
        return;
      }
      const res = await billing.run(() => api.billing.paymentStatus(ownerId));
      if (res.ok) {
        toast(res.result?.state === 'ready' ? 'Verkkomaksut käytössä.' : 'Stripe tarvitsee vielä tietoja. Jatka Asetuksista.', { tone: res.result?.state === 'ready' ? undefined : 'info' });
      }
    })();
  }, [tili, billing.ready, billing.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Payments made online but not confirmed yet (the payer closed Stripe's page): checked once per visit.
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current || !billing.ready || !billing.biller?.stripeAccountId) return;
    if (!(billing.invoices || []).some((x) => x.status === 'sent' && x.checkoutSessionId)) return;
    synced.current = true;
    api.billing.syncPayments(ownerId).then((r) => {
      if (r?.updated) {
        billing.reload();
        toast(`${r.updated} ${r.updated === 1 ? 'lasku maksettu' : 'laskua maksettu'} verkossa.`);
      }
    }).catch(() => {});
  }, [billing.ready, billing.invoices, billing.biller]); // eslint-disable-line react-hooks/exhaustive-deps

  const studentOf = (inv) => state.students.find((s) => s.id === inv.studentId) || null;
  const card = (x) => (
    <InvoiceCard key={x.id} inv={x} student={studentOf(x)} groups={invoiceGroups(x, state.groups)} today={today} onOpen={openInvoice} />
  );
  const openInvoice = (id) => { track('laskutus.avaa'); setOpenId(id); };
  const closeInvoice = () => { setOpenId(null); if (route.query.lasku) dropQueryParam('lasku'); };
  const sendAll = async () => {
    const n = lists.drafts.length;
    const sum = lists.drafts.reduce((s, x) => s + totalOf(x.lines), 0);
    const message = `Yhteensä ${euros(sum)}. ${deliverySummary(lists.drafts, studentOf)}`.trim();
    if (sending || !(await confirm({ title: `Lähetetäänkö ${n} ${n === 1 ? 'lasku' : 'laskua'}?`, message, confirmLabel: 'Lähetä' }))) return;
    setSending(true);
    const ids = lists.drafts.map((x) => x.id);
    const res = await billing.run(() => sendAndMail(ids, mailReadyOf(billing)));
    setSending(false);
    if (!res.ok) return;
    if (res.result?.mailError) toast(`Laskut lähetetty, mutta sähköposti ei lähtenyt: ${res.result.mailError.userMessage || res.result.mailError.message}`, { tone: 'info', duration: 6000 });
    else toast(sentLine(n, res.result?.mailed));
  };
  // "En tarvitse laskutusta vielä": out of the side nav and Lisää, back from Profiili
  const notYet = async () => {
    const res = await billing.run(() => api.billing.setHidden(ownerId, true));
    if (!res.ok) return;
    toast('Laskutus piilotettu. Saat sen takaisin Profiilista.');
    navigate('/valmentaja/koti');
  };

  const sheets = (
    <>
      <SettingsSheet open={sheet === 'asetukset'} onClose={() => setSheet(null)} onPick={setSheet} />
      <BillerSheet open={sheet === 'laskuttaja'} onClose={() => setSheet(null)} onSaved={() => { if (!billing.biller) setSheet('hinnat'); }} />
      <PricesSheet open={sheet === 'hinnat'} onClose={() => setSheet(null)} />
      <TermsSheet open={sheet === 'ehdot'} onClose={() => setSheet(null)} />
      <PaymentsSheet open={sheet === 'maksut'} onClose={() => setSheet(null)} />
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
        <EmptyState art="money" title="Laskut suoraan läsnäoloista"
          action={(
            <div className="bill-start-actions">
              <Button variant="lime" size="lg" onClick={() => { track('laskutus.aloita'); setSheet('laskuttaja'); }}>Aloita</Button>
              {billing.prefsReady && !billing.hidden && (
                <button type="button" className="k-textlink" onClick={() => { track('laskutus.ei-viela'); notYet(); }}>En tarvitse laskutusta vielä</button>
              )}
            </div>
          )} />
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
          <div className="k-list">{lists.drafts.map(card)}</div>
        </Section>
      )}
      {lists.open.length > 0 && (
        <Section title="Avoimet">
          <div className="k-list">{lists.open.map(card)}</div>
        </Section>
      )}
      {lists.paid.length > 0 && (
        <Section title="Maksetut">
          <div className="k-list">{paidShown.map(card)}</div>
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
