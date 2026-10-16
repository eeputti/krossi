// ShareScreen — /pelaa/osuus/:id: my share of a court somebody booked ("Maksa osuutesi"), or the
// rest of my own split booking the saved card didn't cover. The chat message, the email and the
// bell all open this.
//
// Shows who booked, where and when (the court on the floor map), everybody's part and who has
// paid — real Krossi players, not "Osallistuja 2" — then the same in-app checkout as booking a
// court. "En pääse" tells the booker in our chat; the share stays payable until the deadline
// (after it the booker's card covers it, and this page says so). The booker opening a friend's
// share sees the same page without the checkout.
//
// Works without the 8,99 € unlock: booking (and paying for it) is free for everybody. Redirect
// payment methods come back here with ?payment_intent=…, confirmed below.
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, isDemo } from '../../api/index.js';
import { useAsync, useResync } from '../../app/hooks.js';
import { Checkout } from '../../app/checkout.jsx';
import { navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { firstName } from '../../lib/format.js';
import { centsLabel, chargeErrorText } from '../../features/booking.js';
import { Avatar, Button, EmptyState, ErrorState, Icon, Page, Skeleton, TopBar, useConfirm, useToast } from '../../ui/index.js';
import { VenueMap, hasVenueMap } from './VenueMap.jsx';
import { SplitLines, downloadBookingIcs, sportLabel, timeInSentence, whenLabel } from './BookingParts.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function PayBox({ share, onPaid }) {
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);

  const load = async () => {
    setError(null);
    setConfig(null);
    try {
      const cfg = await api.booking.shareCheckoutConfig(share.id);
      if (cfg.paid) onPaid();
      else setConfig(cfg);
    } catch (err) {
      setError(err);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [share.id]);

  const payDemo = async () => {
    setWorking(true);
    try {
      await api.booking.createSharePaymentIntent(share.id);
      onPaid();
    } catch (err) {
      toast(err);
    } finally {
      setWorking(false);
    }
  };

  const verify = async (paymentIntentId) => {
    const result = await api.booking.verifySharePayment(share.id, paymentIntentId);
    if (result.status === 'refunded') throw new ApiError(result.message || 'Maksu palautettiin.', { code: 'refunded' });
    return { paid: result.paid, status: result.status };
  };

  return (
    <div className="bk-paybox">
      <span className="eyebrow bk-paybox-title">Maksu</span>
      {error ? (
        <div className="stack-3">
          <p className="checkout-error" role="alert"><Icon name="alert" size={16} />{error.userMessage || 'Maksua ei saatu auki.'}</p>
          <Button variant="lime" icon="refresh" block onClick={load}>Yritä uudelleen</Button>
        </div>
      ) : !config ? (
        <div className="stack-3" aria-label="Ladataan maksua"><Skeleton h={50} r={14} /><Skeleton h={54} r={14} /></div>
      ) : config.demo ? (
        <div className="stack-3">
          <p className="bk-paybox-demo">
            <Icon name="info" size={15} />
            <span><b>Demotila</b> — maksu hyväksytään heti. Oikeassa Krossissa maksat Apple Paylla, Google Paylla, MobilePaylla tai kortilla.</span>
          </p>
          <Button variant="lime" size="lg" block icon="lock" loading={working} onClick={payDemo}>Maksa {centsLabel(share.cents)}</Button>
        </div>
      ) : (
        <Checkout
          config={config}
          createIntent={() => api.booking.createSharePaymentIntent(share.id)}
          verify={verify}
          returnPath={`/pelaa/osuus/${encodeURIComponent(share.id)}`}
          pendingText="Maksu on vielä kesken. Osuus merkitään maksetuksi heti, kun pankki vahvistaa maksun."
          onPaid={onPaid}
        />
      )}
    </div>
  );
}

export function ShareScreen({ params, query }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useSession();
  const share = useAsync(() => api.booking.getShare(params.id), [params.id]);
  const venue = useAsync(() => (share.data ? api.booking.getVenue(share.data.booking.venueId) : Promise.resolve(null)), [share.data?.booking.venueId]);
  const [declining, setDeclining] = useState(false);
  useResync(() => share.reload({ silent: true }));

  // Coming back from a redirect payment (MobilePay on a phone): confirm it, then drop the query.
  const handledReturn = useRef(false);
  useEffect(() => {
    const intentId = query?.payment_intent;
    if (!intentId || handledReturn.current || !share.data) return;
    handledReturn.current = true;
    (async () => {
      if (query.redirect_status === 'failed') {
        toast('Maksu ei mennyt läpi — mitään ei veloitettu.', { tone: 'error', duration: 6000 });
      } else {
        try {
          for (let tries = 0; tries < 8; tries += 1) {
            const result = await api.booking.verifySharePayment(params.id, intentId);
            if (result.paid) { toast('Osuutesi on maksettu. Kuitti tulee sähköpostiisi.', { icon: 'check', duration: 4200 }); break; }
            if (result.status === 'refunded') { toast(result.message || 'Maksu palautettiin.', { tone: 'error', duration: 7000 }); break; }
            if (result.status !== 'processing') { toast('Maksu ei mennyt läpi — mitään ei veloitettu.', { tone: 'error' }); break; }
            await sleep(1500);
          }
        } catch (err) {
          toast(err);
        }
      }
      share.reload({ silent: true });
      // Drop the query: it carries Stripe's client secret.
      navigate(`/pelaa/osuus/${encodeURIComponent(params.id)}`, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query?.payment_intent, share.data?.id]);

  const top = <TopBar title="Osuus kenttävuorosta" back="/pelaa/varaa" />;
  if (share.loading && !share.data) {
    return (
      <>
        {top}
        <Page className="bk-page">
          <Skeleton h={120} r={18} />
          <Skeleton h={180} r={18} />
          <Skeleton h={220} r={18} />
        </Page>
      </>
    );
  }
  if (share.error && !share.data) {
    return <>{top}<Page><ErrorState error={share.error} onRetry={() => share.reload()} /></Page></>;
  }
  const s = share.data;
  if (!s) {
    return (
      <>
        {top}
        <Page>
          <EmptyState
            art="court"
            title="Osuutta ei löytynyt"
            text="Linkki voi olla vanha, tai osuus kuuluu toiselle pelaajalle."
            action={<Button variant="dark" onClick={() => navigate('/pelaa/varaa')}>Kenttävaraukseen</Button>}
          />
        </Page>
      </>
    );
  }

  const b = s.booking;
  const mine = s.booker.id !== user?.id || s.kind === 'rest';
  const booker = firstName(s.booker.name);
  const location = venue.data?.locations.find((l) => l.courts.some((c) => c.id === b.courtId)) || null;
  const deadlinePassed = Date.parse(s.deadline) <= Date.now();
  const refresh = () => share.reload({ silent: true });

  const decline = async () => {
    const ok = await confirm({
      title: 'Etkö pääse mukaan?',
      message: `Kerromme varaajalle viestillä. Jos et maksa osuuttasi ${timeInSentence(s.deadline)} mennessä, varaaja maksaa sen.`,
      confirmLabel: 'En pääse',
      cancelLabel: 'Takaisin',
    });
    if (!ok) return;
    setDeclining(true);
    try {
      await api.booking.declineShare(s.id);
      toast('Kerroimme varaajalle, ettet pääse.', { icon: 'check' });
      refresh();
    } catch (err) {
      toast(err);
    } finally {
      setDeclining(false);
    }
  };

  let state;
  if (!mine) {
    state = (
      <p className="bk-fine">
        Osuus kuuluu pelikaverillesi ({firstName(b.split?.lines.find((l) => l.id === s.id)?.person.name)}). {s.status === 'paid' ? 'Se on maksettu.' : `Jos se on maksamatta ${timeInSentence(s.deadline)}, se veloitetaan kortiltasi.`}
      </p>
    );
  } else if (s.status === 'paid') {
    state = (
      <div className="bk-share-done">
        <span className="bk-done-check" aria-hidden="true"><Icon name="check" size={30} strokeWidth={3} /></span>
        <h2 className="bk-share-title">{s.kind === 'rest' ? 'Loppuosuus on maksettu' : 'Osuutesi on maksettu'}</h2>
        <p className="bk-fine">{centsLabel(s.cents)}{s.paidAt ? `, maksettu ${timeInSentence(s.paidAt)}` : ''}. {isDemo ? 'Demotila — mitään ei veloitettu.' : 'Kuitti tulee sähköpostiisi.'}</p>
        {b.status === 'confirmed' && Date.parse(b.endsAt) > Date.now() && (
          <Button variant="dark" icon="calendar" onClick={() => downloadBookingIcs(b)}>Lisää kalenteriin</Button>
        )}
      </div>
    );
  } else if (s.status === 'covered') {
    state = (
      <div className="bk-info">
        <Icon name="info" size={18} />
        <span>Maksuaika päättyi {timeInSentence(s.deadline)}, joten osuutesi ({centsLabel(s.cents)}) siirtyi varaajalle: {booker} maksaa sen. Sopikaa keskenänne, miten tasaatte sen.</span>
      </div>
    );
  } else if (s.status === 'cancelled' || s.status === 'refunded' || b.status !== 'confirmed') {
    state = (
      <div className="bk-info">
        <Icon name="info" size={18} />
        <span>{b.soldAt ? 'Varaaja myi vuoron eteenpäin.' : 'Vuoro peruttiin.'} {s.status === 'refunded' ? `Osuutesi (${centsLabel(s.cents)}) palautettiin maksutavallesi.` : 'Mitään ei veloitettu.'}</span>
      </div>
    );
  } else if (!s.payable) {
    state = (
      <div className="bk-info">
        <Icon name="clock" size={18} />
        <span>Maksuaika päättyi {timeInSentence(s.deadline)}. Maksamatta jääneet osuudet veloitetaan varaajalta.</span>
      </div>
    );
  } else {
    state = (
      <div className="stack-3">
        <div className="bk-share-amount">
          <span className="bk-share-amount-label">{s.kind === 'rest' ? 'Loppuosuus' : 'Osuutesi'}</span>
          <span className="bk-share-amount-value t-num">{centsLabel(s.cents)}</span>
        </div>
        {s.kind === 'rest' ? (
          <div className="bk-alert" role="alert">
            <Icon name="alert" size={18} />
            <span>
              <b>Kortiltasi ei voitu veloittaa maksamatta jääneitä osuuksia.</b> {chargeErrorText(s.chargeError)}. Maksa ne nyt millä tahansa
              maksutavalla, niin vuoro on kokonaan maksettu.
            </span>
          </div>
        ) : (
          <p className="bk-fine">
            {s.status === 'declined' ? 'Ilmoitit, ettet pääse. Jos pääsetkin, maksa osuutesi tästä. ' : ''}
            Maksa viimeistään {timeInSentence(s.deadline)}. Sen jälkeen {booker} maksaa maksamatta jääneet osuudet.
          </p>
        )}
        <PayBox share={s} onPaid={() => { toast(s.kind === 'rest' ? 'Loppuosuus maksettu.' : 'Osuutesi on maksettu.', { icon: 'check' }); refresh(); }} />
        {s.kind === 'friend' && s.status === 'pending' && !deadlinePassed && (
          <Button variant="ghost" block loading={declining} onClick={decline}>En pääse mukaan</Button>
        )}
      </div>
    );
  }

  return (
    <>
      {top}
      <Page className="bk-page">
        <header className="bk-share-head">
          <Avatar person={s.booker} size={48} />
          <span className="bk-share-head-text">
            <span className="eyebrow">{s.kind === 'rest' ? 'Jaettu maksu · loppuosuus' : 'Jaettu maksu'}</span>
            <span className="bk-share-head-title">{s.kind === 'rest' || !mine ? 'Vuorosi' : `${booker} varasi kentän`}</span>
            <span className="bk-share-head-sub">{whenLabel(b.startsAt, b.endsAt)} · {b.courtName}, {b.locationName}</span>
          </span>
        </header>

        {state}

        {b.split && (
          <section className="bk-field" aria-label="Maksut">
            <span className="eyebrow">Maksut</span>
            <SplitLines split={b.split} meId={user?.id} />
          </section>
        )}

        <dl className="bk-facts">
          <div><dt>Paikka</dt><dd>{b.locationName}{location?.address ? <small>{location.address}</small> : null}</dd></div>
          <div><dt>Kenttä</dt><dd>{b.courtName}<small>{sportLabel(b.sport)} · {b.venueName}</small></dd></div>
          <div><dt>Vuoro</dt><dd>{centsLabel(b.priceCents)}<small>{b.split?.parts === 4 ? 'Nelinpeli' : 'Kaksinpeli'}, jaettu {b.split?.parts || 2} pelaajalle</small></dd></div>
        </dl>

        {location && hasVenueMap(location.mapKey) && (
          <VenueMap compact mapKey={location.mapKey} courts={location.courts} states={{ [b.courtId]: 'mine' }} className="bk-sheet-map" />
        )}
      </Page>
    </>
  );
}
