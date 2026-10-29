// InvoicesScreen — the player's invoices (/pelaaja/laskut, one opened at /pelaaja/laskut/:id, the
// address the "Uusi lasku" notification links to): open ones first, then paid. An invoice opens as
// the same document the coach sends, with the payment details to copy and Tulosta / PDF.
import { navigate } from '../app/router.js';
import { Button, Chip, EmptyState, Page, Sheet, SkeletonList, TopBar } from '../ui/index.js';
import { koutsiTodayStr } from '../domain/core.js';
import { INVOICE_STATES, euros, fiDate, invoiceState } from '../domain/billing.js';
import { useBilling } from '../shared/billing/BillingProvider.jsx';
import { InvoiceView, useInvoicePrint } from '../shared/billing/InvoiceView.jsx';

export const invoicesPath = '/pelaaja/laskut';
const invoicePath = (id) => `/pelaaja/laskut/${encodeURIComponent(id)}`;

export function InvoicesScreen({ params = {} }) {
  const billing = useBilling();
  const { print, portal } = useInvoicePrint();
  const today = koutsiTodayStr();
  const list = [...(billing.invoices || [])].sort((a, b) => (a.status === b.status ? (b.sentAt || '').localeCompare(a.sentAt || '') : a.status === 'sent' ? -1 : 1));
  const open = params.id ? list.find((x) => x.id === params.id) || null : null;
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
        footer={open ? <Button variant="outline" size="lg" block icon="download" onClick={() => print(open)}>Tulosta / PDF</Button> : null}>
        {open && <InvoiceView invoice={open} />}
      </Sheet>
      {portal}
    </>
  );
}
