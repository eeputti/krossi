// HallSettings — Hallin näkymä → Hallin asetukset (?nakyma=asetukset, the gear in the top bar):
// what the hall runs Krossi with, edited in the app instead of SQL. On top, read-only, the price
// list and booking rules players book by (Hinnat ja säännöt, set up with Krossi). Seasons (dates, holidays,
// season discount, requests open), series card products (for sale or hidden), gift card amounts,
// and the invoicing details every new invoice carries. Each row opens its editor sheet
// (SeasonSettingsSheet, PassProductSheet, GiftSettingsSheet, BillingSettingsSheet). Changes apply
// to new requests, approvals, purchases and invoices; what was already agreed stays as it is.
import { useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { centsLabel, dateKey, durationLabel } from '../../features/booking.js';
import { dayMonth, formatIban } from '../../features/seasons.js';
import { plural } from '../../lib/format.js';
import { Button, Chip, Disclosure, ErrorState, Icon, Skeleton, useToast } from '../../ui/index.js';
import { BillingSettingsSheet } from './BillingSettingsSheet.jsx';
import { GiftSettingsSheet } from './GiftSettingsSheet.jsx';
import { PassProductSheet } from './PassProductSheet.jsx';
import { SeasonSettingsSheet } from './SeasonSettingsSheet.jsx';
import { numberToInput, validityLabel } from './hallSettingsForm.js';
import { hoursLabel, priceTable } from './priceTable.js';

const cx = (...c) => c.filter(Boolean).join(' ');

/** '3 kausivuoroa · 1 hakemus' */
function slotsText(season) {
  const parts = [season.activeSlots ? plural(season.activeSlots, 'kausivuoro', 'kausivuoroa') : 'ei kausivuoroja'];
  if (season.requests) parts.push(plural(season.requests, 'hakemus', 'hakemusta'));
  return parts.join(' · ');
}

/** '26 €/h' for a series card. */
const perHour = (p) => `${centsLabel(Math.round(p.priceCents / ((p.uses * p.minutesPerUse) / 60)))}/h`;

export function HallSettings({ venue, sports }) {
  const toast = useToast();
  const seasons = useAsync(() => api.seasons.staffSeasons(venue.id), [venue.id]);
  const products = useAsync(() => api.wallet.staffProducts(venue.id), [venue.id]);
  const billing = useAsync(() => api.billing.getSettings(venue.id), [venue.id]);
  // Sheets keep their last content while they animate out.
  const [sheet, setSheet] = useState({ kind: null, item: null });
  const [open, setOpen] = useState(false);
  const today = dateKey(new Date());

  const edit = (kind, item = null) => {
    setSheet({ kind, item });
    setOpen(true);
  };
  const done = (reload) => (message) => {
    setOpen(false);
    if (message) toast(message, { icon: 'check' });
    reload({ silent: true });
  };

  const all = seasons.data || [];
  const current = all.filter((s) => s.endsOn >= today);
  const past = all.filter((s) => s.endsOn < today).reverse();
  const settings = billing.data;
  const gift = products.data?.gift;
  const wait = <Skeleton h={64} r={16} />;

  return (
    <div className="bhall-view hset">
      <p className="hset-lead">Hinnat, kaudet, sarja- ja lahjakortit sekä laskutustiedot. Muutokset koskevat uusia hakemuksia, ostoja ja laskuja; jo sovitut pysyvät ennallaan.</p>

      {settings && !settings.ready && (
        <div className="hset-notice" role="status">
          <Icon name="alert" size={18} />
          <span><b>Laskutustiedot puuttuvat.</b> Laskulla maksettavia kausivuoroja ei voi hyväksyä ennen kuin hallin nimi ja tilinumero on lisätty.</span>
          <Button variant="dark" size="sm" onClick={() => edit('billing', settings)}>Lisää</Button>
        </div>
      )}

      <PricesAndRules venue={venue} />

      <section className="hset-section" aria-labelledby="hset-seasons">
        <div className="hset-head">
          <div>
            <h2 className="bhall-subhead" id="hset-seasons">Kaudet</h2>
            <p className="hset-help">Pelaajat hakevat kausivuoroa kaudelle. Pyhinä kausivuoroja ei pelata.</p>
          </div>
          <Button variant="soft" size="sm" icon="plus" onClick={() => edit('season')}>Uusi kausi</Button>
        </div>
        {seasons.loading && !seasons.data ? wait : seasons.error && !seasons.data ? (
          <ErrorState error={seasons.error} onRetry={() => seasons.reload()} compact />
        ) : current.length === 0 && past.length === 0 ? (
          <p className="ss-empty">Ei kausia. Lisää kausi, niin pelaajat voivat hakea kausivuoroja.</p>
        ) : (
          <>
            {current.length > 0 ? (
              <ul className="hset-list">
                {current.map((s) => <SeasonRow key={s.id} season={s} today={today} onOpen={() => edit('season', s)} />)}
              </ul>
            ) : <p className="ss-empty">Ei tulevia kausia.</p>}
            {past.length > 0 && (
              <Disclosure title="Päättyneet kaudet" summary={`${past.length}`} icon="archive">
                <ul className="hset-list">
                  {past.map((s) => <SeasonRow key={s.id} season={s} today={today} onOpen={() => edit('season', s)} />)}
                </ul>
              </Disclosure>
            )}
          </>
        )}
      </section>

      <section className="hset-section" aria-labelledby="hset-passes">
        <div className="hset-head">
          <div>
            <h2 className="bhall-subhead" id="hset-passes">Sarjakortit</h2>
            <p className="hset-help">Kortilla maksetaan kokonaisia vuoroja; pidemmästä vuorosta kuluu enemmän.</p>
          </div>
          <Button variant="soft" size="sm" icon="plus" onClick={() => edit('product')}>Uusi sarjakortti</Button>
        </div>
        {products.loading && !products.data ? wait : products.error && !products.data ? (
          <ErrorState error={products.error} onRetry={() => products.reload()} compact />
        ) : products.data.passes.length === 0 ? (
          <p className="ss-empty">Ei sarjakortteja myynnissä.</p>
        ) : (
          <ul className="hset-list">
            {products.data.passes.map((p) => (
              <li key={p.id}>
                <button type="button" className={cx('hset-row', !p.active && 'is-quiet')} onClick={() => edit('product', p)}>
                  <span className="hset-row-main">
                    <b className="truncate">{p.name}</b>
                    <small className="t-num">{centsLabel(p.priceCents)} · {perHour(p)} · voimassa {validityLabel(p.validDays)}</small>
                  </span>
                  <span className="hset-row-side">
                    <Chip size="sm" tone={p.active ? 'success' : 'neutral'}>{p.active ? 'Myynnissä' : 'Piilotettu'}</Chip>
                    <small className="t-num">{p.sold} myyty</small>
                  </span>
                  <Icon name="chevron-right" size={18} className="hset-row-chevron" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="hset-section" aria-labelledby="hset-gift">
        <div className="hset-head">
          <div>
            <h2 className="bhall-subhead" id="hset-gift">Lahjakortit</h2>
            <p className="hset-help">Ostaja valitsee valmiin summan tai oman summan rajojen sisältä.</p>
          </div>
        </div>
        {products.loading && !products.data ? wait : !gift ? (
          products.error ? <ErrorState error={products.error} onRetry={() => products.reload()} compact />
            : <p className="ss-empty">Lahjakorttien asetukset tulevat käyttöön, kun tietokannan päivitys on tehty.</p>
        ) : (
          <ul className="hset-list">
            <li>
              <button type="button" className="hset-row" onClick={() => edit('gift', gift)}>
                <span className="hset-row-main">
                  <b className="t-num">{gift.amounts.map(centsLabel).join(' · ')}</b>
                  <small className="t-num">Oma summa {gift.minCents / 100}–{gift.maxCents / 100} € · voimassa {validityLabel(gift.validDays)}</small>
                </span>
                <Icon name="chevron-right" size={18} className="hset-row-chevron" />
              </button>
            </li>
          </ul>
        )}
      </section>

      <section className="hset-section" aria-labelledby="hset-billing">
        <div className="hset-head">
          <div>
            <h2 className="bhall-subhead" id="hset-billing">Laskutustiedot</h2>
            <p className="hset-help">Näkyvät jokaisella uudella laskulla. Sähköposti on myös pelaajille lähtevien viestien vastausosoite.</p>
          </div>
        </div>
        {billing.loading && !billing.data ? wait : billing.error && !billing.data ? (
          <ErrorState error={billing.error} onRetry={() => billing.reload()} compact />
        ) : (
          <ul className="hset-list">
            <li>
              <button type="button" className={cx('hset-row', !settings.ready && 'is-warn')} onClick={() => edit('billing', settings)}>
                <span className="hset-row-main">
                  <b className="truncate">{settings.sellerName || 'Laskuttajan nimi puuttuu'}</b>
                  <small>{[settings.businessId && `Y-tunnus ${settings.businessId}`, settings.address].filter(Boolean).join(' · ') || 'Y-tunnus ja osoite puuttuvat'}</small>
                  <small className="t-num">{settings.iban ? `${formatIban(settings.iban)}${settings.bic ? ` · ${settings.bic}` : ''}` : 'Tilinumero puuttuu'}</small>
                  <small className="t-num">ALV {numberToInput(settings.vatPercent)} % · maksuaika {settings.paymentTermsDays} pv · seuraava lasku nro {settings.nextInvoiceNumber}</small>
                </span>
                <span className="hset-row-side">
                  {settings.ready ? <Chip size="sm" tone="success">Valmis</Chip> : <Chip size="sm" tone="warn">Kesken</Chip>}
                </span>
                <Icon name="chevron-right" size={18} className="hset-row-chevron" />
              </button>
            </li>
          </ul>
        )}
      </section>

      <SeasonSettingsSheet
        open={open && sheet.kind === 'season'}
        onClose={() => setOpen(false)}
        venue={venue}
        season={sheet.kind === 'season' ? sheet.item : null}
        onDone={done(seasons.reload)}
      />
      <PassProductSheet
        open={open && sheet.kind === 'product'}
        onClose={() => setOpen(false)}
        venue={venue}
        sports={sports}
        product={sheet.kind === 'product' ? sheet.item : null}
        onDone={done(products.reload)}
      />
      <GiftSettingsSheet
        open={open && sheet.kind === 'gift'}
        onClose={() => setOpen(false)}
        venue={venue}
        gift={sheet.kind === 'gift' ? sheet.item : null}
        onDone={done(products.reload)}
      />
      <BillingSettingsSheet
        open={open && sheet.kind === 'billing'}
        onClose={() => setOpen(false)}
        venue={venue}
        settings={sheet.kind === 'billing' ? sheet.item : null}
        onDone={done(billing.reload)}
      />
    </div>
  );
}

function SeasonRow({ season: s, today, onOpen }) {
  const over = s.endsOn < today;
  return (
    <li>
      <button type="button" className={cx('hset-row', over && 'is-quiet')} onClick={onOpen}>
        <span className="hset-row-main">
          <b className="truncate">{s.name}</b>
          <small className="t-num">
            {dayMonth(s.startsOn, true)}–{dayMonth(s.endsOn, true)} · alennus {s.discountPercent} % · {plural(s.skipDates.length, 'pyhä', 'pyhää')}
          </small>
        </span>
        <span className="hset-row-side">
          {over ? <Chip size="sm">Päättynyt</Chip> : (
            <Chip size="sm" tone={s.requestsOpen ? 'success' : 'neutral'}>{s.requestsOpen ? 'Haku auki' : 'Haku kiinni'}</Chip>
          )}
          <small>{slotsText(s)}</small>
        </span>
        <Icon name="chevron-right" size={18} className="hset-row-chevron" />
      </button>
    </li>
  );
}

/** Hinnat ja säännöt: the price list by courts and days, and the booking rules, as players see them. */
function PricesAndRules({ venue }) {
  const table = priceTable(venue);
  const deal = venue.lastMinute;
  const rules = [
    ['Aukiolo', `klo ${hoursLabel(venue.openFrom, venue.openUntil)}`],
    ['Vuoron kesto', venue.durations.map(durationLabel).join(' · ')],
    ['Varattavissa', `${venue.daysAhead} päivää eteenpäin`],
    ['Maksuton peruutus', `${venue.cancelLimitHours} h ennen alkua, raha takaisin kortille`],
    ['Maksun pitoaika', `${venue.holdMinutes} min`],
    ['Viime hetken ale', deal ? `−${deal.percent} %, kun alkuun on alle ${deal.hours} h` : 'Ei käytössä'],
  ];
  return (
    <section className="hset-section" aria-labelledby="hset-prices">
      <div className="hset-head">
        <div>
          <h2 className="bhall-subhead" id="hset-prices">Hinnat ja säännöt</h2>
          <p className="hset-help">Näillä pelaajat varaavat. Tuntihinta vaihtelee ajan mukaan, ja 1,5 tunnin vuoro hinnoitellaan puolen tunnin paloissa. Krossi asettaa hinnat käyttöönotossa hallin hinnaston mukaan.</p>
        </div>
      </div>
      {table.length > 0 && (
        <ul className="hset-list hset-prices">
          {table.map((g) => (
            <li key={g.label} className="hset-price-group">
              <div className="hset-price-head">
                <b>{g.label}</b>
                {g.places.length > 1 && <small>{g.places.join(' · ')}</small>}
              </div>
              {g.rows.map((r) => (
                <div key={r.days} className="hset-price-row">
                  <span className="hset-price-days">{r.days}</span>
                  <span className="hset-price-slots">
                    {r.slots.map((slot) => (
                      <span key={slot.hours} className="hset-price-slot">
                        <span className="t-num">{slot.hours}</span>
                        <b className="t-num">{slot.price}</b>
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
      <dl className="hset-rules">
        {rules.map(([term, value]) => (
          <div key={term}><dt>{term}</dt><dd>{value}</dd></div>
        ))}
      </dl>
    </section>
  );
}
