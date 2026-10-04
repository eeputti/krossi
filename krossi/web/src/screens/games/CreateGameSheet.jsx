// CreateGameSheet — overlay route /pelaa/uusi-peli.
//   ?tapahtuma=1  event mode (only when canCreateEvents)
//   ?kutsu=<id>   invite that player right after publishing
// Required basics are always visible (what / when / where); extras live in a "Lisätiedot"
// Disclosure. Success state stays in the same sheet: share link, invite, open the game.
import { useMemo, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync, useBusy } from '../../app/hooks.js';
import { usePaywall } from '../../app/paywall.jsx';
import { appUrl, goBack, navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import {
  Avatar, Button, ChipSelect, Disclosure, Field, Icon, Illustration, Input, Sheet, Stepper, Textarea, Toggle,
  confetti, useShare, useToast,
} from '../../ui/index.js';
import {
  COURT_SURFACES, INDOOR_VENUES, MATCH_TYPES, QUICK_TIME_WINDOWS, SKILL_LEVELS, labelOf,
} from '../../lib/constants.js';
import { capitalize, firstName, formatEuro, WEEKDAYS_SHORT } from '../../lib/format.js';
import { cityCenter } from '../../lib/geo.js';
import { InviteToGameSheet } from './InviteToGameSheet.jsx';
import { PinPicker } from './MapView.jsx';
import { matchLabel, notifyGamesChanged, shareText, whenText } from './gameUtils.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const DAYS_AHEAD = 14;

const TYPE_OPTIONS = [
  { value: 'kaksinpeli', label: 'Kaksinpeli', hint: '1 vs 1', icon: 'user' },
  { value: 'nelinpeli', label: 'Nelinpeli', hint: '2 vs 2', icon: 'users' },
  { value: 'pallottelu', label: 'Pallottelu', hint: 'Rennosti', icon: 'ball' },
];
const PLACE_OPTIONS = [
  { value: 'sisätennis', label: 'Sisällä', icon: 'home' },
  { value: 'ulkotennis', label: 'Ulkona', icon: 'sun' },
  { value: 'missä vain', label: 'Missä vain', icon: 'compass' },
];
const OTHER_VENUE = '__muu';

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function dayOptions(today) {
  const opts = Array.from({ length: DAYS_AHEAD }, (_, i) => {
    const d = addDays(today, i);
    const wd = WEEKDAYS_SHORT[d.getDay()];
    const dm = `${d.getDate()}.${d.getMonth() + 1}.`;
    return { value: String(i), label: i === 0 ? 'Tänään' : i === 1 ? 'Huomenna' : capitalize(wd), hint: i < 2 ? `${wd} ${dm}` : dm };
  });
  opts.push({ value: 'open', label: 'Aika sovitaan', hint: 'Sovitaan chatissa' });
  return opts;
}

/** Quick windows still ahead on the chosen day (today drops the ones that have started). */
function windowsFor(day) {
  if (day !== '0') return QUICK_TIME_WINDOWS;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  return QUICK_TIME_WINDOWS.filter((w) => w.hour * 60 > mins + 20);
}
function defaultTime(day) {
  const list = windowsFor(day);
  return list.find((w) => w.value === 'ilta')?.value || list[0]?.value || 'exact';
}

function scheduledIso(form, today) {
  if (form.day === 'open') return null;
  const d = addDays(today, Number(form.day));
  if (form.time === 'exact') {
    const [h, m] = String(form.exactTime || '18:00').split(':').map(Number);
    d.setHours(h || 0, m || 0, 0, 0);
  } else {
    const w = QUICK_TIME_WINDOWS.find((x) => x.value === form.time) || QUICK_TIME_WINDOWS[3];
    d.setHours(w.hour, 0, 0, 0);
  }
  return d.toISOString();
}

function Question({ n, title, children, className }) {
  return (
    <section className={cx('games-q', className)}>
      <h3 className="games-q-title"><span className="games-q-num t-num">{n}</span>{title}</h3>
      {children}
    </section>
  );
}

export function CreateGameSheet({ query }) {
  const { user, profile, canCreateEvents, eventCities } = useSession();
  const { requirePaid } = usePaywall();
  const toast = useToast();
  const shareLink = useShare();
  const [busy, run] = useBusy();
  const eventMode = query.tapahtuma === '1' && canCreateEvents;
  const inviteId = query.kutsu && query.kutsu !== user?.id ? query.kutsu : null;
  const homeCity = profile?.city || profile?.areas?.[0] || 'Lahti';

  const today = useMemo(startOfToday, []);
  const days = useMemo(() => dayOptions(today), [today]);
  const [form, setForm] = useState(() => {
    const day = new Date().getHours() >= 19 ? '1' : '0';
    return {
      matchType: 'kaksinpeli', day, time: defaultTime(day), exactTime: '18:00',
      locationType: 'sisätennis', venue: '', place: '',
      courtSurface: '', minSkillLevel: '', courtPrice: '', creatorCoversFull: false, title: '', description: '', pin: null,
      city: '', maxPlayers: 8,
    };
  });
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setDay = (day) => setForm((f) => ({
    ...f, day, time: f.time === 'exact' || windowsFor(day).some((w) => w.value === f.time) ? f.time : defaultTime(day),
  }));
  const [tried, setTried] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [created, setCreated] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const [open, setOpen] = useState(true);
  const after = useRef(null);
  const close = (then) => { after.current = then || null; setOpen(false); };

  const invitee = useAsync(() => (inviteId ? api.players.get(inviteId) : Promise.resolve(null)), [inviteId]);

  // ── derived ──
  const city = eventMode ? (form.city || eventCities[0] || homeCity) : homeCity;
  const venues = INDOOR_VENUES.filter((v) => v.city === city);
  const venueChips = form.locationType === 'sisätennis' && venues.length > 0;
  const venue = venueChips ? venues.find((v) => v.name === form.venue) : null;
  const typing = !venueChips || form.venue === OTHER_VENUE;
  const locationName = venue ? venue.name : typing ? form.place.trim() : '';
  const coords = form.pin || (venue ? [venue.lat, venue.lng] : null);
  const iso = scheduledIso(form, today);
  const timeError = iso && Date.parse(iso) < Date.now() + 5 * 60_000 ? 'Tämä aika on jo mennyt — valitse myöhempi.' : null;
  const priceNum = form.courtPrice === '' ? null : Number(String(form.courtPrice).replace(',', '.'));
  const priceError = priceNum != null && (!Number.isFinite(priceNum) || priceNum < 0 || priceNum > 999) ? 'Tarkista hinta.' : null;
  const titleError = eventMode && tried && !form.title.trim() ? 'Anna tapahtumalle nimi.' : null;
  const players = MATCH_TYPES.find((m) => m.value === form.matchType)?.players || 2;
  const perPlayer = priceNum && !form.creatorCoversFull ? Math.round((priceNum / players) * 2) / 2 : null;
  const windows = windowsFor(form.day);
  const timeOptions = [
    ...windows.map((w) => ({ value: w.value, label: w.label, hint: w.hint })),
    { value: 'exact', label: 'Tarkka aika', hint: 'Valitse itse', icon: 'clock' },
  ];

  const placeText = locationName || (form.locationType === 'missä vain' ? 'paikka sovitaan' : labelOf(PLACE_OPTIONS, form.locationType).toLowerCase());
  const summary = [eventMode && form.title.trim() ? form.title.trim() : matchLabel(form.matchType), whenText(iso), placeText].join(' · ');
  const extras = [
    form.courtSurface && labelOf(COURT_SURFACES, form.courtSurface),
    form.minSkillLevel && `${labelOf(SKILL_LEVELS, form.minSkillLevel)}+`,
    !eventMode && priceNum ? formatEuro(priceNum) : null,
    !eventMode && form.creatorCoversFull && 'tarjoan vuoron',
    !eventMode && form.title.trim() && 'otsikko',
    form.description.trim() && 'kuvaus',
    form.pin && 'karttapiste',
  ].filter(Boolean);

  const publish = () => {
    setTried(true);
    if (timeError || priceError || (eventMode && !form.title.trim())) {
      toast('Tarkista merkityt kohdat.', { tone: 'error' });
      return;
    }
    const doPublish = () => run(async () => {
      const input = {
        kind: eventMode ? 'event' : 'open',
        matchType: form.matchType,
        locationType: form.locationType,
        locationName,
        city,
        lat: coords ? coords[0] : null,
        lng: coords ? coords[1] : null,
        scheduledAt: iso,
        title: form.title.trim() || null,
        description: form.description.trim() || null,
        courtSurface: form.courtSurface || null,
        minSkillLevel: form.minSkillLevel || null,
        courtPrice: priceNum || null,
        creatorCoversFull: !eventMode && form.creatorCoversFull,
        maxPlayers: eventMode ? form.maxPlayers : null,
      };
      try {
        const id = await api.games.create(input);
        notifyGamesChanged();
        if (inviteId) {
          try {
            const res = await api.games.invite(id, [inviteId]);
            const name = firstName(invitee.data?.name);
            if (res?.alreadyInvited?.length) toast(`${name} on jo kutsuttu`, { tone: 'info', icon: 'info' });
            else toast(`Kutsu lähti: ${name} 🎾`, { icon: 'send' });
          } catch (err) {
            toast(err);
          }
        }
        setCreated({ id, summary, kind: input.kind, share: { title: input.title, matchType: input.matchType, scheduledAt: iso, locationName, city } });
        confetti();
      } catch (err) {
        toast(err);
      }
    });
    if (eventMode) doPublish();
    else requirePaid(doPublish, 'Julkaise peli ja löydä pelikaveri');
  };

  const shareCreated = () => shareLink({ title: 'Krossi', text: shareText(created.share), url: appUrl(`/pelaa/peli/${created.id}`) });

  const formBody = (
    <div className="games-create">
      {inviteId && invitee.data && (
        <div className="games-create-invitee rise">
          <Avatar person={invitee.data} size={38} />
          <span><strong>{firstName(invitee.data.name)}</strong> saa kutsun heti, kun julkaiset pelin.</span>
        </div>
      )}

      {eventMode && (
        <Question n={<Icon name="flag" size={13} strokeWidth={2.6} />} title="Tapahtuma" className="games-q-event">
          <Field label="Tapahtuman nimi" error={titleError} htmlFor="games-event-title">
            <Input id="games-event-title" value={form.title} maxLength={60} placeholder="Esim. Lauantain nelinpeliturnaus" onChange={(e) => set('title', e.target.value)} />
          </Field>
          {eventCities.length > 1 && (
            <Field label="Kaupunki">
              <ChipSelect options={eventCities.map((c) => ({ value: c, label: c }))} value={city} onChange={(v) => setForm((f) => ({ ...f, city: v, venue: '', pin: null }))} size="sm" ariaLabel="Kaupunki" />
            </Field>
          )}
          <div className="games-create-row">
            <Field label="Osallistujia enintään">
              <Stepper value={form.maxPlayers} onChange={(v) => set('maxPlayers', v)} min={2} max={64} label="Osallistujia enintään" />
            </Field>
            <Field label="Osallistumismaksu" optional error={tried ? priceError : null} htmlFor="games-event-fee">
              <span className="games-euro">
                <Input id="games-event-fee" inputMode="decimal" value={form.courtPrice} placeholder="0" onChange={(e) => set('courtPrice', e.target.value)} />
                <span className="games-euro-unit">€ / hlö</span>
              </span>
            </Field>
          </div>
        </Question>
      )}

      <Question n={1} title="Mitä pelataan?">
        <ChipSelect options={TYPE_OPTIONS} value={form.matchType} onChange={(v) => set('matchType', v)} size="lg" layout="grid" columns={3} className="games-create-type" ariaLabel="Pelimuoto" />
      </Question>

      <Question n={2} title="Milloin?">
        <ChipSelect options={days} value={form.day} onChange={setDay} layout="scroll" size="md" className="games-create-days" ariaLabel="Päivä" />
        {form.day !== 'open' && (
          <div className="games-create-time">
            <ChipSelect options={timeOptions} value={form.time} onChange={(v) => set('time', v)} layout="scroll" size="md" className="games-create-days" ariaLabel="Kellonaika" />
            {form.time === 'exact' && (
              <div className="games-create-exact rise">
                <Icon name="clock" size={18} />
                <Input type="time" step={900} value={form.exactTime} onChange={(e) => set('exactTime', e.target.value)} aria-label="Tarkka kellonaika" />
              </div>
            )}
            {windows.length === 0 && form.time === 'exact' && <p className="games-create-note">Tälle päivälle ehtii enää tarkalla ajalla — tai valitse huomenna.</p>}
            {timeError && <p className="games-create-error" role="alert">{timeError}</p>}
          </div>
        )}
      </Question>

      <Question n={3} title="Missä?">
        <ChipSelect options={PLACE_OPTIONS} value={form.locationType} onChange={(v) => setForm((f) => ({ ...f, locationType: v }))} layout="grid" columns={3} className="games-create-where" ariaLabel="Sisällä vai ulkona" />
        {venueChips && (
          <ChipSelect
            options={[...venues.map((v) => ({ value: v.name, label: v.name })), { value: OTHER_VENUE, label: 'Muu paikka', icon: 'edit' }]}
            value={form.venue}
            onChange={(v) => setForm((f) => ({ ...f, venue: v }))}
            allowEmpty
            className="games-create-venues"
            ariaLabel="Halli"
          />
        )}
        {typing && (
          <Input
            icon="pin"
            className="games-create-place"
            value={form.place}
            maxLength={80}
            onChange={(e) => set('place', e.target.value)}
            placeholder={form.locationType === 'ulkotennis' ? 'Esim. Kisapuiston kentät' : form.locationType === 'missä vain' ? 'Esim. keskustan kentät (valinnainen)' : 'Hallin tai kentän nimi'}
            aria-label="Paikka"
          />
        )}
      </Question>

      <Disclosure title="Lisätiedot" summary={extras.length ? extras.join(' · ') : 'Pinta, taso, hinta, kuvaus…'} className="games-create-more">
        <Field label="Kenttäpinta">
          <ChipSelect options={COURT_SURFACES.map((s) => ({ value: s.value, label: s.label }))} value={form.courtSurface} onChange={(v) => set('courtSurface', v)} allowEmpty size="sm" ariaLabel="Kenttäpinta" />
        </Field>
        <Field label="Vastustajan minimitaso" hint={form.minSkillLevel ? 'Näkyy pelikortissa — sopivan tasoiset löytävät pelin.' : 'Tyhjä = kaikki tasot tervetulleita.'}>
          <ChipSelect options={SKILL_LEVELS.map((s) => ({ value: s.value, label: s.label }))} value={form.minSkillLevel} onChange={(v) => set('minSkillLevel', v)} allowEmpty size="sm" ariaLabel="Minimitaso" />
        </Field>
        {!eventMode && (
          <>
            <Field
              label="Kenttävuoron hinta"
              optional
              htmlFor="games-price"
              error={tried ? priceError : null}
              hint={perPlayer ? `Noin ${formatEuro(perPlayer)} / pelaaja` : form.creatorCoversFull && priceNum ? 'Muut pelaavat ilmaiseksi 🙌' : 'Koko vuoron hinta — jaetaan pelaajien kesken.'}
            >
              <span className="games-euro">
                <Input id="games-price" inputMode="decimal" value={form.courtPrice} placeholder="Esim. 28" onChange={(e) => set('courtPrice', e.target.value)} />
                <span className="games-euro-unit">€</span>
              </span>
            </Field>
            <Toggle icon="gift" label="Tarjoan koko vuoron" hint="Muut pelaavat ilmaiseksi." checked={form.creatorCoversFull} onChange={(v) => set('creatorCoversFull', v)} />
            <Field label="Otsikko" optional htmlFor="games-title">
              <Input id="games-title" value={form.title} maxLength={60} placeholder="Esim. Rento iltamatsi" onChange={(e) => set('title', e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Kuvaus" optional htmlFor="games-desc">
          <Textarea id="games-desc" value={form.description} maxLength={500} rows={3} placeholder="Kerro tasosta, palloista tai mistä sovitaan…" onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Karttapiste" optional hint={venue && !form.pin ? `${venue.name} näkyy kartalla automaattisesti.` : null}>
          {showMap ? (
            <>
              <PinPicker lat={coords?.[0] ?? null} lng={coords?.[1] ?? null} center={cityCenter(city)} onPick={(lat, lng) => set('pin', [lat, lng])} />
              {form.pin && <Button variant="ghost" size="sm" icon="close" className="games-create-unpin" onClick={() => set('pin', null)}>Poista oma karttapiste</Button>}
            </>
          ) : (
            <Button variant="outline" size="sm" icon="map" onClick={() => setShowMap(true)}>{coords ? 'Tarkenna kartalla' : 'Lisää karttaan'}</Button>
          )}
        </Field>
      </Disclosure>
    </div>
  );

  const successBody = created && (
    <div className="games-created">
      <Illustration name="celebrate" size={200} className="games-created-art" />
      <h2 className="games-created-title">{created.kind === 'event' ? 'Tapahtuma julkaistu!' : 'Peli julkaistu!'} 🎾</h2>
      <p className="games-created-text">Jaa linkki kavereille — peli täyttyy nopeimmin, kun pyydät suoraan.</p>
      <div className="games-created-summary"><Icon name="calendar" size={16} /><span>{created.summary}</span></div>
      <div className="games-created-actions">
        <Button variant="lime" size="lg" block icon="share" onClick={shareCreated}>Jaa linkki kavereille</Button>
        <Button variant="dark" size="lg" block icon="users" onClick={() => setInviteOpen(true)}>Kutsu pelikavereita</Button>
        <Button variant="ghost" size="lg" block iconRight="arrow-right" onClick={() => close(() => navigate(`/pelaa/peli/${created.id}`, { replace: true }))}>Avaa peli</Button>
      </div>
    </div>
  );

  return (
    <>
      <Sheet
        open={open}
        onClose={() => close()}
        onClosed={() => (after.current ? after.current() : goBack('/pelaa/pelit'))}
        size="lg"
        title={created ? undefined : eventMode ? 'Uusi tapahtuma' : 'Pelataanko?'}
        subtitle={created ? undefined : 'Perusasiat riittävät — loput voi lisätä halutessa.'}
        className="games-create-sheet"
        footer={created ? null : (
          <div className="games-create-footer">
            <p className="games-create-summary"><Icon name="ball" size={16} /><span className="truncate">{summary}</span></p>
            <Button variant="lime" size="lg" block icon="send" loading={busy} onClick={publish}>{eventMode ? 'Julkaise tapahtuma' : 'Julkaise peli'}</Button>
          </div>
        )}
      >
        {created ? successBody : formBody}
      </Sheet>
      {created && (
        <InviteToGameSheet
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          gameId={created.id}
          city={city}
          excludeIds={[]}
          shareText={shareText(created.share)}
        />
      )}
    </>
  );
}
