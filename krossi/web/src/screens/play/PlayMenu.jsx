// PlayMenu.jsx — "Pelataanko?": the big middle button of the phone tab bar (and the lime button
// in the side nav and on Koti) opens this menu, the way Koutsi's "Merkitse" does.
//
// Two doors, one loop. "Varaa kenttä" is for a player who has somebody to play with and needs a
// court (free — no paywall); "Etsi peliseuraa" is for one who needs somebody, and opens a small
// sheet: what is going on near me ("Ajankohtaista": a booked court with nobody on it, an invite
// waiting, players who play now, open games this week), then create a game, open games, players.
// Each side leads to the other: a court with nobody on it shows "Puuttuu pelikaveri" and the
// partner sheet offers to open it to others; a game page offers "Varaa kenttä tälle pelille".
// On top: my next games and court bookings ("Tulossa"). Below the doors: Pelaan nyt, Kirjaa tulos,
// Kutsu and Liigat as small shortcuts.
//
// Without a bookable hall (anywhere but the pilot hall, for now) there is no court door: the
// partner options sit in the menu itself, so nobody taps through a door that leads nowhere.
// Mounted once by App.jsx; anything opens it with openPlayMenu() (AppShell.jsx).
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { openCreateGame, PLAY_MENU_OPEN } from '../../app/AppShell.jsx';
import { useAsync, useNow } from '../../app/hooks.js';
import { usePaywall } from '../../app/paywall.jsx';
import { navigate, useRoute } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { dateKey, freeSlots, gameForBooking, sportsOf } from '../../features/booking.js';
import { dayLabel, firstName, formatGameTime, formatTime, plural } from '../../lib/format.js';
import { AvatarStack, Icon, Sheet, Skeleton, useToast } from '../../ui/index.js';
import { useBookingHall } from '../booking/useBookingHall.js';
import { gameTitle, isFull, notifyGamesChanged, placeLine, spotsLabel, whenText } from '../games/gameUtils.js';
import { PlayingNowSheet } from '../home/PlayingNowSheet.jsx';
import { cityIn, isPlayingNow } from '../players/playerInfo.js';
import { InviteSheet } from '../shared/InviteSheet.jsx';
import { MatchResultSheet } from '../shared/MatchResultSheet.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const DAY_MS = 86_400_000;
const MAX_UPCOMING = 6;
const MAX_NEWS = 2;
const LATER = Number.MAX_SAFE_INTEGER; // "aika sovitaan" games sort last
const norm = (s) => String(s || '').trim().toLocaleLowerCase('fi');
const gamePath = (id) => `/pelaa/peli/${id}`;

function chipState(game, now) {
  const start = game.scheduledAt ? Date.parse(game.scheduledAt) : NaN;
  if (start <= now) return { text: 'Käynnissä', live: true };
  if (game.isMine) return { text: isFull(game) ? 'Täynnä' : spotsLabel(game), live: false };
  return { text: 'Olet mukana', live: false };
}

/** My courts nobody plays on yet: confirmed bookings that are no game's court and aren't split. */
function emptyCourts(games, bookings) {
  return (bookings || []).filter((b) => b.status === 'confirmed' && !b.split && !gameForBooking(games, b));
}

/** My next games and court bookings side by side; a tap opens the game or the booking. */
function Upcoming({ mine, bookings, hall, now, onOpenGame, onOpenBooking, onAll }) {
  const games = (mine.data?.upcoming || []).filter((g) => g.status !== 'cancelled');
  // A booking that is one of my games' court shows as that game; the rest are courts of their own.
  const courts = (bookings || []).filter((b) => b.status === 'confirmed' && !gameForBooking(games, b));
  const items = [
    ...games.map((g) => ({ kind: 'game', id: g.id, at: g.scheduledAt ? Date.parse(g.scheduledAt) : LATER, game: g })),
    ...courts.map((b) => ({ kind: 'court', id: b.id, at: Date.parse(b.startsAt), booking: b })),
  ].sort((a, b) => a.at - b.at);
  const shown = items.slice(0, MAX_UPCOMING);
  const when = (iso) => `${dayLabel(iso, new Date(now))} ${formatTime(iso)}`;

  let body;
  if (mine.loading && !mine.data) {
    body = <div className="play-strip" aria-busy="true">{[0, 1].map((i) => <Skeleton key={i} w={150} h={84} r={14} />)}</div>;
  } else if (mine.error && !mine.data) {
    body = <p className="play-hint">Pelejäsi ei saatu ladattua. <button type="button" className="play-textlink" onClick={() => mine.reload()}>Yritä uudelleen</button></p>;
  } else if (shown.length === 0) {
    body = <p className="play-hint">{hall ? 'Ei vielä sovittuja pelejä — varaa kenttä tai etsi peliseuraa alta.' : 'Ei vielä sovittuja pelejä — luo oma tai liity avoimeen alta.'}</p>;
  } else {
    body = (
      <div className="play-strip">
        {shown.map((item) => {
          if (item.kind === 'court') {
            const b = item.booking;
            const empty = !b.split;
            return (
              <button key={`c-${b.id}`} type="button" className={cx('play-chip', 'is-court', empty && 'is-empty')} onClick={() => onOpenBooking(b)}>
                <span className="play-chip-time t-num">{when(b.startsAt)}</span>
                <span className="play-chip-name">{b.courtName}</span>
                <span className="play-chip-place truncate">{b.locationName}</span>
                <span className="play-chip-state">{empty ? 'Puuttuu pelikaveri' : 'Kenttä varattu'}</span>
              </button>
            );
          }
          const g = item.game;
          const state = chipState(g, now);
          return (
            <button key={`g-${g.id}`} type="button" className={cx('play-chip', state.live && 'is-live')} onClick={() => onOpenGame(g)}>
              <span className="play-chip-time t-num">{g.scheduledAt ? when(g.scheduledAt) : 'Aika sovitaan'}</span>
              <span className="play-chip-name">{gameTitle(g)}</span>
              <span className="play-chip-place truncate">{placeLine(g)}</span>
              <span className="play-chip-state">{state.live && <span className="play-live" aria-hidden="true" />}{state.text}</span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="play-upcoming">
      <div className="play-head">
        <span className="eyebrow">Tulossa</span>
        {games.length > 0 && <button type="button" className="play-textlink" onClick={onAll}>{items.length > shown.length ? `Kaikki (${items.length})` : 'Omat pelit'}</button>}
      </div>
      {body}
    </div>
  );
}

function NewsCard({ news }) {
  return (
    <button type="button" className={cx('play-news', `is-${news.tone}`)} onClick={news.run}>
      {news.people?.length > 0 && <AvatarStack people={news.people} max={3} size={34} />}
      {news.icon && <span className="play-news-icon" aria-hidden="true"><Icon name={news.icon} size={18} strokeWidth={2.3} /></span>}
      <span className="play-news-main">
        <span className="play-news-eyebrow">{news.live && <span className="play-live" aria-hidden="true" />}{news.eyebrow}</span>
        <span className="play-news-title truncate">{news.title}</span>
        <span className="play-news-sub truncate">{news.sub}</span>
      </span>
      <Icon name="chevron-right" size={20} />
    </button>
  );
}

/** "Etsi peliseuraa": what is going on near me, then the three ways to get somebody to play with. */
function PartnerOptions({ news, loaded, tiles }) {
  return (
    <>
      {(news.length > 0 || !loaded) && (
        <div className="play-news-list">
          <span className="eyebrow">Ajankohtaista</span>
          {news.length > 0
            ? news.slice(0, MAX_NEWS).map((n) => <NewsCard key={n.id} news={n} />)
            : <Skeleton h={68} r={18} />}
        </div>
      )}
      <div className="play-grid">
        {tiles.map((t) => (
          <button key={t.id} type="button" className={cx('play-tile', t.primary && 'is-primary', t.wide && 'is-wide')} onClick={t.run}>
            <span className={cx('play-tile-icon', `is-${t.tone}`)}><Icon name={t.icon} size={22} strokeWidth={t.primary ? 2.6 : 2} /></span>
            <span className="play-tile-title">{t.title}</span>
            <span className="play-tile-sub">{t.sub}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function Door({ tone, icon, title, sub, onClick }) {
  return (
    <button type="button" className={cx('play-door', `is-${tone}`)} onClick={onClick}>
      <span className="play-door-icon" aria-hidden="true"><Icon name={icon} size={24} strokeWidth={2.2} /></span>
      <span className="play-door-text">
        <span className="play-door-title">{title}</span>
        <span className="play-door-sub truncate">{sub}</span>
      </span>
      <Icon name="chevron-right" size={20} />
    </button>
  );
}

export function PlayMenu() {
  const { user, profile, setProfile, paid, canCreateEvents } = useSession();
  const { requirePaid } = usePaywall();
  const toast = useToast();
  const route = useRoute();
  const now = useNow(30_000);
  // 'menu' | 'partner' (Etsi peliseuraa) | 'now' (Pelaan nyt) | 'result' (Kirjaa tulos) | 'invite' (Kutsu kaveri) | null
  const [sheet, setSheet] = useState(null);
  const [opened, setOpened] = useState(0);
  const city = profile?.city || '';
  const { hall } = useBookingHall([city, ...(profile?.areas || [])], { anyCity: true });

  useEffect(() => {
    const onOpen = () => { setOpened((n) => n + 1); setSheet('menu'); };
    window.addEventListener(PLAY_MENU_OPEN, onOpen);
    return () => window.removeEventListener(PLAY_MENU_OPEN, onOpen);
  }, []);
  // A tap that leads to another page leaves the menu behind.
  useEffect(() => { setSheet((s) => (s === 'menu' || s === 'partner' ? null : s)); }, [route.path]);

  // Fresh data every time the menu opens (the previous answer stays on screen meanwhile).
  const load = opened > 0;
  const mine = useAsync(() => (load ? api.games.listMine() : Promise.resolve(null)), [opened]);
  const open = useAsync(() => (load ? api.games.listOpen() : Promise.resolve(null)), [opened]);
  const invites = useAsync(() => (load ? api.games.listInvites() : Promise.resolve(null)), [opened]);
  const players = useAsync(() => (load && paid && city ? api.players.list({ city }) : Promise.resolve(null)), [opened, paid, city]);
  const bookings = useAsync(() => (load && hall ? api.booking.listMine() : Promise.resolve(null)), [opened, hall?.id]);
  const hallDay = useAsync(() => (load && hall ? api.booking.day(hall.id, dateKey(new Date())) : Promise.resolve(null)), [opened, hall?.id]);

  const areas = useMemo(() => new Set([...(profile?.areas || []), city].filter(Boolean).map(norm)), [profile?.areas, city]);
  const openWeek = useMemo(() => (open.data || [])
    .filter((g) => !g.isMine && !g.iJoined && g.status === 'open' && (areas.size === 0 || areas.has(norm(g.city))))
    .filter((g) => !g.scheduledAt || Date.parse(g.scheduledAt) - now < 7 * DAY_MS), [open.data, areas, now]);
  const playingNow = (players.data || []).filter((p) => isPlayingNow(p, now));
  const freeThisWeek = (players.data || []).filter((p) => p.playingThisWeek && !isPlayingNow(p, now));
  const active = isPlayingNow(profile, now);
  const myGames = (mine.data?.upcoming || []).filter((g) => g.status !== 'cancelled');
  const myCourts = bookings.data?.upcoming || [];
  const lonely = emptyCourts(myGames, myCourts)[0] || null;
  // Free start times left today at the hall (1 h, the booking page's default length).
  const freeToday = useMemo(() => {
    if (!hall || !hallDay.data) return null;
    const sport = sportsOf(hall)[0]?.value || 'tennis';
    const minutes = hall.durations.includes(60) ? 60 : hall.durations[0];
    return freeSlots(hall, hallDay.data.date, hallDay.data.busy, { sport, minutes, now }).filter((s) => s.options.length).length;
  }, [hall, hallDay.data, now]);

  const close = () => setSheet(null);
  const go = (path) => { close(); navigate(path); };
  const goPaid = (fn, title) => { close(); requirePaid(fn, title); };
  const openGame = (g) => goPaid(() => navigate(gamePath(g.id)), 'Avaa peli');
  const openBooking = (b) => go(`/pelaa/omat-varaukset?vuoro=${encodeURIComponent(b.id)}`);

  const stopNow = async () => {
    const prev = { until: profile.playingNowUntil, note: profile.playingNowNote };
    close();
    setProfile((p) => (p ? { ...p, playingNowUntil: null, playingNowNote: null } : p));
    try {
      await api.profile.stopPlayingNow(user.id);
      toast('Pelaan nyt -ilmoitus lopetettu', { tone: 'info' });
    } catch (err) {
      setProfile((p) => (p ? { ...p, playingNowUntil: prev.until, playingNowNote: prev.note } : p));
      toast(err);
    }
  };

  const news = [];
  if (lonely) {
    news.push({
      id: 'kentta', tone: 'strong', icon: 'court',
      eyebrow: 'Puuttuu pelikaveri',
      title: `${lonely.courtName} · ${formatGameTime(lonely.startsAt, new Date(now))}`,
      sub: 'Avaa vuoro muille pelaajille',
      run: () => goPaid(() => openCreateGame(`?varaus=${encodeURIComponent(lonely.id)}`), 'Etsi pelikaveri vuoroosi'),
    });
  }
  const invite = invites.data?.[0];
  if (invite) {
    news.push({
      id: 'kutsu', tone: 'strong', people: [invite.game.creator],
      eyebrow: invites.data.length > 1 ? `${invites.data.length} kutsua peliin` : 'Kutsu peliin',
      title: `${firstName(invite.game.creator?.name)} kutsui sinut peliin`,
      sub: `${gameTitle(invite.game)} · ${whenText(invite.game.scheduledAt, new Date(now))}`,
      run: () => openGame(invite.game),
    });
  }
  if (playingNow.length > 0) {
    const first = playingNow[0];
    news.push({
      id: 'nyt', tone: 'strong', live: true, people: playingNow,
      eyebrow: 'Pelaa nyt',
      title: playingNow.length === 1 ? `${firstName(first.name)} pelaa nyt` : `${firstName(first.name)} ja ${playingNow.length - 1} muuta pelaa nyt`,
      sub: playingNow.length === 1 && first.playingNowNote ? `“${first.playingNowNote}”` : `${cityIn(city)} · laita viesti ja lähde mukaan`,
      run: () => go(playingNow.length === 1 ? `/pelaa/pelaaja/${first.id}` : '/pelaa/pelaajat'),
    });
  }
  if (openWeek.length > 0) {
    const next = openWeek[0];
    news.push({
      id: 'avoimet', tone: 'soft',
      eyebrow: 'Tällä viikolla',
      title: `${plural(openWeek.length, 'avoin peli', 'avointa peliä')} ${cityIn(city, { midSentence: true })}`,
      sub: `Seuraava: ${gameTitle(next)} ${whenText(next.scheduledAt, new Date(now))}`,
      run: () => go('/pelaa/pelit'),
    });
  }
  if (freeThisWeek.length > 0) {
    news.push({
      id: 'viikko', tone: 'soft', people: freeThisWeek,
      eyebrow: 'Vapaana tällä viikolla',
      title: `${plural(freeThisWeek.length, 'pelaaja', 'pelaajaa')} etsii peliä`,
      sub: `${cityIn(city)} · katso kuka sopii tasollesi`,
      run: () => go('/pelaa/pelaajat'),
    });
  }
  const loaded = !open.loading && !invites.loading && !players.loading && !bookings.loading;
  if (news.length === 0 && loaded) {
    news.push({
      id: 'hiljaista', tone: 'soft',
      eyebrow: 'Ajankohtaista',
      title: `${cityIn(city)} on vielä hiljaista`,
      sub: 'Avaa sinä eka peli — muut näkevät sen heti',
      run: () => goPaid(() => openCreateGame(), 'Luo peli ja pelaa'),
    });
  }

  const tiles = [
    { id: 'luo', icon: 'plus', tone: 'dark', primary: true, wide: true, title: 'Luo peli', sub: 'Kaksin- tai nelinpeli, jaa linkki kavereille',
      run: () => goPaid(() => openCreateGame(), 'Luo peli ja pelaa') },
    { id: 'avoimet', icon: 'calendar', tone: 'sky', title: 'Avoimet pelit',
      sub: openWeek.length ? `${plural(openWeek.length, 'peli', 'peliä')} tällä viikolla` : 'Hyppää mukaan valmiiseen peliin',
      run: () => go('/pelaa/pelit') },
    { id: 'pelaajat', icon: 'users', tone: 'green', title: 'Etsi pelikaveri', sub: 'Pelaajat tasosi ja aikojesi mukaan', run: () => go('/pelaa/pelaajat') },
  ];

  const shortcuts = [
    { id: 'nyt', icon: 'bolt', tone: 'clay', label: 'Pelaan nyt', on: active,
      run: active ? stopNow : () => goPaid(() => setSheet('now'), 'Kerro, että pelaat nyt') },
    { id: 'tulos', icon: 'trophy', tone: 'sand', label: 'Kirjaa tulos', run: () => setSheet('result') },
    { id: 'kutsu', icon: 'gift', tone: 'lime', label: 'Kutsu', name: 'Kutsu kaveri', run: () => setSheet('invite') },
    { id: 'liigat', icon: 'medal', tone: 'green', label: 'Liigat', run: () => go('/pelaa/liigat') },
    canCreateEvents && { id: 'tapahtuma', icon: 'sparkles', tone: 'sky', label: 'Tapahtuma',
      run: () => goPaid(() => openCreateGame('?tapahtuma=1'), 'Luo tapahtuma') },
  ].filter(Boolean);

  const partnerSub = invite ? `${firstName(invite.game.creator?.name)} kutsui sinut peliin`
    : [playingNow.length > 0 && `${playingNow.length} pelaa nyt`, openWeek.length > 0 && plural(openWeek.length, 'avoin peli', 'avointa peliä')]
      .filter(Boolean).join(' · ') || 'Luo peli tai liity avoimeen';
  const courtSub = freeToday ? `Tänään ${plural(freeToday, 'vapaa aika', 'vapaata aikaa')} · ${hall?.city}` : hall?.name;
  const partner = <PartnerOptions news={news} loaded={loaded} tiles={tiles} />;

  return (
    <>
      <Sheet open={sheet === 'menu'} onClose={close} title="Pelataanko?" size="md" className="play-sheet">
        <div className="stack-4">
          <Upcoming
            mine={mine}
            bookings={myCourts}
            hall={hall}
            now={now}
            onOpenGame={openGame}
            onOpenBooking={openBooking}
            onAll={() => go('/pelaa/pelit?nakyma=omat')}
          />

          {hall ? (
            <div className="play-doors">
              <Door tone="court" icon="court" title="Varaa kenttä" sub={courtSub} onClick={() => go(`/pelaa/varaa/${encodeURIComponent(hall.slug)}`)} />
              <Door tone="partner" icon="users" title="Etsi peliseuraa" sub={partnerSub} onClick={() => setSheet('partner')} />
            </div>
          ) : partner}

          <div className="play-shortcuts">
            {shortcuts.map((s) => (
              <button key={s.id} type="button" className={cx('play-shortcut', s.on && 'is-on')} aria-label={s.name} aria-pressed={s.id === 'nyt' ? Boolean(s.on) : undefined} onClick={s.run}>
                <span className={cx('play-tile-icon', `is-${s.tone}`)} aria-hidden="true"><Icon name={s.icon} size={20} strokeWidth={2.2} /></span>
                <span className="play-shortcut-label">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'partner'} onClose={close} title="Etsi peliseuraa" size="md" className="play-sheet">
        <div className="stack-4">{partner}</div>
      </Sheet>
      <PlayingNowSheet open={sheet === 'now'} onClose={close} />
      <MatchResultSheet open={sheet === 'result'} onClose={close} onSaved={() => notifyGamesChanged()} />
      <InviteSheet open={sheet === 'invite'} onClose={close} />
    </>
  );
}
