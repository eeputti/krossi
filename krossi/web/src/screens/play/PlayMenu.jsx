// PlayMenu.jsx — "Pelataanko?": the big middle button of the phone tab bar (and the lime button
// in the side nav and on Koti) opens this menu, the way Koutsi's "Merkitse" does. It leads with
// what is going on: my next games ("Tulossa") and what is happening near me ("Ajankohtaista": an
// invite waiting, players who play now, open games this week). Below are the ways to get a game:
// create one, "Pelaan nyt", open games, players, log a result, invite a friend.
// Mounted once by App.jsx; anything opens it with openPlayMenu() (AppShell.jsx).
import { useEffect, useMemo, useState } from 'react';
import { api, isDemo } from '../../api/index.js';
import { openCreateGame, PLAY_MENU_OPEN } from '../../app/AppShell.jsx';
import { useAsync, useNow } from '../../app/hooks.js';
import { usePaywall } from '../../app/paywall.jsx';
import { navigate, useRoute } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { dayLabel, firstName, formatTime, plural } from '../../lib/format.js';
import { AvatarStack, Icon, Sheet, Skeleton, useToast } from '../../ui/index.js';
import { gameTitle, isFull, notifyGamesChanged, placeLine, spotsLabel, whenText } from '../games/gameUtils.js';
import { PlayingNowSheet } from '../home/PlayingNowSheet.jsx';
import { cityIn, isPlayingNow } from '../players/playerInfo.js';
import { InviteSheet } from '../shared/InviteSheet.jsx';
import { MatchResultSheet } from '../shared/MatchResultSheet.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const DAY_MS = 86_400_000;
const MAX_UPCOMING = 6;
const MAX_NEWS = 2;
const norm = (s) => String(s || '').trim().toLocaleLowerCase('fi');
const gamePath = (id) => `/pelaa/peli/${id}`;

function chipState(game, now) {
  const start = game.scheduledAt ? Date.parse(game.scheduledAt) : NaN;
  if (start <= now) return { text: 'Käynnissä', live: true };
  if (game.isMine) return { text: isFull(game) ? 'Täynnä' : spotsLabel(game), live: false };
  return { text: 'Olet mukana', live: false };
}

/** My next games side by side; a tap opens the game. */
function Upcoming({ query, now, onOpen, onAll }) {
  const games = (query.data?.upcoming || []).filter((g) => g.status !== 'cancelled');
  const shown = games.slice(0, MAX_UPCOMING);
  let body;
  if (query.loading && !query.data) {
    body = <div className="play-strip" aria-busy="true">{[0, 1].map((i) => <Skeleton key={i} w={150} h={84} r={14} />)}</div>;
  } else if (query.error && !query.data) {
    body = <p className="play-hint">Pelejäsi ei saatu ladattua. <button type="button" className="play-textlink" onClick={() => query.reload()}>Yritä uudelleen</button></p>;
  } else if (shown.length === 0) {
    body = <p className="play-hint">Ei vielä sovittuja pelejä — luo oma tai liity avoimeen alta.</p>;
  } else {
    body = (
      <div className="play-strip">
        {shown.map((g) => {
          const state = chipState(g, now);
          return (
            <button key={g.id} type="button" className={cx('play-chip', state.live && 'is-live')} onClick={() => onOpen(g)}>
              <span className="play-chip-time t-num">{g.scheduledAt ? `${dayLabel(g.scheduledAt, new Date(now))} ${formatTime(g.scheduledAt)}` : 'Aika sovitaan'}</span>
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
        {games.length > 0 && <button type="button" className="play-textlink" onClick={onAll}>{games.length > shown.length ? `Kaikki (${games.length})` : 'Omat pelit'}</button>}
      </div>
      {body}
    </div>
  );
}

function NewsCard({ news }) {
  return (
    <button type="button" className={cx('play-news', `is-${news.tone}`)} onClick={news.run}>
      {news.people?.length > 0 && <AvatarStack people={news.people} max={3} size={34} />}
      <span className="play-news-main">
        <span className="play-news-eyebrow">{news.live && <span className="play-live" aria-hidden="true" />}{news.eyebrow}</span>
        <span className="play-news-title truncate">{news.title}</span>
        <span className="play-news-sub truncate">{news.sub}</span>
      </span>
      <Icon name="chevron-right" size={20} />
    </button>
  );
}

export function PlayMenu() {
  const { user, profile, setProfile, paid, canCreateEvents, isAdmin } = useSession();
  // Court booking shows in the demo and for admins until the first hall is live.
  const bookingOn = isDemo || isAdmin;
  const { requirePaid } = usePaywall();
  const toast = useToast();
  const route = useRoute();
  const now = useNow(30_000);
  // 'menu' | 'now' (Pelaan nyt) | 'result' (Kirjaa tulos) | 'invite' (Kutsu kaveri) | null
  const [sheet, setSheet] = useState(null);
  const [opened, setOpened] = useState(0);
  const city = profile?.city || '';

  useEffect(() => {
    const onOpen = () => { setOpened((n) => n + 1); setSheet('menu'); };
    window.addEventListener(PLAY_MENU_OPEN, onOpen);
    return () => window.removeEventListener(PLAY_MENU_OPEN, onOpen);
  }, []);
  // A tap that leads to another page leaves the menu behind.
  useEffect(() => { setSheet((s) => (s === 'menu' ? null : s)); }, [route.path]);

  // Fresh data every time the menu opens (the previous answer stays on screen meanwhile).
  const load = opened > 0;
  const mine = useAsync(() => (load ? api.games.listMine() : Promise.resolve(null)), [opened]);
  const open = useAsync(() => (load ? api.games.listOpen() : Promise.resolve(null)), [opened]);
  const invites = useAsync(() => (load ? api.games.listInvites() : Promise.resolve(null)), [opened]);
  const players = useAsync(() => (load && paid && city ? api.players.list({ city }) : Promise.resolve(null)), [opened, paid, city]);

  const areas = useMemo(() => new Set([...(profile?.areas || []), city].filter(Boolean).map(norm)), [profile?.areas, city]);
  const openWeek = useMemo(() => (open.data || [])
    .filter((g) => !g.isMine && !g.iJoined && g.status === 'open' && (areas.size === 0 || areas.has(norm(g.city))))
    .filter((g) => !g.scheduledAt || Date.parse(g.scheduledAt) - now < 7 * DAY_MS), [open.data, areas, now]);
  const playingNow = (players.data || []).filter((p) => isPlayingNow(p, now));
  const freeThisWeek = (players.data || []).filter((p) => p.playingThisWeek && !isPlayingNow(p, now));
  const active = isPlayingNow(profile, now);

  const close = () => setSheet(null);
  const go = (path) => { close(); navigate(path); };
  const goPaid = (fn, title) => { close(); requirePaid(fn, title); };
  const openGame = (g) => goPaid(() => navigate(gamePath(g.id)), 'Avaa peli');

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
  const loaded = !open.loading && !invites.loading && !players.loading;
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
    { id: 'luo', icon: 'plus', tone: 'dark', title: 'Luo peli', sub: 'Kaksin- tai nelinpeli, jaa linkki kavereille',
      run: () => goPaid(() => openCreateGame(), 'Luo peli ja pelaa') },
    active
      ? { id: 'nyt', icon: 'bolt', tone: 'clay', title: 'Lopeta Pelaan nyt', sub: `Päällä klo ${formatTime(profile.playingNowUntil)} asti`, run: stopNow }
      : { id: 'nyt', icon: 'bolt', tone: 'clay', title: 'Pelaan nyt', sub: 'Kerro, että lähtisit pelaamaan heti',
        run: () => goPaid(() => setSheet('now'), 'Kerro, että pelaat nyt') },
    { id: 'avoimet', icon: 'calendar', tone: 'sky', title: 'Avoimet pelit',
      sub: openWeek.length ? `${plural(openWeek.length, 'peli', 'peliä')} tällä viikolla` : 'Hyppää mukaan valmiiseen peliin',
      run: () => go('/pelaa/pelit') },
    { id: 'pelaajat', icon: 'users', tone: 'green', title: 'Etsi pelikaveri', sub: 'Pelaajat tasosi ja aikojesi mukaan', run: () => go('/pelaa/pelaajat') },
    { id: 'tulos', icon: 'trophy', tone: 'sand', title: 'Kirjaa tulos', sub: 'Putki ja merkit pysyvät ajan tasalla', run: () => setSheet('result') },
    { id: 'kutsu', icon: 'gift', tone: 'lime', title: 'Kutsu kaveri', sub: 'Pelatkaa yhdessä, saat Kutsuja-merkin', run: () => setSheet('invite') },
    bookingOn && { id: 'varaa', icon: 'court', tone: 'dark', wide: true, title: 'Varaa kenttä', sub: 'Vapaat vuorot halleissa — valitse kenttä kartalta ja maksa heti', run: () => go('/pelaa/varaa') },
  ].filter(Boolean);

  return (
    <>
      <Sheet open={sheet === 'menu'} onClose={close} title="Pelataanko?" size="md" className="play-sheet">
        <div className="stack-4">
          <Upcoming query={mine} now={now} onOpen={openGame} onAll={() => go('/pelaa/pelit?nakyma=omat')} />

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
              <button key={t.id} type="button" className={cx('play-tile', t.id === 'luo' && 'is-primary', t.wide && 'is-wide')} onClick={t.run}>
                <span className={cx('play-tile-icon', `is-${t.tone}`)}><Icon name={t.icon} size={22} strokeWidth={t.id === 'luo' ? 2.6 : 2} /></span>
                <span className="play-tile-title">{t.title}</span>
                <span className="play-tile-sub">{t.sub}</span>
              </button>
            ))}
          </div>

          <div className="play-links">
            <button type="button" className="play-link" onClick={() => go('/pelaa/liigat')}><Icon name="trophy" size={16} />Liigat</button>
            {canCreateEvents && (
              <button type="button" className="play-link" onClick={() => goPaid(() => openCreateGame('?tapahtuma=1'), 'Luo tapahtuma')}>
                <Icon name="sparkles" size={16} />Uusi tapahtuma
              </button>
            )}
          </div>
        </div>
      </Sheet>

      <PlayingNowSheet open={sheet === 'now'} onClose={close} />
      <MatchResultSheet open={sheet === 'result'} onClose={close} onSaved={() => notifyGamesChanged()} />
      <InviteSheet open={sheet === 'invite'} onClose={close} />
    </>
  );
}
