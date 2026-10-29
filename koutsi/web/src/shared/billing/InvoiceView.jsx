// InvoiceView.jsx — one invoice as a document: the same page for the coach, the player and anyone
// with the link (lasku/<token>). Plain and printable: seller, dates, viitenumero, the charged lines,
// the total (VAT split or "ei ALV-velvollinen"), and the payment details to copy into a bank app.
// printInvoice(invoice) prints just this document (a portal on <body>; everything else is hidden).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/index.js';
import { euros, invoiceDoc } from '../../domain/billing.js';
import { Button } from '../../ui/index.js';
import { CopyButton } from '../bits.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

/**
 * "Maksa": MobilePay, Apple Pay, Google Pay or a card on Stripe's page. With `klarna` a second
 * button for Klarna (pay now, in 30 days or in parts): its own page, as Klarna's fee is bigger and
 * the coach pays the fee of the way the player chose. `paying` = the method being opened.
 */
export function PayButtons({ cents, klarna, paying, onPay, variant = 'lime' }) {
  return (
    <div className="inv-pay">
      <Button variant={variant} size="lg" block loading={paying === 'card'} disabled={Boolean(paying)} onClick={() => onPay('card')}>
        Maksa {euros(cents)}
      </Button>
      <span className="inv-pay-hint">MobilePay, Apple Pay, Google Pay tai kortti</span>
      {klarna && (
        <>
          <Button variant="outline" size="lg" block loading={paying === 'klarna'} disabled={Boolean(paying)} onClick={() => onPay('klarna')}>
            Maksa Klarnalla
          </Button>
          <span className="inv-pay-hint">Maksa nyt, 30 päivän päästä tai erissä</span>
        </>
      )}
    </div>
  );
}

export function InvoiceView({ invoice, className }) {
  const doc = invoiceDoc(invoice);
  const stamp = invoice.status === 'paid' ? 'Maksettu' : invoice.status === 'void' ? 'Mitätöity' : null;
  const address = (s) => String(s || '').split('\n').filter(Boolean);
  return (
    <article className={cx('inv-doc', className)}>
      <header className="inv-head">
        <div className="inv-from">
          {doc.seller.logoPath && api.billing.logoUrl(doc.seller.logoPath) && <img className="inv-logo" src={api.billing.logoUrl(doc.seller.logoPath)} alt="" />}
          <div className="inv-seller">{doc.seller.name}</div>
          {address(doc.seller.address).map((l) => <div key={l} className="inv-muted">{l}</div>)}
          {doc.seller.businessId && <div className="inv-muted">Y-tunnus {doc.seller.businessId}</div>}
          {doc.seller.email && <div className="inv-muted">{doc.seller.email}</div>}
        </div>
        <div className="inv-title">
          <span>Lasku{doc.number ? <span className="t-num"> {doc.number}</span> : null}</span>
          {stamp && <span className={cx('inv-stamp', invoice.status === 'void' && 'is-void')}>{stamp}</span>}
        </div>
      </header>

      <div className="inv-parties">
        <div>
          <div className="inv-label">Maksaja</div>
          <div className="inv-strong">{doc.payer.name}</div>
          {address(doc.payer.address).map((l) => <div key={l} className="inv-muted">{l}</div>)}
        </div>
        <dl className="inv-meta">
          {doc.issueDate && <><dt>Päiväys</dt><dd className="t-num">{doc.issueDate}</dd></>}
          {doc.dueDate && <><dt>Eräpäivä</dt><dd className="t-num">{doc.dueDate}</dd></>}
          {doc.reference && <><dt>Viitenumero</dt><dd className="t-num">{doc.reference}</dd></>}
          {doc.period && <><dt>Jakso</dt><dd className="t-num">{doc.period}</dd></>}
        </dl>
      </div>

      {doc.note && <p className="inv-note-text">{doc.note}</p>}

      <table className="inv-lines">
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.id}>
              <td className="inv-when t-num">{l.when}</td>
              <td className="inv-what">{l.text}</td>
              <td className="inv-sum t-num">{l.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {doc.freeCount > 0 && <p className="inv-muted inv-free">Lisäksi {doc.freeCount} {doc.freeCount === 1 ? 'kerta' : 'kertaa'} ilman veloitusta.</p>}

      <div className="inv-totals">
        {doc.vat && (
          <>
            <div className="inv-total-row inv-muted"><span>Veroton</span><span className="t-num">{euros(doc.vat.net)}</span></div>
            <div className="inv-total-row inv-muted"><span>ALV {String(doc.vat.rate).replace('.', ',')} %</span><span className="t-num">{euros(doc.vat.vat)}</span></div>
          </>
        )}
        <div className="inv-total-row inv-grand"><span>Yhteensä</span><span className="t-num">{doc.totalText}</span></div>
        {doc.vatNote && <p className="inv-muted inv-note">{doc.vatNote}</p>}
      </div>

      {invoice.status !== 'void' && doc.iban && (
        <div className="inv-pay">
          <PayRow label="Saaja" value={doc.seller.name} />
          <PayRow label="Tilinumero" value={doc.iban} copy={doc.iban.replace(/\s/g, '')} />
          {doc.bic && <PayRow label="BIC" value={doc.bic} />}
          {doc.reference && <PayRow label="Viitenumero" value={doc.reference} copy={doc.reference.replace(/\s/g, '')} />}
          <PayRow label="Summa" value={doc.totalText} />
          {doc.dueDate && <PayRow label="Eräpäivä" value={doc.dueDate} />}
          {doc.barcode && invoice.status === 'sent' && (
            <div className="inv-barcode">
              <span className="inv-label">Virtuaaliviivakoodi</span>
              <code className="t-num">{doc.barcode}</code>
              <CopyButton text={doc.barcode} label="Kopioi" size="sm" variant="outline" className="inv-noprint" />
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function PayRow({ label, value, copy }) {
  return (
    <div className="inv-pay-row">
      <span className="inv-label">{label}</span>
      <span className="inv-pay-value t-num">{value}</span>
      {copy ? <CopyButton text={copy} label="Kopioi" size="sm" variant="ghost" className="inv-noprint" /> : <span />}
    </div>
  );
}

/**
 * "Lataa PDF": the real PDF file (koutsi-invoice) for a sent invoice; where there is none (the demo,
 * a draft) the print dialog's "Tallenna PDF" of the same page.
 */
export function downloadPdf(invoice, print) {
  const url = invoice?.publicToken && invoice.status !== 'draft' ? api.billing.pdfUrl(invoice.publicToken) : null;
  if (url) {
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    a.download = `lasku-${invoice.number || ''}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  print(invoice);
}

/** Prints one invoice: renders it alone on <body>, opens the print dialog, cleans up after. */
export function useInvoicePrint() {
  const [printing, setPrinting] = useState(null);
  useEffect(() => {
    if (!printing) return undefined;
    const root = document.documentElement;
    root.classList.add('inv-printing');
    const done = () => { root.classList.remove('inv-printing'); setPrinting(null); };
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => window.print(), 60);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); root.classList.remove('inv-printing'); };
  }, [printing]);
  const portal = printing ? createPortal(<div className="inv-print"><InvoiceView invoice={printing} /></div>, document.body) : null;
  return { print: setPrinting, portal };
}
