// InvoiceScreen — /pelaa/lasku/:id: a kausivuoro invoice as a printable A4 page, for the hall's
// staff and the slot's holder. Seller and recipient, the lines with VAT, and the payment details a
// Finnish bank needs (IBAN, BIC, viitenumero, eräpäivä) plus the virtual barcode to paste into the
// online bank. "Tulosta" prints just the paper (print styles hide the app around it); staff can
// e-mail it to the billing address and mark it paid.
import { api, isDemo } from '../../api/index.js';
import { useAsync, useBusy } from '../../app/hooks.js';
import { goBack } from '../../app/router.js';
import { formatIban, formatReference, invoiceState, virtualBarcode } from '../../features/seasons.js';
import { Button, EmptyState, ErrorState, Icon, Page, Skeleton, TopBar, useConfirm, useToast } from '../../ui/index.js';
import { InvoiceStateChip } from './SeasonParts.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

/** '1 785,00 €' — invoices always show cents. */
export function invoiceEuro(cents) {
  const sign = cents < 0 ? '−' : '';
  const [whole, decimals] = (Math.abs(cents) / 100).toFixed(2).split('.');
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${decimals} €`;
}

const fiDate = (key) => (key ? `${Number(key.slice(8, 10))}.${Number(key.slice(5, 7))}.${key.slice(0, 4)}` : '');

export function InvoiceScreen({ params }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, run] = useBusy();
  const invoice = useAsync(() => api.billing.getInvoice(params.id), [params.id]);
  const venues = useAsync(() => api.booking.listVenues(), []);
  const inv = invoice.data;
  const venue = inv ? (venues.data || []).find((v) => v.id === inv.venueId) : null;
  const isStaff = Boolean(venue?.isStaff);
  const back = isStaff ? `/pelaa/halli/${venue.slug}?nakyma=laskutus` : '/pelaa/omat-varaukset';

  if (invoice.loading && !inv) {
    return (
      <>
        <TopBar title="Lasku" back={back} className="inv-noprint" />
        <Page width="wide" className="inv-page"><Skeleton h={640} r={6} /></Page>
      </>
    );
  }
  if (invoice.error && !inv) {
    return (
      <>
        <TopBar title="Lasku" back={back} className="inv-noprint" />
        <Page><ErrorState error={invoice.error} onRetry={() => invoice.reload()} /></Page>
      </>
    );
  }
  if (!inv) {
    return (
      <>
        <TopBar title="Lasku" back={back} />
        <Page><EmptyState art="search" title="Laskua ei löytynyt" text="Lasku näkyy vain hallin henkilökunnalle ja kausivuoron haltijalle." /></Page>
      </>
    );
  }

  const state = invoiceState(inv);
  const s = inv.seller;
  const net = inv.amountCents - inv.vatCents;
  const barcode = virtualBarcode({ iban: s.iban, cents: inv.amountCents, reference: inv.reference, dueOn: inv.dueOn });

  const send = () => run(async () => {
    try {
      const { sentTo } = await api.billing.sendInvoice(inv.id);
      toast(`Lasku lähetetty: ${sentTo}`, { icon: 'check' });
      invoice.reload({ silent: true });
    } catch (err) {
      toast(err);
    }
  });

  const markPaid = async () => {
    const ok = await confirm({ title: 'Merkitäänkö maksetuksi?', message: `Lasku ${inv.number}, ${invoiceEuro(inv.amountCents)}. Maksupäivä tänään.`, confirmLabel: 'Merkitse maksetuksi' });
    if (!ok) return;
    await run(async () => {
      try {
        invoice.setData(await api.billing.markInvoicePaid(inv.id, null));
        toast('Lasku merkitty maksetuksi.', { icon: 'check' });
      } catch (err) {
        toast(err);
      }
    });
  };

  return (
    <>
      <TopBar
        title={`Lasku ${inv.number}`}
        back={back}
        className="inv-noprint"
        actions={<Button variant="soft" size="sm" icon="download" onClick={() => window.print()}>Tulosta</Button>}
      />
      <Page width="wide" className="inv-page">
        <div className="inv-toolbar inv-noprint">
          <InvoiceStateChip invoice={inv} size="md" />
          {inv.sentAt && <span className="inv-sent"><Icon name="mail" size={14} />Lähetetty {fiDate(inv.sentAt.slice(0, 10))}</span>}
          <span className="inv-toolbar-space" />
          {isStaff && state !== 'void' && <Button variant="outline" size="sm" icon="mail" loading={busy} disabled={!inv.recipient.email} onClick={send}>Lähetä sähköpostilla</Button>}
          {isStaff && inv.status === 'open' && <Button variant="dark" size="sm" icon="check" disabled={busy} onClick={markPaid}>Merkitse maksetuksi</Button>}
        </div>
        {isDemo && <p className="inv-demo inv-noprint"><Icon name="info" size={15} />Demotila — esimerkkilasku. Tilitiedot ja Y-tunnus eivät ole oikeita.</p>}

        <article className={cx('inv-paper', `is-${state}`)} aria-label={`Lasku ${inv.number}`}>
          <header className="inv-head">
            <div className="inv-seller">
              <b>{s.name}</b>
              {s.address && <span>{s.address}</span>}
              {s.businessId && <span>Y-tunnus {s.businessId}</span>}
              {(s.email || s.phone) && <span>{[s.email, s.phone].filter(Boolean).join(' · ')}</span>}
            </div>
            <div className="inv-meta">
              <h1 className="inv-title">LASKU</h1>
              <dl>
                <div><dt>Laskun numero</dt><dd className="t-num">{inv.number}</dd></div>
                <div><dt>Päiväys</dt><dd className="t-num">{fiDate(inv.issuedOn)}</dd></div>
                <div><dt>Eräpäivä</dt><dd className="t-num">{fiDate(inv.dueOn)}</dd></div>
                <div><dt>Viitenumero</dt><dd className="t-num">{formatReference(inv.reference)}</dd></div>
              </dl>
            </div>
          </header>

          <section className="inv-recipient">
            <span className="inv-label">Vastaanottaja</span>
            <b>{inv.recipient.name}</b>
            {inv.recipient.address && <span>{inv.recipient.address}</span>}
            {inv.recipient.email && <span>{inv.recipient.email}</span>}
          </section>

          <table className="inv-lines">
            <thead>
              <tr><th>Kuvaus</th><th className="is-num">Määrä</th><th className="is-num">À-hinta</th><th className="is-num">Yhteensä</th></tr>
            </thead>
            <tbody>
              {inv.lines.map((line, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={i}>
                  <td>{line.text}</td>
                  <td className="is-num">{line.unit ? `${line.quantity} ${line.unit}` : ''}</td>
                  <td className="is-num">{line.unitCents != null ? invoiceEuro(line.unitCents) : ''}</td>
                  <td className="is-num">{invoiceEuro(line.totalCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={3}>Veroton yhteensä</td><td className="is-num">{invoiceEuro(net)}</td></tr>
              <tr><td colSpan={3}>ALV {String(inv.vatPercent).replace('.', ',')} %</td><td className="is-num">{invoiceEuro(inv.vatCents)}</td></tr>
              <tr className="inv-total"><td colSpan={3}>Yhteensä</td><td className="is-num">{invoiceEuro(inv.amountCents)}</td></tr>
            </tfoot>
          </table>

          <section className="inv-pay" aria-label="Maksutiedot">
            <div><span className="inv-label">Saaja</span><b>{s.name}</b></div>
            <div><span className="inv-label">Saajan tilinumero (IBAN)</span><b className="t-num">{s.iban ? formatIban(s.iban) : '—'}</b></div>
            {s.bic && <div><span className="inv-label">BIC</span><b>{s.bic}</b></div>}
            <div><span className="inv-label">Viitenumero</span><b className="t-num">{formatReference(inv.reference)}</b></div>
            <div><span className="inv-label">Eräpäivä</span><b className="t-num">{fiDate(inv.dueOn)}</b></div>
            <div><span className="inv-label">Euro</span><b className="t-num">{invoiceEuro(inv.amountCents)}</b></div>
          </section>
          {barcode && (
            <p className="inv-barcode"><span className="inv-label">Virtuaaliviivakoodi</span><code>{barcode}</code></p>
          )}
          <footer className="inv-foot">
            {state === 'paid' ? `Maksettu ${fiDate(inv.paidOn)} — kiitos!` : state === 'overdue' ? 'Lasku on erääntynyt. Maksathan sen pian viitenumerolla.' : 'Käytäthän maksaessa viitenumeroa.'}
            {' '}Laskun summa sisältää arvonlisäveron.
          </footer>
        </article>

        <div className="inv-actions inv-noprint">
          <Button variant="dark" icon="download" onClick={() => window.print()}>Tulosta tai tallenna PDF</Button>
          <Button variant="ghost" onClick={() => goBack(back)}>Takaisin</Button>
        </div>
      </Page>
    </>
  );
}
