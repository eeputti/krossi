// PublicInvoice.jsx — koutsi.krossi.app/lasku/<token>: one invoice for whoever has the link (a parent,
// a player without the app). No sign-in and no app chrome: "Maksa" when the coach takes payments online
// (Stripe Checkout, back here with ?maksu=<session>, confirmed by koutsi-pay), the document, Tulosta / PDF,
// and a line when it is void or just paid. The worker serves this from the player shell (`X-Robots-Tag: noindex`).
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../../api/index.js';
import { Button, EmptyState, ErrorState, SkeletonList, ToastProvider, useToast } from '../../ui/index.js';
import { euros } from '../../domain/billing.js';
import { InvoiceView } from './InvoiceView.jsx';

const INVOICE_PATH = /^(?:\/demo)?\/lasku\/([0-9a-f-]{36})\/?$/i;

/** The token of an invoice link's address, or null when the address is something else. */
export function invoiceTokenFromPath(pathname) {
  const m = INVOICE_PATH.exec(pathname || '');
  return m ? m[1].toLowerCase() : null;
}

/** Back from Stripe Checkout: ?maksu=<session> — confirmed once, then dropped from the address. */
function takeSessionFromAddress() {
  const url = new URL(window.location.href);
  const session = url.searchParams.get('maksu');
  if (session) {
    url.searchParams.delete('maksu');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
  return session;
}

function PublicInvoicePage({ token }) {
  const toast = useToast();
  const [view, setView] = useState({ loading: true, invoice: null, error: null });
  const [thanks, setThanks] = useState(false);
  const [paying, setPaying] = useState(false);
  const load = useCallback(async (session = null) => {
    setView((v) => ({ ...v, loading: !v.invoice, error: null }));
    try {
      if (session) {
        const r = await api.billing.confirmPayment(token, session).catch(() => null);
        if (r?.paid) setThanks(true);
      }
      setView({ loading: false, invoice: await api.billing.byToken(token), error: null });
    } catch (error) {
      setView({ loading: false, invoice: null, error });
    }
  }, [token]);
  useEffect(() => { load(takeSessionFromAddress()); }, [load]);
  const pay = async () => {
    if (paying) return;
    setPaying(true);
    try {
      const r = await api.billing.payInvoice(token);
      if (r?.url) { window.location.assign(r.url); return; }
      if (r?.paid) { setThanks(true); await load(); }
    } catch (err) {
      toast(err);
    }
    setPaying(false);
  };
  const inv = view.invoice;
  useEffect(() => {
    if (inv) document.title = `Lasku ${inv.number} · ${inv.seller?.name || 'Krossi Koutsi'}`;
  }, [inv]);
  let content;
  if (view.loading) content = <SkeletonList count={3} />;
  else if (view.error) content = <ErrorState error={view.error} onRetry={load} />;
  else if (!inv) content = <EmptyState art="search" title="Laskua ei löytynyt" text="Linkki voi olla vanha." />;
  else {
    content = (
      <>
        {inv.status === 'void' && <p className="inv-public-note">Tämä lasku on mitätöity. Sitä ei tarvitse maksaa.</p>}
        {thanks && inv.status === 'paid' && <p className="inv-public-note is-thanks inv-noprint">Kiitos! Maksu on vastaanotettu.</p>}
        {inv.payable && (
          <div className="inv-public-pay inv-noprint">
            <Button variant="lime" size="lg" block loading={paying} onClick={pay}>Maksa {euros(inv.totalCents)}</Button>
          </div>
        )}
        <InvoiceView invoice={inv} />
        <div className="inv-public-actions inv-noprint">
          <Button variant="outline" size="lg" icon="download" onClick={() => window.print()}>Tulosta / PDF</Button>
        </div>
      </>
    );
  }
  return (
    <main className="inv-public">
      {content}
      <p className="inv-public-foot inv-noprint">Krossi Koutsi</p>
    </main>
  );
}

export function mountInvoicePage(token) {
  createRoot(document.getElementById('root')).render(
    <ToastProvider>
      <PublicInvoicePage token={token} />
    </ToastProvider>,
  );
}
