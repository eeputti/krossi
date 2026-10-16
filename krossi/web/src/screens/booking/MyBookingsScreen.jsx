// MyBookingsScreen — /pelaa/omat-varaukset: everything a player has at the hall in one place.
// Coming bookings (with how each was paid), kausivuorot (request status, the invoice or the
// month-by-month card charges with "Maksa nyt" for a failed month), series cards with their
// balance and history, the gift balance and gift cards bought, the card kept on file for the
// monthly charges, and past bookings. Factual, no decoration: these are receipts.
//
// Redirect payment methods come back here: ?tilaus=<pass|gift>:<id>&payment_intent=… (a series or
// gift card) and ?kuukausi=<chargeId>&payment_intent=… (a month of a kausivuoro).
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync, useNow, useResync } from '../../app/hooks.js';
import { navigate } from '../../app/router.js';
import { centsLabel } from '../../features/booking.js';
import { dayMonth, slotWhen } from '../../features/seasons.js';
import { formatGameTime } from '../../lib/format.js';
import {
  Button, Disclosure, EmptyState, ErrorState, Icon, Page, Skeleton, TopBar, useConfirm, useToast,
} from '../../ui/index.js';
import { MyBookingSheet } from './MyBookingSheet.jsx';
import { restOwed } from './BookingParts.jsx';
import { ChargePaySheet } from './ChargePaySheet.jsx';
import { SaveCard } from './SaveCard.jsx';
import { SeasonRequestSheet } from './SeasonRequestSheet.jsx';
import { WalletSheet, GiftCardRow } from './WalletSheet.jsx';
import {
  ChargeList, CreditHistory, InfoLine, InvoiceStateChip, PassBalance, SlotStatusChip, cardLabel,
} from './SeasonParts.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** How a booking was paid (or what is still open), for its row. */
export function paidWith(b) {
  if (b.status === 'held') return 'Maksamatta';
  if (b.forSale) return 'Myynnissä';
  if (restOwed(b)) return 'Loppuosuus maksamatta';
  if (b.split?.lines.some((l) => l.kind === 'friend' && (l.status === 'pending' || l.status === 'declined'))) return 'Osuuksia maksamatta';
  if (b.paymentStatus === 'refunded') return 'Hyvitetty';
  if (b.paymentStatus === 'free') return 'Maksuton';
  if (b.credit?.kind === 'pass') return `Sarjakortti · ${b.credit.minutes} min`;
  if (b.credit?.kind === 'gift') return b.paymentStatus === 'credit' ? 'Lahjakortti' : `Kortti + lahjakortti ${centsLabel(b.credit.cents)}`;
  return 'Maksettu';
}

export function MyBookingsScreen({ query }) {
  const toast = useToast();
  const confirm = useConfirm();
  const now = useNow(60_000);
  const venues = useAsync(() => api.booking.listVenues(), []);
  const venue = venues.data?.[0] || null;
  const mine = useAsync(() => (venue ? api.booking.listMine() : Promise.resolve(null)), [venue?.id]);
  const slots = useAsync(() => (venue ? api.seasons.listMine() : Promise.resolve([])), [venue?.id]);
  const seasons = useAsync(() => (venue ? api.seasons.list(venue.id) : Promise.resolve([])), [venue?.id]);
  const wallet = useAsync(() => (venue ? api.wallet.get(venue.id) : Promise.resolve(null)), [venue?.id]);
  const card = useAsync(() => (venue ? api.billing.cardStatus() : Promise.resolve(null)), [venue?.id]);
  const reloadAll = () => {
    mine.reload({ silent: true }); slots.reload({ silent: true }); wallet.reload({ silent: true }); card.reload({ silent: true });
  };
  useResync(reloadAll);

  const [openBooking, setOpenBooking] = useState(null);
  const [payCharge, setPayCharge] = useState(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [walletTab, setWalletTab] = useState(null);
  const [cardOpen, setCardOpen] = useState(false);

  // ── Coming back from a redirect payment ──
  const handled = useRef(false);
  useEffect(() => {
    const { tilaus, kuukausi, payment_intent: intentId, redirect_status: redirectStatus } = query || {};
    if ((!tilaus && !kuukausi) || handled.current || !venue) return;
    handled.current = true;
    (async () => {
      if (redirectStatus === 'failed' || !intentId) {
        toast('Maksu ei mennyt läpi — mitään ei veloitettu.', { tone: 'error' });
      } else {
        try {
          for (let tries = 0; tries < 8; tries += 1) {
            let result;
            if (tilaus) {
              const [kind, id] = String(tilaus).split(':');
              result = await api.wallet.verifyPayment({ kind, id }, intentId);
            } else {
              result = await api.billing.verifyCharge(kuukausi, intentId);
            }
            if (result.paid) { toast('Maksu vastaanotettu. Kuitti tulee sähköpostiisi.', { icon: 'check' }); break; }
            if (result.status !== 'processing') { toast('Maksu ei mennyt läpi — mitään ei veloitettu.', { tone: 'error' }); break; }
            await sleep(1500);
          }
        } catch (err) {
          toast(err);
        }
      }
      reloadAll();
      navigate('/pelaa/omat-varaukset', { replace: true }); // the query carries Stripe's client secret
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query?.tilaus, query?.kuukausi, venue?.id]);

  const upcoming = mine.data?.upcoming || [];
  const past = mine.data?.past || [];
  const passes = wallet.data?.passes || [];
  const requestOpenSeason = (seasons.data || []).some((s) => s.requestsOpen);
  const cardSlots = useMemo(() => (slots.data || []).filter((s) => s.billing === 'card' && s.status === 'active'), [slots.data]);

  if (venues.loading && !venues.data) {
    return (
      <>
        <TopBar title="Omat varaukset" back="/pelaa/varaa" />
        <Page className="bk-page"><Skeleton h={90} r={18} /><Skeleton h={160} r={18} /><Skeleton h={120} r={18} /></Page>
      </>
    );
  }
  if (venues.error && !venues.data) {
    return (
      <>
        <TopBar title="Omat varaukset" back="/pelaa/varaa" />
        <Page><ErrorState error={venues.error} onRetry={() => venues.reload()} /></Page>
      </>
    );
  }
  if (!venue) {
    return (
      <>
        <TopBar title="Omat varaukset" back="/pelaa/pelit" />
        <Page><EmptyState art="court" title="Kenttävaraus on tulossa" text="Kun halli aukeaa Krossissa, varauksesi, kausivuorosi ja korttisi näkyvät tässä." /></Page>
      </>
    );
  }

  const withdraw = async (slot) => {
    const ok = await confirm({ title: 'Perutaanko hakemus?', message: `${slotWhen(slot)} · ${slot.seasonName}`, confirmLabel: 'Peru hakemus', danger: true });
    if (!ok) return;
    try {
      await api.seasons.withdraw(slot.id);
      toast('Hakemus peruttu.');
      slots.reload({ silent: true });
    } catch (err) {
      toast(err);
    }
  };

  const removeCard = async () => {
    const ok = await confirm({ title: 'Poistetaanko kortti?', message: cardLabel(card.data), confirmLabel: 'Poista kortti', danger: true });
    if (!ok) return;
    try {
      await api.billing.removeCard();
      toast('Kortti poistettu.');
      card.reload({ silent: true });
    } catch (err) {
      toast(err);
    }
  };

  return (
    <>
      <TopBar title="Omat varaukset" back={`/pelaa/varaa/${encodeURIComponent(venue.slug)}`} />
      <Page className="bk-page ss-page">
        <section className="bk-section" aria-labelledby="ss-upcoming">
          <div className="ss-section-head">
            <h2 className="bk-h" id="ss-upcoming">Tulevat vuorot</h2>
            <Button variant="soft" size="sm" icon="calendar" onClick={() => navigate(`/pelaa/varaa/${encodeURIComponent(venue.slug)}`)}>Varaa</Button>
          </div>
          {mine.loading && !mine.data ? <Skeleton h={64} r={14} /> : upcoming.length === 0 ? (
            <p className="ss-empty">Ei tulevia vuoroja.</p>
          ) : (
            <ul className="ss-rows">
              {upcoming.map((b) => (
                <li key={b.id}>
                  <button type="button" className="ss-row" onClick={() => setOpenBooking(b)}>
                    <span className="ss-row-main">
                      <b>{formatGameTime(b.startsAt, new Date(now))}</b>
                      <small>{b.courtName} · {b.locationName}</small>
                    </span>
                    <span className={cx('ss-row-side', (b.status === 'held' || restOwed(b)) && 'is-warn')}>{paidWith(b)}</span>
                    <Icon name="chevron-right" size={18} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bk-section" aria-labelledby="ss-seasons">
          <div className="ss-section-head">
            <h2 className="bk-h" id="ss-seasons">Kausivuorot</h2>
            {requestOpenSeason && <Button variant="soft" size="sm" icon="repeat" onClick={() => setRequestOpen(true)}>Hae</Button>}
          </div>
          {slots.loading && !slots.data ? <Skeleton h={120} r={18} /> : slots.error && !slots.data ? (
            <ErrorState compact error={slots.error} onRetry={() => slots.reload()} />
          ) : (slots.data || []).length === 0 ? (
            <p className="ss-empty">Ei kausivuoroja. Kausivuoro on sama kenttä ja aika joka viikko koko kauden.</p>
          ) : (
            <div className="stack-3">
              {slots.data.map((slot) => <SlotCard key={slot.id} slot={slot} now={now} onPay={(c) => setPayCharge({ charge: c, slot })} onWithdraw={withdraw} />)}
            </div>
          )}
        </section>

        {(cardSlots.length > 0 || card.data) && (
          <section className="bk-section" aria-labelledby="ss-card">
            <h2 className="bk-h" id="ss-card">Kortti kuukausimaksuille</h2>
            <div className="ss-box">
              {card.data ? (
                <div className="ss-card-line">
                  <Icon name="lock" size={16} />
                  <span>{cardLabel(card.data)}</span>
                  <button type="button" className="bhall-link" onClick={() => setCardOpen((o) => !o)}>{cardOpen ? 'Sulje' : 'Vaihda'}</button>
                  {cardSlots.length === 0 && <button type="button" className="bhall-link is-danger" onClick={removeCard}>Poista</button>}
                </div>
              ) : (
                <InfoLine icon="alert" tone="danger">Kortti puuttuu: kausivuorosi kuukausimaksuja ei voida veloittaa. Tallenna kortti.</InfoLine>
              )}
              {(cardOpen || !card.data) && (
                <SaveCard
                  label="Tallenna uusi kortti"
                  onSaved={() => { setCardOpen(false); card.reload({ silent: true }); toast('Kortti tallennettu. Seuraavat kuukaudet veloitetaan siltä.', { icon: 'check' }); }}
                />
              )}
            </div>
          </section>
        )}

        <section className="bk-section" aria-labelledby="ss-passes">
          <div className="ss-section-head">
            <h2 className="bk-h" id="ss-passes">Sarjakortit</h2>
            <Button variant="soft" size="sm" icon="plus" onClick={() => setWalletTab('passes')}>Osta</Button>
          </div>
          {wallet.loading && !wallet.data ? <Skeleton h={90} r={18} /> : passes.length === 0 ? (
            <p className="ss-empty">Ei sarjakortteja. Sarjakortilla maksat vuorot ennakkoon tunteina.</p>
          ) : (
            <div className="stack-3">
              {passes.map((p) => (
                <div key={p.id} className="ss-box">
                  <PassBalance pass={p} />
                  <Disclosure title="Historia" summary={`${p.history.length} tapahtumaa`} icon="list">
                    <CreditHistory events={p.history} unit="minutes" />
                  </Disclosure>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bk-section" aria-labelledby="ss-gift">
          <div className="ss-section-head">
            <h2 className="bk-h" id="ss-gift">Lahjakortit</h2>
            <div className="ss-head-actions">
              <Button variant="soft" size="sm" onClick={() => setWalletTab('redeem')}>Lunasta</Button>
              <Button variant="soft" size="sm" icon="gift" onClick={() => setWalletTab('gift')}>Osta</Button>
            </div>
          </div>
          <div className="ss-box">
            <div className="ss-balance is-row">
              <span className="eyebrow ss-eyebrow">Lahjakorttisaldo</span>
              <span className="ss-balance-value t-num">{wallet.data ? centsLabel(wallet.data.giftCents) : '–'}</span>
            </div>
            {wallet.data?.giftHistory?.length > 0 && (
              <Disclosure title="Saldon tapahtumat" summary={`${wallet.data.giftHistory.length}`} icon="list">
                <CreditHistory events={wallet.data.giftHistory} unit="cents" />
              </Disclosure>
            )}
          </div>
          {wallet.data?.giftCards?.length > 0 && (
            <div className="stack-2 ss-gifts">
              <span className="eyebrow ss-eyebrow">Ostamasi lahjakortit</span>
              {wallet.data.giftCards.map((g) => <GiftCardRow key={g.id} card={g} venue={venue} />)}
            </div>
          )}
        </section>

        {past.length > 0 && (
          <section className="bk-section" aria-labelledby="ss-past">
            <h2 className="bk-h" id="ss-past">Menneet ja perutut</h2>
            <ul className="ss-rows is-quiet">
              {past.slice(0, 12).map((b) => (
                <li key={b.id} className="ss-row is-static">
                  <span className="ss-row-main">
                    <b>{formatGameTime(b.startsAt, new Date(now))}</b>
                    <small>{b.courtName} · {b.locationName}</small>
                  </span>
                  <span className="ss-row-side">{b.status === 'cancelled' ? (b.paymentStatus === 'refunded' ? 'Peruttu · hyvitetty' : 'Peruttu') : b.status === 'expired' ? 'Vanhentunut' : `${centsLabel(b.priceCents)} · ${paidWith(b)}`}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Page>

      <MyBookingSheet open={Boolean(openBooking)} booking={openBooking} venue={venue} onClose={() => setOpenBooking(null)} onChanged={reloadAll} />
      <ChargePaySheet
        open={Boolean(payCharge)}
        charge={payCharge?.charge}
        slotLabel={payCharge ? `${slotWhen(payCharge.slot)} · ${payCharge.slot.courtName || ''}` : ''}
        onClose={() => setPayCharge(null)}
        onPaid={() => { setPayCharge(null); toast('Kuukausi maksettu.', { icon: 'check' }); slots.reload({ silent: true }); }}
      />
      <SeasonRequestSheet
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        venue={venue}
        seasons={seasons.data || []}
        card={card.data}
        onCardSaved={() => card.reload({ silent: true })}
        onRequested={() => slots.reload({ silent: true })}
      />
      <WalletSheet open={Boolean(walletTab)} initialTab={walletTab || 'passes'} venue={venue} onClose={() => setWalletTab(null)} onChanged={() => wallet.reload({ silent: true })} />
    </>
  );
}

/** ' · ei 24.12., 31.12.' — the weeks without play (holidays, weeks that were taken). */
function skippedText(dates) {
  if (!dates.length) return '';
  return dates.length <= 3 ? ` · ei ${dates.map((d) => dayMonth(d)).join(', ')}` : ` · ${dates.length} viikkoa ohitetaan`;
}

/** One kausivuoro of mine: when and where, status, next week, and how it is paid. */
function SlotCard({ slot, now, onPay, onWithdraw }) {
  const failed = slot.charges.filter((c) => c.status === 'failed');
  return (
    <article className={cx('ss-slot', `is-${slot.status}`)}>
      <div className="ss-slot-head">
        <SlotStatusChip status={slot.status} />
        <span className="ss-slot-season">{slot.seasonName}</span>
      </div>
      <h3 className="ss-slot-when">{slotWhen(slot)}</h3>
      <p className="ss-slot-place">{slot.courtName || 'Vapaa kenttä'}{slot.locationName ? ` · ${slot.locationName}` : ''}</p>
      <dl className="bk-facts ss-slot-facts">
        {slot.status === 'active' && slot.nextAt && (
          <div><dt>Seuraava</dt><dd>{formatGameTime(slot.nextAt, new Date(now))}</dd></div>
        )}
        <div>
          <dt>Kerrat</dt>
          <dd>{slot.weeks} krt<small>{dayMonth(slot.startsOn, true)}–{dayMonth(slot.endsOn, true)}{skippedText(slot.skipDates)}</small></dd>
        </div>
        <div>
          <dt>{slot.status === 'requested' ? 'Arvio' : 'Kausihinta'}</dt>
          <dd>{centsLabel(slot.priceCents)}<small>{slot.billing === 'card' ? 'Kortilta kuukausittain' : 'Lasku'}</small></dd>
        </div>
        {slot.invoice && (
          <div>
            <dt>Lasku</dt>
            <dd className="ss-invoice-line">
              <span>Nro {slot.invoice.number} · eräpäivä {dayMonth(slot.invoice.dueOn, true)}</span>
              <InvoiceStateChip invoice={slot.invoice} />
            </dd>
          </div>
        )}
      </dl>
      {slot.status === 'declined' && slot.declineReason && <InfoLine icon="info">Halli: {slot.declineReason}</InfoLine>}
      {slot.status === 'requested' && <InfoLine icon="clock">Odottaa hallin vahvistusta.{slot.billing === 'card' ? ' Mitään ei veloiteta ennen sitä.' : ''}</InfoLine>}
      {failed.length > 0 && <InfoLine icon="alert" tone="danger">{failed.length === 1 ? 'Yhden kuukauden' : `${failed.length} kuukauden`} veloitus epäonnistui. Maksa se alta tai tallenna uusi kortti.</InfoLine>}
      {slot.billing === 'card' && slot.charges.length > 0 && (
        <Disclosure title="Kuukausimaksut" summary={`${slot.charges.filter((c) => c.status === 'paid').length}/${slot.charges.filter((c) => c.status !== 'void').length} maksettu`} icon="euro" defaultOpen={failed.length > 0}>
          <ChargeList charges={slot.charges} onPay={onPay} />
        </Disclosure>
      )}
      <div className="ss-slot-actions">
        {slot.invoice && <Button variant="outline" size="sm" icon="external" onClick={() => navigate(`/pelaa/lasku/${encodeURIComponent(slot.invoice.id)}`)}>Näytä lasku</Button>}
        {slot.status === 'requested' && <Button variant="ghost" size="sm" onClick={() => onWithdraw(slot)}>Peru hakemus</Button>}
      </div>
    </article>
  );
}
