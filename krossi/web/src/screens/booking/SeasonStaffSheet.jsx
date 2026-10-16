// SeasonStaffSheet — Hallin näkymä → Kausivuorot: one kausivuoro for the hall staff.
//
//   mode 'approve'  a player's request: pick the court (each with its taken weeks over the season),
//                   skip the taken weeks, an agreed price for an invoiced slot, then Hyväksy / Hylkää
//   mode 'create'   the hall adds a slot itself (a club, a company, a deal made at the counter):
//                   holder, billing address, time and court — invoiced, active at once
//   mode 'view'     an active / ended / declined slot: weeks, billing (invoice or the card months),
//                   whether the player was e-mailed the decision, "Päätä kausivuoro" frees the coming weeks
//
// The season quote (api.seasons.quote) is the same one the player saw; the server checks it all
// again when approving (a week taken meanwhile fails with code 'conflict' unless skipped). The player
// gets the decision by e-mail (the data layer asks krossi-billing to send it). Without the hall's
// invoicing details (`billingReady` false) an invoiced slot can't be approved: the sheet says so
// and links to Hallin asetukset.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync, useBusy } from '../../app/hooks.js';
import { navigate } from '../../app/router.js';
import { centsLabel, dateKey, locationsFor, minutesOf } from '../../features/booking.js';
import { WEEKDAY_SHORT, clockLabel, dayMonth, monthLabel, slotWhen } from '../../features/seasons.js';
import { formatDayMonth, formatTime } from '../../lib/format.js';
import {
  Avatar, Button, ChipSelect, Field, Icon, Input, Select, Sheet, Skeleton, Textarea, Toggle, useConfirm, useToast,
} from '../../ui/index.js';
import { DurationStepper } from './BookingParts.jsx';
import { ChargeList, InfoLine, InvoiceStateChip, SlotStatusChip } from './SeasonParts.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const today = () => dateKey(new Date());

function startOptions(venue, minutes) {
  const out = [];
  for (let m = minutesOf(venue.openFrom); m + minutes <= minutesOf(venue.openUntil); m += venue.slotMinutes || 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

/** '27 krt · 7 varattu' style court chips with the season's taken weeks per court. */
function CourtPicker({ courts, quote, value, onChange }) {
  return (
    <div className="ss-courts" role="group" aria-label="Kenttä">
      {courts.map((c) => {
        const n = quote?.courts?.find((x) => x.courtId === c.id)?.conflicts;
        return (
          <button key={c.id} type="button" className={cx('bk-court', value === c.id && 'is-on')} aria-pressed={value === c.id} onClick={() => onChange(c.id)}>
            <span className="bk-court-name">{c.shortName}</span>
            {n != null && <span className={cx('bk-court-price', n > 0 && 'is-warn')}>{n === 0 ? 'vapaa' : `${n} varattu`}</span>}
          </button>
        );
      })}
    </div>
  );
}

const CONFLICT_NAMES = { booking: 'varaus', block: 'este', league: 'liiga', season: 'kausivuoro', closed: 'suljettu' };

/** The quote for one court: weeks, taken weeks, price, months. */
function QuoteSummary({ q, billing, skip, onSkip }) {
  const conflicts = q.weeks.filter((w) => w.conflict);
  return (
    <div className="stack-3">
      <dl className="bk-facts">
        <div>
          <dt>Kerrat</dt>
          <dd>{q.count} krt{q.weeks.length ? <small>{dayMonth(q.weeks[0].date, true)}–{dayMonth(q.weeks[q.weeks.length - 1].date, true)}</small> : null}</dd>
        </div>
        {q.skipped.length > 0 && <div><dt>Pyhät</dt><dd><small>{q.skipped.map((d) => dayMonth(d)).join(', ')}</small></dd></div>}
        <div>
          <dt>Kausihinta</dt>
          <dd>{centsLabel(q.cents)}{q.fullCents > q.cents && <small>{centsLabel(q.fullCents)} − {q.discountPercent} %</small>}</dd>
        </div>
        {billing === 'card' && q.months.length > 0 && (
          <div><dt>Kuukaudet</dt><dd className="ss-months">{q.months.map((m) => <small key={m.month} className="t-num">{monthLabel(m.month, true)} {centsLabel(m.cents)}</small>)}</dd></div>
        )}
      </dl>
      {conflicts.length > 0 && (
        <div className="bhall-clash" role="status">
          <div className="bhall-clash-head">
            <Icon name="alert" size={16} />
            <span>{conflicts.length === 1 ? 'Yksi viikko on jo varattu' : `${conflicts.length} viikkoa on jo varattu`}</span>
          </div>
          <ul className="bhall-clash-list">
            {conflicts.slice(0, 8).map((w) => (
              <li key={w.date}><strong className="t-num">{dayMonth(w.date)}</strong> {w.conflict.title || CONFLICT_NAMES[w.conflict.kind] || ''}</li>
            ))}
            {conflicts.length > 8 && <li>+ {conflicts.length - 8} muuta</li>}
          </ul>
          <Toggle label="Ohita varatut viikot" hint={skip ? 'Kausivuoroon tulee vain vapaat viikot.' : 'Valitse toinen kenttä tai ohita viikot.'} checked={skip} onChange={onSkip} />
        </div>
      )}
    </div>
  );
}

/** Euros typed by staff -> cents, or null for "use the season price". */
function priceInput(text) {
  const value = String(text || '').trim().replace(/\s/g, '').replace(',', '.');
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

/** "Laskutustiedot puuttuvat" with a way to Hallin asetukset. */
function BillingMissing({ venue }) {
  return (
    <div className="ss-box">
      <InfoLine icon="alert" tone="danger">Hallin laskutustiedot (nimi ja tilinumero) puuttuvat, joten laskulla maksettavaa kausivuoroa ei voi vielä vahvistaa.</InfoLine>
      <Button variant="dark" size="sm" icon="settings" onClick={() => navigate(`/pelaa/halli/${venue.slug}?nakyma=asetukset`)}>Lisää laskutustiedot</Button>
    </div>
  );
}

export function SeasonStaffSheet({ open, onClose, mode, slot, venue, seasons, billingReady = true, onDone }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, run] = useBusy();

  // shared form state
  const [courtId, setCourtId] = useState(null);
  const [skip, setSkip] = useState(false);
  const [price, setPrice] = useState('');
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  // create
  const [holder, setHolder] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [seasonId, setSeasonId] = useState(null);
  const [weekday, setWeekday] = useState(1);
  const [startTime, setStartTime] = useState('17:00');
  const [minutes, setMinutes] = useState(60);
  const [locationId, setLocationId] = useState(null);
  const [fromDate, setFromDate] = useState('');

  const places = useMemo(() => (venue ? locationsFor(venue, 'tennis') : []), [venue]);

  useEffect(() => {
    if (!open) return;
    setCourtId(slot?.courtId || null);
    setSkip(false);
    setPrice('');
    setDeclining(false);
    setReason('');
    if (mode === 'create') {
      setHolder(''); setEmail(''); setAddress('');
      setSeasonId(seasons?.[0]?.id || null);
      setLocationId(places[0]?.id || null);
      setFromDate('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slot?.id, mode]);

  const season = mode === 'create' ? (seasons || []).find((s) => s.id === seasonId) || seasons?.[0] : (seasons || []).find((s) => s.id === slot?.seasonId);
  const where = mode === 'create' ? locationId : (slot?.locationId || null);
  const courts = useMemo(() => {
    const list = where ? places.filter((l) => l.id === where) : places;
    return list.flatMap((l) => l.courts.filter((c) => c.sport === 'tennis'));
  }, [places, where]);
  const timeInput = mode === 'create' ? { weekday, startTime, minutes } : slot ? { weekday: slot.weekday, startTime: slot.startTime, minutes: slot.minutes } : null;
  const from = mode === 'create' ? (fromDate || null) : slot && slot.startsOn > today() ? slot.startsOn : null;

  const quote = useAsync(
    () => (open && mode !== 'view' && season && timeInput ? api.seasons.quote({
      seasonId: season.id, courtId, locationId: courtId ? null : where, ...timeInput, fromDate: from,
    }) : Promise.resolve(null)),
    [open, mode, season?.id, courtId, where, timeInput?.weekday, timeInput?.startTime, timeInput?.minutes, from],
  );
  const q = quote.data;
  const chosen = courtId || q?.courtId || null;
  const conflicts = (q?.weeks || []).filter((w) => w.conflict).length;
  const agreed = priceInput(price);

  if (!venue || (mode !== 'create' && !slot)) return <Sheet open={false} onClose={onClose} />;

  const approve = () => run(async () => {
    try {
      const done = await api.seasons.approve(slot.id, { courtId: chosen, priceCents: slot.billing === 'invoice' ? agreed : null, skipConflicts: skip });
      onDone?.(`Kausivuoro vahvistettu: ${slotWhen(done)}, ${done.courtName} (${done.weeks} krt).`);
    } catch (err) {
      toast(err);
      if (err?.code === 'conflict') quote.reload();
    }
  });

  const decline = () => run(async () => {
    try {
      await api.seasons.decline(slot.id, reason);
      onDone?.('Hakemus hylätty.');
    } catch (err) {
      toast(err);
    }
  });

  const create = () => run(async () => {
    try {
      const done = await api.seasons.create({
        venueId: venue.id, seasonId: season.id, courtId: chosen, weekday, startTime, minutes, holderName: holder,
        billingEmail: email || null, billingAddress: address || null, priceCents: agreed, skipConflicts: skip, fromDate: fromDate || null,
      });
      onDone?.(`Kausivuoro lisätty: ${done.holderName}, ${slotWhen(done)} ${done.courtName}. Lasku ${done.invoice?.number || ''} tehty.`);
    } catch (err) {
      toast(err);
      if (err?.code === 'conflict') quote.reload();
    }
  });

  const end = async () => {
    const ok = await confirm({
      title: 'Päätetäänkö kausivuoro?',
      message: `${slot.holderName} · ${slotWhen(slot)}. Tulevat viikot vapautuvat muille.${slot.billing === 'card' ? ' Tulevia kuukausia ei veloiteta.' : ' Lasku jää ennalleen — tee mahdollinen hyvitys erikseen.'}`,
      confirmLabel: 'Päätä kausivuoro',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      try {
        const { released } = await api.seasons.end(slot.id);
        onDone?.(`Kausivuoro päätetty — ${released} viikkoa vapautui.`);
      } catch (err) {
        toast(err);
      }
    });
  };

  // ── Content ──
  let body;
  let footer;
  let title;
  let subtitle;

  const quoteBlock = (billing) => (
    quote.error && !q ? <InfoLine icon="alert" tone="danger">{quote.error.userMessage}</InfoLine>
      : !q ? <div className="stack-2"><Skeleton h={44} r={12} /><Skeleton h={44} r={12} /></div>
        : <QuoteSummary q={q} billing={billing} skip={skip} onSkip={setSkip} />
  );

  if (mode === 'view') {
    title = slot.holderName;
    subtitle = `${slotWhen(slot)} · ${slot.courtName || ''}`;
    body = (
      <div className="stack-4">
        <div className="bhall-who">
          {slot.holder ? <Avatar person={slot.holder} name={slot.holderName} size={44} /> : <span className="bhall-kind is-season" aria-hidden="true"><Icon name="users" size={20} /></span>}
          <span className="bhall-who-text">
            <span className="bhall-who-name truncate">{slot.holderName}</span>
            <span className="bhall-who-sub">{slot.holder ? 'Krossin pelaaja' : 'Hallin lisäämä'} · {slot.seasonName}</span>
          </span>
          <SlotStatusChip status={slot.status} size="md" />
        </div>
        <dl className="bk-facts">
          <div><dt>Aika</dt><dd>{slotWhen(slot)}<small>{slot.courtName} · {slot.locationName}</small></dd></div>
          <div><dt>Kerrat</dt><dd>{slot.weeks} krt<small>{dayMonth(slot.startsOn, true)}–{dayMonth(slot.endsOn, true)}{slot.skipDates.length ? ` · ohitetaan ${slot.skipDates.length} pv` : ''}</small></dd></div>
          <div><dt>Hinta</dt><dd>{centsLabel(slot.priceCents)}<small>{slot.billing === 'card' ? 'Kortilta kuukausittain' : 'Lasku'}</small></dd></div>
          {slot.billingEmail && <div><dt>Laskutus</dt><dd>{slot.billingEmail}{slot.billingAddress ? <small>{slot.billingAddress}</small> : null}</dd></div>}
          {slot.invoice && (
            <div><dt>Lasku</dt><dd className="ss-invoice-line"><span>Nro {slot.invoice.number} · {centsLabel(slot.invoice.amountCents)}</span><InvoiceStateChip invoice={slot.invoice} /></dd></div>
          )}
          {slot.declineReason && <div><dt>Syy</dt><dd>{slot.declineReason}</dd></div>}
          {slot.holder && ['active', 'declined'].includes(slot.status) && (
            <div>
              <dt>Ilmoitus</dt>
              <dd>{slot.notifiedAt ? `Sähköposti lähetetty ${formatDayMonth(slot.notifiedAt)} klo ${formatTime(slot.notifiedAt)}` : 'Sähköpostia ei ole lähetetty'}</dd>
            </div>
          )}
        </dl>
        {slot.billing === 'card' && <ChargeList charges={slot.charges} compact />}
      </div>
    );
    footer = (
      <div className="stack-2">
        {slot.invoice && <Button variant="dark" block icon="external" onClick={() => navigate(`/pelaa/lasku/${encodeURIComponent(slot.invoice.id)}`)}>Näytä lasku</Button>}
        {slot.status === 'active' && <Button variant="danger" block icon="close" loading={busy} onClick={end}>Päätä kausivuoro</Button>}
      </div>
    );
  } else if (mode === 'approve') {
    title = 'Kausivuorohakemus';
    subtitle = `${slot.holderName} · ${slot.seasonName}`;
    body = (
      <div className="stack-4">
        <div className="bhall-who">
          {slot.holder ? <Avatar person={slot.holder} name={slot.holderName} size={44} /> : null}
          <span className="bhall-who-text">
            <span className="bhall-who-name truncate">{slot.holderName}</span>
            <span className="bhall-who-sub">Haki {dayMonth(slot.createdAt.slice(0, 10))} · {slot.billing === 'card' ? 'kortilta kuukausittain' : 'laskulla'}</span>
          </span>
        </div>
        <dl className="bk-facts">
          <div><dt>Aika</dt><dd>{slotWhen(slot)}<small>{slot.courtName ? `Toive: ${slot.courtName}` : 'Mikä tahansa kenttä'}{slot.locationName ? ` · ${slot.locationName}` : ''}</small></dd></div>
          {slot.note && <div><dt>Viesti</dt><dd>{slot.note}</dd></div>}
        </dl>
        <div className="bk-field">
          <span className="eyebrow">Kenttä</span>
          <CourtPicker courts={courts} quote={q} value={chosen} onChange={setCourtId} />
        </div>
        {quoteBlock(slot.billing)}
        {slot.billing === 'invoice' ? (
          <Field label="Sovittu hinta" optional hint={q ? `Tyhjä = kausihinta ${centsLabel(q.cents)}` : null} htmlFor="ss-price" error={Number.isNaN(agreed) ? 'Tarkista hinta.' : ''}>
            <Input id="ss-price" inputMode="decimal" value={price} placeholder="esim. 650" onChange={(e) => setPrice(e.target.value)} />
          </Field>
        ) : (
          <InfoLine icon="lock">Ensimmäinen kuukausi veloitetaan pelaajan kortilta heti seuraavassa veloitusajossa, loput kunkin kuun 1. päivä.</InfoLine>
        )}
        {slot.billing === 'invoice' && !billingReady && !declining && <BillingMissing venue={venue} />}
        {declining && (
          <Field label="Syy pelaajalle" optional htmlFor="ss-reason" hint="Näkyy pelaajalle sähköpostissa ja sovelluksessa.">
            <Textarea id="ss-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="esim. Torstai-illat ovat jo täynnä" />
          </Field>
        )}
        <p className="bk-fine">{declining ? 'Pelaaja saa hylkäyksen sähköpostiin.' : `Pelaaja saa päätöksen sähköpostiin${slot.billing === 'invoice' ? ' laskun tietoineen' : ''}.`}</p>
      </div>
    );
    footer = declining ? (
      <div className="stack-2">
        <Button variant="danger" size="lg" block loading={busy} onClick={decline}>Hylkää hakemus</Button>
        <Button variant="ghost" block onClick={() => setDeclining(false)}>Takaisin</Button>
      </div>
    ) : (
      <div className="stack-2">
        <Button variant="lime" size="lg" block icon="check" loading={busy}
          disabled={!q || q.count === 0 || (conflicts > 0 && !skip) || Number.isNaN(agreed) || (slot.billing === 'invoice' && !billingReady)} onClick={approve}>
          {q ? `Hyväksy · ${q.count} krt` : 'Hyväksy'}
        </Button>
        <Button variant="ghost" block onClick={() => setDeclining(true)}>Hylkää</Button>
      </div>
    );
  } else {
    title = 'Uusi kausivuoro';
    subtitle = `${venue.name} · lasku`;
    const times = startOptions(venue, minutes);
    body = (
      <div className="stack-4">
        <Field label="Haltija" htmlFor="ss-holder" hint="Seura, yritys tai pelaaja. Näkyy hallin näkymässä ja laskulla.">
          <Input id="ss-holder" value={holder} maxLength={80} placeholder="esim. Seuran juniorit · keskiviikot" onChange={(e) => setHolder(e.target.value)} />
        </Field>
        <div className="ss-two">
          <Field label="Laskun sähköposti" optional htmlFor="ss-email">
            <Input id="ss-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="lasku@seura.fi" />
          </Field>
          <Field label="Laskutusosoite" optional htmlFor="ss-address">
            <Input id="ss-address" value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        </div>
        {(seasons || []).length > 1 && (
          <Field label="Kausi" htmlFor="ss-season">
            <Select id="ss-season" options={seasons.map((s) => ({ value: s.id, label: s.name }))} value={season?.id || ''} onChange={(e) => setSeasonId(e.target.value)} />
          </Field>
        )}
        <div className="bk-field">
          <span className="eyebrow">Viikonpäivä</span>
          <ChipSelect ariaLabel="Viikonpäivä" size="sm" layout="grid" columns={7}
            options={WEEKDAY_SHORT.map((label, i) => ({ value: String(i + 1), label }))}
            value={String(weekday)} onChange={(v) => v && setWeekday(Number(v))} />
        </div>
        <div className="ss-time-row">
          <label className="bk-field" htmlFor="ss-create-start">
            <span className="eyebrow">Alkaa</span>
            <Select id="ss-create-start" options={times.map((t) => ({ value: t, label: clockLabel(t) }))} value={times.includes(startTime) ? startTime : times[0]} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <div className="bk-field">
            <span className="eyebrow">Kesto</span>
            <DurationStepper value={minutes} options={venue.durations} onChange={setMinutes} />
          </div>
        </div>
        {places.length > 1 && (
          <div className="bk-field">
            <span className="eyebrow">Paikka</span>
            <ChipSelect ariaLabel="Paikka" size="sm" layout="scroll"
              options={places.map((l) => ({ value: l.id, label: l.name.replace('Kisapuiston ulkokentät', 'Ulkokentät') }))}
              value={locationId} onChange={(v) => { if (v) { setLocationId(v); setCourtId(null); } }} />
          </div>
        )}
        <div className="bk-field">
          <span className="eyebrow">Kenttä</span>
          <CourtPicker courts={courts} quote={q} value={chosen} onChange={setCourtId} />
        </div>
        <Field label="Alkaen" optional htmlFor="ss-from" hint="Tyhjä = heti seuraavasta viikosta">
          <Input id="ss-from" type="date" value={fromDate} min={today()} max={season?.endsOn} onChange={(e) => setFromDate(e.target.value)} />
        </Field>
        {quoteBlock('invoice')}
        <Field label="Sovittu hinta" optional hint={q ? `Tyhjä = kausihinta ${centsLabel(q.cents)}` : null} htmlFor="ss-create-price" error={Number.isNaN(agreed) ? 'Tarkista hinta.' : ''}>
          <Input id="ss-create-price" inputMode="decimal" value={price} placeholder="esim. 1500" onChange={(e) => setPrice(e.target.value)} />
        </Field>
        {!billingReady && <BillingMissing venue={venue} />}
      </div>
    );
    footer = (
      <Button variant="lime" size="lg" block icon="plus" loading={busy}
        disabled={!holder.trim() || !q || q.count === 0 || (conflicts > 0 && !skip) || Number.isNaN(agreed) || !billingReady} onClick={create}>
        {q ? `Lisää kausivuoro · ${q.count} krt` : 'Lisää kausivuoro'}
      </Button>
    );
  }

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title={title} subtitle={subtitle} footer={footer} size="md" className="bk-sheet">
      {body}
    </Sheet>
  );
}
