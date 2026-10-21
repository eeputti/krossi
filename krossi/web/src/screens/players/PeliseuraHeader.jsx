// PeliseuraHeader — the top of the Peliseura tab, shared by its views: Pelaajat (/pelaa/pelaajat),
// Avoimet pelit (/pelaa/pelit) and Kartta (/pelaa/pelit?nakyma=kartta).
//
//   title       "Peliseura", the view's own subtitle (city) and actions (filters)
//   seek        one way to say "I want to play": Haen peliseuraa → Nyt (Pelaan nyt) | Tällä viikolla
//               (others see I'm free) | Tiettyyn aikaan (create a game). While I'm seeking it shows
//               what others see and Lopeta instead.
//   court       phones only, where a hall is bookable: "Onko jo pelikaveri? Varaa kenttä" — booking is its
//               own page (desktop has Varaa in the side nav)
//   views       Pelaajat | Avoimet pelit | Kartta
import { useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { openCreateGame } from '../../app/AppShell.jsx';
import { useNow } from '../../app/hooks.js';
import { usePaywall } from '../../app/paywall.jsx';
import { navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { capitalize, formatTime } from '../../lib/format.js';
import { Button, Icon, ListRow, PageHeader, Segmented, Sheet, useToast } from '../../ui/index.js';
import { PlayingNowSheet } from '../home/PlayingNowSheet.jsx';
import { useBookingHall } from '../booking/useBookingHall.js';
import { isPlayingNow, timeLeft } from './playerInfo.js';

const VIEWS = [
  { value: 'pelaajat', label: 'Pelaajat', icon: 'users', path: '/pelaa/pelaajat' },
  { value: 'pelit', label: 'Avoimet pelit', icon: 'list', path: '/pelaa/pelit' },
  { value: 'kartta', label: 'Kartta', icon: 'map', path: '/pelaa/pelit?nakyma=kartta' },
];

function SeekCard() {
  const { user, profile, setProfile } = useSession();
  const { requirePaid } = usePaywall();
  const toast = useToast();
  const now = useNow(30_000);
  const [sheet, setSheet] = useState(null); // 'when' | 'now'
  const [busy, setBusy] = useState(false);
  const playingNow = isPlayingNow(profile, now);
  const thisWeek = Boolean(profile?.playingThisWeek);

  const setWeek = async (value) => {
    setProfile((p) => (p ? { ...p, playingThisWeek: value } : p));
    try {
      await api.profile.setPlayingThisWeek(user.id, value);
      toast(value ? 'Muut näkevät nyt, että pelaat tällä viikolla' : 'Et enää näy tällä viikolla pelaavana', { icon: value ? 'sparkles' : undefined, tone: value ? undefined : 'info' });
    } catch (err) {
      setProfile((p) => (p ? { ...p, playingThisWeek: !value } : p));
      toast(err);
    }
  };

  const stopNow = async () => {
    const prev = { until: profile.playingNowUntil, note: profile.playingNowNote };
    setBusy(true);
    setProfile((p) => (p ? { ...p, playingNowUntil: null, playingNowNote: null } : p));
    try {
      await api.profile.stopPlayingNow(user.id);
      toast('Pelaan nyt -ilmoitus lopetettu', { tone: 'info' });
    } catch (err) {
      setProfile((p) => (p ? { ...p, playingNowUntil: prev.until, playingNowNote: prev.note } : p));
      toast(err);
    } finally {
      setBusy(false);
    }
  };

  const pick = (choice) => {
    setSheet(null);
    if (choice === 'now') requirePaid(() => setTimeout(() => setSheet('now'), 280), 'Kerro, että pelaat nyt');
    else if (choice === 'week') setWeek(true);
    else requirePaid(() => openCreateGame(), 'Luo peli');
  };

  let card;
  if (playingNow) {
    card = (
      <div className="ps-seek is-on">
        <span className="ps-seek-icon is-now"><Icon name="bolt" size={18} strokeWidth={2.4} /></span>
        <span className="ps-seek-text">
          <span className="ps-seek-title">Pelaat nyt klo <span className="t-num">{formatTime(profile.playingNowUntil)}</span> asti</span>
          <span className="ps-seek-sub truncate">{profile.playingNowNote ? `“${profile.playingNowNote}”` : capitalize(timeLeft(profile.playingNowUntil, now))}</span>
        </span>
        <Button variant="soft" size="sm" loading={busy} onClick={stopNow}>Lopeta</Button>
      </div>
    );
  } else if (thisWeek) {
    card = (
      <div className="ps-seek is-on">
        <span className="ps-seek-icon"><Icon name="calendar" size={18} strokeWidth={2.2} /></span>
        <span className="ps-seek-text">
          <span className="ps-seek-title">Haet peliseuraa tällä viikolla</span>
          <span className="ps-seek-sub">Muut näkevät, että olet vapaana</span>
        </span>
        <Button variant="soft" size="sm" onClick={() => setWeek(false)}>Lopeta</Button>
      </div>
    );
  } else {
    card = (
      <Button variant="lime" size="lg" block icon="plus" className="ps-seek-btn" onClick={() => setSheet('when')}>
        Haen peliseuraa
      </Button>
    );
  }

  return (
    <>
      {card}
      <Sheet open={sheet === 'when'} onClose={() => setSheet(null)} size="sm" title="Milloin pelaisit?" subtitle="Muut pelaajat näkevät sen ja voivat pyytää sinut peliin.">
        <div className="ps-when">
          <ListRow icon="bolt" title="Nyt" subtitle="Lähtisit kentälle heti, parin tunnin sisään" onClick={() => pick('now')} />
          <ListRow icon="calendar" title="Tällä viikolla" subtitle="Näyt pelaajissa vapaana koko viikon" onClick={() => pick('week')} />
          <ListRow icon="clock" title="Tiettyyn aikaan" subtitle="Luo peli ja jaa linkki — muut liittyvät mukaan" onClick={() => pick('game')} />
        </div>
      </Sheet>
      <PlayingNowSheet open={sheet === 'now'} onClose={() => setSheet(null)} />
    </>
  );
}

function CourtLink() {
  const { profile } = useSession();
  const cities = useMemo(() => [...(profile?.areas || []), profile?.city].filter(Boolean), [profile?.areas, profile?.city]);
  const { hall } = useBookingHall(cities, { anyCity: true });
  if (!hall) return null;
  return (
    <button type="button" className="ps-court hide-desktop" onClick={() => navigate('/pelaa/varaa')}>
      <Icon name="court" size={18} />
      <span className="ps-court-text">Onko jo pelikaveri? <b>Varaa kenttä</b></span>
      <Icon name="chevron-right" size={16} />
    </button>
  );
}

export function PeliseuraHeader({ view, subtitle, actions }) {
  const go = (value) => navigate(VIEWS.find((v) => v.value === value).path, { replace: true });
  return (
    <div className="ps-head">
      <PageHeader title="Peliseura" subtitle={subtitle} actions={actions} />
      <SeekCard />
      <CourtLink />
      <Segmented className="ps-views" ariaLabel="Näkymä" value={view} onChange={go} options={VIEWS} />
    </div>
  );
}
