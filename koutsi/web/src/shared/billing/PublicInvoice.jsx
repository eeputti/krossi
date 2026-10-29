// PublicInvoice.jsx — koutsi.krossi.app/lasku/<token>: one invoice for whoever has the link (a parent,
// a player without the app). No sign-in and no app chrome: the document, Tulosta / PDF, and a line
// when it is void. The worker serves this from the player shell and adds `X-Robots-Tag: noindex`.
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../../api/index.js';
import { Button, EmptyState, ErrorState, SkeletonList, ToastProvider } from '../../ui/index.js';
import { InvoiceView } from './InvoiceView.jsx';

const INVOICE_PATH = /^(?:\/demo)?\/lasku\/([0-9a-f-]{36})\/?$/i;

/** The token of an invoice link's address, or null when the address is something else. */
export function invoiceTokenFromPath(pathname) {
  const m = INVOICE_PATH.exec(pathname || '');
  return m ? m[1].toLowerCase() : null;
}

function PublicInvoicePage({ token }) {
  const [view, setView] = useState({ loading: true, invoice: null, error: null });
  const load = useCallback(async () => {
    setView({ loading: true, invoice: null, error: null });
    try {
      setView({ loading: false, invoice: await api.billing.byToken(token), error: null });
    } catch (error) {
      setView({ loading: false, invoice: null, error });
    }
  }, [token]);
  useEffect(() => { load(); }, [load]);
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
        <InvoiceView invoice={inv} />
        <div className="inv-public-actions inv-noprint">
          <Button variant="dark" size="lg" icon="download" onClick={() => window.print()}>Tulosta / PDF</Button>
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
