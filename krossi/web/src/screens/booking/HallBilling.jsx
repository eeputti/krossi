// HallBilling — Hallin näkymä → Laskutus: what the hall is owed for kausivuorot. The numbers on top
// (open and overdue invoices, failed card months), the invoices (open them as printable pages, mark
// paid, e-mail), and the monthly card charges with "Veloita erääntyneet" — the same run a daily cron
// does — and every failed month with the bank's reason. Missing invoicing details are flagged with
// a way to Hallin asetukset.
import { useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync, useBusy } from '../../app/hooks.js';
import { navigate } from '../../app/router.js';
import { centsLabel } from '../../features/booking.js';
import { chargeIsDue, dayMonth, invoiceState, monthLabel } from '../../features/seasons.js';
import { Button, ErrorState, Icon, Segmented, Skeleton, StatTile, useConfirm, useToast } from '../../ui/index.js';
import { ChargeStateChip, InvoiceStateChip } from './SeasonParts.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

export function HallBilling({ venue }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, run] = useBusy();
  const [view, setView] = useState('invoices');
  const invoices = useAsync(() => api.billing.listInvoices(venue.id), [venue.id]);
  const settings = useAsync(() => api.billing.getSettings(venue.id).catch(() => null), [venue.id]);
  const charges = useAsync(() => api.billing.listCharges(venue.id), [venue.id]);

  const inv = invoices.data || [];
  const open = inv.filter((i) => invoiceState(i) === 'open');
  const overdue = inv.filter((i) => invoiceState(i) === 'overdue');
  const ch = charges.data || [];
  const failed = ch.filter((c) => c.status === 'failed');
  const due = ch.filter((c) => c.status === 'scheduled' && chargeIsDue(c));
  const sum = (list, key = 'amountCents') => list.reduce((s, x) => s + x[key], 0);
  const wait = <Skeleton w={44} h={22} r={6} />;

  const runCharges = () => run(async () => {
    try {
      const { paid, failed: f } = await api.billing.runCharges(venue.id);
      toast(paid + f === 0 ? 'Ei veloitettavia kuukausia nyt.' : `Veloitettu ${paid}${f ? `, epäonnistui ${f}` : ''}.`, { icon: f ? 'alert' : 'check' });
      charges.reload({ silent: true });
    } catch (err) {
      toast(err);
    }
  });

  const markPaid = async (invoice) => {
    const ok = await confirm({ title: 'Merkitäänkö maksetuksi?', message: `Lasku ${invoice.number}, ${invoice.recipient.name}, ${centsLabel(invoice.amountCents)}. Maksupäivä tänään.`, confirmLabel: 'Merkitse maksetuksi' });
    if (!ok) return;
    await run(async () => {
      try {
        await api.billing.markInvoicePaid(invoice.id, null);
        toast(`Lasku ${invoice.number} merkitty maksetuksi.`, { icon: 'check' });
        invoices.reload({ silent: true });
      } catch (err) {
        toast(err);
      }
    });
  };

  const send = (invoice) => run(async () => {
    try {
      const { sentTo } = await api.billing.sendInvoice(invoice.id);
      toast(`Lasku ${invoice.number} lähetetty: ${sentTo}`, { icon: 'check' });
      invoices.reload({ silent: true });
    } catch (err) {
      toast(err);
    }
  });

  return (
    <div className="bhall-view">
      <div className="bhall-view-head">
        <div>
          <h2 className="bhall-view-title">Laskutus</h2>
          <p className="bhall-view-sub">Kausivuorojen laskut ja kuukausiveloitukset</p>
        </div>
        <Button variant="dark" size="sm" icon="refresh" loading={busy} onClick={runCharges}>Veloita erääntyneet</Button>
      </div>

      {settings.data && !settings.data.ready && (
        <div className="hset-notice" role="status">
          <Icon name="alert" size={18} />
          <span><b>Laskutustiedot puuttuvat.</b> Uusia laskuja ei voi tehdä ennen kuin hallin nimi ja tilinumero on lisätty.</span>
          <Button variant="dark" size="sm" onClick={() => navigate(`/pelaa/halli/${venue.slug}?nakyma=asetukset`)}>Lisää</Button>
        </div>
      )}

      <div className="bhall-stats">
        <StatTile icon="mail" label="Avoimet laskut" value={invoices.data ? open.length : wait} sub={invoices.data ? centsLabel(sum(open)) : null} />
        <StatTile icon="alert" tone={overdue.length ? 'clay' : 'default'} label="Erääntyneet" value={invoices.data ? overdue.length : wait} sub={invoices.data ? centsLabel(sum(overdue)) : null} />
        <StatTile icon="clock" label="Veloitettavana" value={charges.data ? due.length : wait} sub={charges.data ? centsLabel(sum(due)) : null} />
        <StatTile icon="lock" tone={failed.length ? 'clay' : 'default'} label="Epäonnistuneet" value={charges.data ? failed.length : wait} sub={charges.data ? (failed.length ? centsLabel(sum(failed)) : 'ei yhtään') : null} />
      </div>

      <Segmented
        ariaLabel="Laskutus"
        options={[{ value: 'invoices', label: 'Laskut', badge: overdue.length || undefined }, { value: 'charges', label: 'Korttiveloitukset', badge: failed.length || undefined }]}
        value={view}
        onChange={setView}
        className="bhall-billing-tabs"
      />

      {view === 'invoices' ? (
        invoices.loading && !invoices.data ? <Skeleton h={200} r={16} /> : invoices.error && !invoices.data ? (
          <ErrorState error={invoices.error} onRetry={() => invoices.reload()} compact />
        ) : inv.length === 0 ? (
          <p className="ss-empty">Ei vielä laskuja. Lasku syntyy, kun laskulla maksettava kausivuoro vahvistetaan.</p>
        ) : (
          <div className="hb-table" role="table" aria-label="Laskut">
            <div className="hb-tr hb-th" role="row">
              <span role="columnheader">Nro</span><span role="columnheader">Vastaanottaja</span><span role="columnheader" className="is-num">Summa</span>
              <span role="columnheader">Eräpäivä</span><span role="columnheader">Tila</span>
            </div>
            {inv.map((i) => {
              const state = invoiceState(i);
              return (
                <div key={i.id} className={cx('hb-tr', `is-${state}`)} role="row">
                  <span role="cell" className="t-num hb-strong">{i.number}</span>
                  <span role="cell" className="hb-who"><b className="truncate">{i.recipient.name}</b><small className="truncate">{i.recipient.email || 'ei sähköpostia'}{i.sentAt ? ', lähetetty' : ''}</small></span>
                  <span role="cell" className="is-num t-num hb-strong">{centsLabel(i.amountCents)}</span>
                  <span role="cell" className="t-num">{dayMonth(i.dueOn, true)}</span>
                  <span role="cell"><InvoiceStateChip invoice={i} /></span>
                  <span role="cell" className="hb-actions">
                    <Button variant="soft" size="sm" icon="external" onClick={() => navigate(`/pelaa/lasku/${encodeURIComponent(i.id)}`)}>Avaa</Button>
                    {i.status === 'open' && i.recipient.email && !i.sentAt && <Button variant="soft" size="sm" icon="mail" disabled={busy} onClick={() => send(i)}>Lähetä</Button>}
                    {i.status === 'open' && <Button variant="outline" size="sm" icon="check" disabled={busy} onClick={() => markPaid(i)}>Maksettu</Button>}
                  </span>
                </div>
              );
            })}
          </div>
        )
      ) : charges.loading && !charges.data ? <Skeleton h={200} r={16} /> : charges.error && !charges.data ? (
        <ErrorState error={charges.error} onRetry={() => charges.reload()} compact />
      ) : ch.length === 0 ? (
        <p className="ss-empty">Ei korttiveloituksia. Ne syntyvät, kun kortilta maksettava kausivuoro vahvistetaan.</p>
      ) : (
        <div className="hb-table" role="table" aria-label="Korttiveloitukset">
          <div className="hb-tr hb-th is-charges" role="row">
            <span role="columnheader">Kuukausi</span><span role="columnheader">Haltija</span><span role="columnheader" className="is-num">Summa</span>
            <span role="columnheader">Eräpäivä</span><span role="columnheader">Tila</span>
          </div>
          {ch.map((c) => (
            <div key={c.id} className={cx('hb-tr is-charges', `is-${c.status}`)} role="row">
              <span role="cell" className="hb-strong">{monthLabel(c.month)}</span>
              <span role="cell" className="hb-who">
                <b className="truncate">{c.holderName}</b>
                {c.status === 'failed' && c.failureMessage && <small className="hb-error"><Icon name="alert" size={12} />{c.failureMessage} ({c.attempts}. yritys)</small>}
              </span>
              <span role="cell" className="is-num t-num hb-strong">{centsLabel(c.amountCents)}</span>
              <span role="cell" className="t-num">{dayMonth(c.dueOn, true)}</span>
              <span role="cell"><ChargeStateChip charge={c} /></span>
            </div>
          ))}
        </div>
      )}
      <p className="bk-fine">Kuukausiveloitukset ajetaan automaattisesti kerran päivässä. Epäonnistunutta kuukautta yritetään uudelleen seuraavana päivänä (enintään 4 kertaa), ja pelaaja saa sähköpostin ja voi maksaa sen sovelluksessa.</p>
    </div>
  );
}
