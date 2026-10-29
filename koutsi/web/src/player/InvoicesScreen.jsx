// InvoicesScreen — the player's invoices (/pelaaja/laskut, one opened at /pelaaja/laskut/:id, the
// address the "Uusi lasku" notification links to): open ones first, then paid. An invoice opens as
// the same document the coach sends, with the payment details to copy, Tulosta / PDF, and "Maksa" when the
// coach takes payments online (Stripe's page; the invoice's own page confirms it on the way back).
import { useState } from 'react';
import { api } from '../api/index.js';
import { navigate } from '../app/router.js';
import { Button, Chip, EmptyState, Page, Sheet, SkeletonList, TopBar, useToast } from '../ui/index.js';
import { koutsiTodayStr } from '../domain/core.js';
import { INVOICE_STATES, canPayOnline, euros, fiDate, invoiceState } from '../domain/billing.js';
import { useBilling } from '../shared/billing/BillingProvider.jsx';
import { InvoiceView, useInvoicePrint } from '../shared/billing/InvoiceView.jsx';

export const invoicesPath = '/pelaaja/laskut';
const invoicePath = (id) => `/pelaaja/laskut/${encodeURIComponent(id)}`;

export function InvoicesScreen({ params = {} }) {
  const billing = useBilling();
  const toast = useToast();
  const { print, portal } = useInvoicePrint();
  const [paying, setPaying] = useState(false);
  const today = koutsiTodayStr();
  const list = [...(billing.invoices || [])].sort((a, b) => (a.status === b.status ? (b.sentAt || '').localeCompare(a.sentAt || '') : a.status === 'sent' ? -1 : 1));
  const open = params.id ? list.find((x) => x.id === params.id) || null : null;
  const payable = canPayOnline(open, billing.terms);
  // "Maksa": Stripe's page, back to the invoice's own page (which confirms the payment)
  const pay = async () => {
    if (!open || paying) return;
    setPaying(true);
    try {
      const r = await api.billing.payInvoice(open.publicToken);
      if (r?.url) { window.location.assign(r.url); return; }
      if (r?.paid) { await billing.reload(); toast('Maksettu.'); }
    } catch (err) {
      toast(err);
    }
    setPaying(false);
  };
  let content;
  if (!billing.loaded) content = <SkeletonList count={2} />;
  else if (!list.length) content = <EmptyState art="court" title="Ei laskuja" />;
  else {
    content = (
      <div className="k-list">
        {list.map((inv) => {
          const st = invoiceState(inv, today);
          return (
            <button key={inv.id} type="button" className="k-row bill-row" onClick={() => navigate(invoicePath(inv.id))}>
              <span className="k-row-main">
                <span className="k-row-title truncate">{inv.seller?.name || 'Lasku'}</span>
                <span className="k-row-sub truncate">Nro {inv.number} · {st === 'maksettu' ? 'maksettu' : `eräpäivä ${fiDate(inv.dueDate)}`}</span>
              </span>
              <span className="bill-row-end">
                <span className="bill-amount t-num">{euros(inv.totalCents)}</span>
                {st !== 'maksettu' && <Chip size="sm" tone={INVOICE_STATES[st].tone}>{INVOICE_STATES[st].label}</Chip>}
              </span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <>
      <TopBar title="Laskut" back="/pelaaja/koti" />
      <Page className="k-page-pad">{content}</Page>
      <Sheet open={Boolean(open)} onClose={() => navigate(invoicesPath, { replace: true })} size="lg"
        title={open ? `Lasku ${open.number}` : ''} subtitle={open ? euros(open.totalCents) : ''}
        footer={open ? (payable ? (
          <div className="sheet-actions">
            <Button variant="soft" size="lg" icon="download" onClick={() => print(open)}>PDF</Button>
            <Button variant="dark" size="lg" loading={paying} onClick={pay}>Maksa {euros(open.totalCents)}</Button>
          </div>
        ) : <Button variant="outline" size="lg" block icon="download" onClick={() => print(open)}>Tulosta / PDF</Button>) : null}>
        {open && <InvoiceView invoice={open} />}
      </Sheet>
      {portal}
    </>
  );
}
