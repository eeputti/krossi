// HomeScreen — Koti (/pelaa/koti), the first thing a player sees.
//
//   hero         greeting, city context, "Pelaan tällä viikolla", ⚡ Pelaan nyt, big "Pelataanko?"
//   unlock       (unpaid) striking unlock card instead of the gated sections
//   attention    pending game invites (Liity / Ei kiitos) and play requests
//   next game    listMine().upcoming[0] as the shared hero GameCard, or a friendly empty card
//   progress     streak, games this month, win streak, latest badge + next goal
//   open games   horizontal scroller of open games in my city
//   players      who plays now / this week (paid)
//   recap + invite
// Phones: one column. ≥1200 px: main column + right rail (progress, recap, invite).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { openCreateGame } from '../../app/AppShell.jsx';
import { useAsync, useMediaQuery, useNow } from '../../app/hooks.js';
import { usePaywall } from '../../app/paywall.jsx';
import { Link, navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { playDates } from '../../features/gamification.js';
import { PRICE_LABEL } from '../../lib/constants.js';
import { MONTHS, WEEKDAYS, capitalize, firstName, formatGameTime, formatTime, greeting, plural } from '../../lib/format.js';
import {
  Avatar, AvatarStack, BadgeMedal, Button, Card, CountUp, EmptyState, ErrorState, Icon, Illustration,
  Page, ProgressBar, Section, Skeleton, Toggle, confetti, useToast,
} from '../../ui/index.js';
import { GAMES_CHANGED, gameTitle, notifyGamesChanged, placeLine } from '../games/gameUtils.js';
import { cityIn, isPlayingNow, timeLeft } from '../players/playerInfo.js';
import { GameCard } from '../shared/GameCard.jsx';
import { InviteSheet } from '../shared/InviteSheet.jsx';
import { PlayerCard } from '../shared/PlayerCard.jsx';
import { RecapTeaser } from '../shared/RecapTeaser.jsx';
import { StreakBadge } from '../shared/StreakBadge.jsx';
import { useActivity } from '../shared/useActivity.js';
import { PlayingNowSheet } from './PlayingNowSheet.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const DAY_MS = 86_400_000;
const MAX_SCROLLER = 10;

const norm = (s) => String(s || '').trim().toLocaleLowerCase('fi');
const openPath = (id) => `/pelaa/peli/${id}`;

// ── hero ─────────────────────────────────────────────────────────────────────


function contextLine({ city, loading, count }) {
  if (loading) return `Katsotaan, mitä ${cityIn(city, { midSentence: true })} pelataan…`;
  if (count > 0) return `${cityIn(city)} ${plural(count, 'avoin peli', 'avointa peliä')} tällä viikolla`;
  return `${cityIn(city)} ei vielä avoimia pelejä — avaa sinä eka!`;
}

function HomeHero({ openThisWeek, openLoading }) {
  const { user, profile, setProfile } = useSession();
  const { requirePaid } = usePaywall();
  const toast = useToast();
  const now = useNow(30_000);
  const [sheet, setSheet] = useState(false);
  const [stopping, setStopping] = useState(false);
  const city = profile?.city || '';
  const active = isPlayingNow(profile, now);
  const today = new Date(now);
  const dateLabel = `${capitalize(WEEKDAYS[today.getDay()])} ${today.getDate()}.${today.getMonth() + 1}.`;

  const toggleWeek = async (value) => {
    setProfile((p) => (p ? { ...p, playingThisWeek: value } : p));
    try {
      await api.profile.setPlayingThisWeek(user.id, value);
      if (value) toast('Muut näkevät nyt, että pelaat tällä viikolla', { icon: 'sparkles' });
    } catch (err) {
      setProfile((p) => (p ? { ...p, playingThisWeek: !value } : p));
      toast(err);
    }
  };

  const stopNow = async () => {
    const prev = { until: profile.playingNowUntil, note: profile.playingNowNote };
    setStopping(true);
    setProfile((p) => (p ? { ...p, playingNowUntil: null, playingNowNote: null } : p));
    try {
      await api.profile.stopPlayingNow(user.id);
      toast('Pelaan nyt -ilmoitus lopetettu', { tone: 'info' });
    } catch (err) {
      setProfile((p) => (p ? { ...p, playingNowUntil: prev.until, playingNowNote: prev.note } : p));
      toast(err);
    } finally {
      setStopping(false);
    }
  };

  return (
    <section className="home-hero on-dark court-lines" aria-labelledby="home-hero-title">
      
      <div className="home-hero-top">
        <span className="eyebrow">{dateLabel}{city ? ` · ${city}` : ''}</span>
        <Link to="/pelaa/profiili" className="home-hero-me hide-desktop" aria-label="Oma profiili">
          <Avatar person={profile} size={38} ring status={active ? 'now' : profile?.playingThisWeek ? 'week' : null} />
        </Link>
      </div>

      <div className="home-hero-grid">
        <div className="home-hero-text">
          <h1 id="home-hero-title" className="home-hero-title">{greeting(today)}, {firstName(profile?.name)}!</h1>
          <p className="home-hero-context">
            <span className={cx('home-hero-dot', !openLoading && openThisWeek > 0 && 'is-live')} aria-hidden="true" />
            <span>{contextLine({ city, loading: openLoading, count: openThisWeek })}</span>
          </p>
        </div>

        <div className={cx('home-hero-actions', active && 'is-single')}>
          <Button variant="lime" size="lg" icon="plus" className="home-hero-cta" onClick={() => requirePaid(() => openCreateGame(), 'Luo peli ja pelaa')}>
            Pelataanko?
          </Button>
          {!active && (
            <Button variant="on-dark" size="lg" icon="bolt" className="home-hero-now-btn" onClick={() => requirePaid(() => setSheet(true), 'Kerro, että pelaat nyt')}>
              Pelaan nyt
            </Button>
          )}
        </div>
      </div>

      <div className="home-hero-panel">
        {active && (
          <div className="home-now rise">
            <span className="home-now-icon"><Icon name="bolt" size={18} strokeWidth={2.4} /></span>
            <span className="home-now-text">
              <span className="home-now-title">Pelaat nyt klo <span className="t-num">{formatTime(profile.playingNowUntil)}</span> asti</span>
              <span className="home-now-sub truncate">{profile.playingNowNote ? `“${profile.playingNowNote}”` : capitalize(timeLeft(profile.playingNowUntil, now))}</span>
            </span>
            <Button variant="on-dark" size="sm" loading={stopping} onClick={stopNow}>Lopeta</Button>
          </div>
        )}
        <Toggle
          tone="on-dark"
          icon="calendar"
          label="Pelaan tällä viikolla"
          hint="Muut näkevät, että olet vapaana"
          checked={Boolean(profile?.playingThisWeek)}
          onChange={toggleWeek}
          className="home-hero-toggle"
        />
      </div>

      <PlayingNowSheet open={sheet} onClose={() => setSheet(false)} />
    </section>
  );
}

// ── unpaid ───────────────────────────────────────────────────────────────────

const UNLOCK_PERKS = ['Näe pelaajat ja heidän tasonsa', 'Liity peleihin ja luo omia', 'Viestit, liigat, putket ja merkit'];

function UnlockCard({ city, openCount }) {
  const { openPaywall } = usePaywall();
  return (
    <Card tone="lime" padding="none" className="home-unlock rise">
      <div className="home-unlock-body">
        <span className="home-unlock-eyebrow">Kertamaksu · ei tilausta</span>
        <h2 className="home-unlock-title">Avaa koko Krossi</h2>
        <p className="home-unlock-text">
          {openCount > 0
            ? `${cityIn(city)} ${plural(openCount, 'avoin peli odottaa', 'avointa peliä odottaa')} pelaajia. Hyppää mukaan jo tänään.`
            : 'Pelaajat, pelit ja viestit auki yhdellä maksulla.'}
        </p>
        <ul className="home-unlock-perks">
          {UNLOCK_PERKS.map((p) => (
            <li key={p}><span className="home-unlock-check"><Icon name="check" size={13} strokeWidth={3} /></span>{p}</li>
          ))}
        </ul>
        <Button variant="dark" size="lg" icon="bolt" className="home-unlock-btn" onClick={() => openPaywall()}>
          Avaa Krossi — {PRICE_LABEL}
        </Button>
      </div>
      <Illustration name="lock" size={128} className="home-unlock-art" />
    </Card>
  );
}

// ── attention: invites + play requests ──────────────────────────────────────

function GameInviteCard({ invite, onDone, style }) {
  const { requirePaid } = usePaywall();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const game = invite.game;

  const respond = async (accept) => {
    setBusy(accept ? 'yes' : 'no');
    try {
      const conversationId = await api.games.respondInvite(invite.id, accept);
      notifyGamesChanged();
      onDone(invite.id);
      if (accept) {
        confetti();
        toast('Olet mukana! Sovi loput chatissa 🎾', { icon: 'sparkles' });
        navigate(conversationId ? `/pelaa/viestit/${conversationId}` : openPath(game.id));
      } else {
        toast('Kutsu ohitettu', { tone: 'info' });
      }
    } catch (err) {
      toast(err);
      setBusy(null);
    }
  };

  return (
    <Card padding="none" className="home-invite" style={style}>
      <button type="button" className="home-invite-main" onClick={() => requirePaid(() => navigate(openPath(game.id)), 'Avaa peli')}>
        <span className="home-invite-avatar">
          <Avatar person={game.creator} size={46} />
          <span className="home-invite-badge" aria-hidden="true"><Icon name="mail" size={12} strokeWidth={2.4} /></span>
        </span>
        <span className="home-invite-text">
          <span className="home-invite-title"><strong>{firstName(game.creator?.name)}</strong> kutsui sinut peliin</span>
          <span className="home-invite-meta truncate">{gameTitle(game)} · {formatGameTime(game.scheduledAt)}</span>
          <span className="home-invite-place truncate"><Icon name="pin" size={13} />{placeLine(game)}</span>
        </span>
      </button>
      <div className="home-invite-actions">
        <Button variant="soft" size="md" loading={busy === 'no'} disabled={Boolean(busy)} onClick={() => respond(false)}>Ei kiitos</Button>
        <Button variant="lime" size="md" icon="check" loading={busy === 'yes'} disabled={Boolean(busy)} onClick={() => requirePaid(() => respond(true), 'Liity peliin')}>
          Liity
        </Button>
      </div>
    </Card>
  );
}

function RequestsCard({ requests, style }) {
  const first = requests[0];
  const title = requests.length === 1
    ? `${firstName(first.from?.name)} pyytää pelaamaan`
    : `${requests.length} pelipyyntöä odottaa`;
  return (
    <Card padding="none" onClick={() => navigate('/pelaa/viestit')} className="home-requests" style={style}>
      <AvatarStack people={requests.map((r) => r.from)} max={3} size={38} />
      <span className="home-requests-text">
        <span className="home-requests-title">{title}</span>
        <span className="home-requests-msg truncate">“{first.message}”</span>
      </span>
      <span className="home-requests-go" aria-hidden="true"><Icon name="chevron-right" size={18} /></span>
    </Card>
  );
}

function InlineError({ text, onRetry }) {
  return (
    <div className="home-inline-error" role="alert">
      <Icon name="alert" size={16} />
      <span className="grow">{text}</span>
      <button type="button" className="home-inline-retry" onClick={() => onRetry()}>Yritä uudelleen</button>
    </div>
  );
}

function AttentionSection({ invites, requests }) {
  const inviteList = invites.data || [];
  const requestList = requests.data || [];
  const count = inviteList.length + (requestList.length ? 1 : 0);
  const failed = invites.error || requests.error;
  if (!count && !failed) return null;
  return (
    <Section title="Odottaa vastaustasi" className="home-attention">
      <div className="home-stack stagger">
        {inviteList.map((inv, i) => (
          <GameInviteCard key={inv.id} invite={inv} style={{ '--i': i }} onDone={(id) => invites.setData((list) => (list || []).filter((x) => x.id !== id))} />
        ))}
        {requestList.length > 0 && <RequestsCard requests={requestList} style={{ '--i': inviteList.length }} />}
        {invites.error && <InlineError text="Pelikutsuja ei saatu ladattua." onRetry={invites.reload} />}
        {requests.error && <InlineError text="Pelipyyntöjä ei saatu ladattua." onRetry={requests.reload} />}
      </div>
    </Section>
  );
}

// ── next game ────────────────────────────────────────────────────────────────

function NextGameSection({ mine }) {
  const { requirePaid } = usePaywall();
  const upcoming = mine.data?.upcoming || [];
  const next = upcoming[0];
  const action = upcoming.length > 1
    ? { label: `Kaikki omat (${upcoming.length})`, onClick: () => navigate('/pelaa/pelit?nakyma=omat') }
    : undefined;
  let body;
  if (mine.loading) body = <Skeleton h={200} r={24} className="home-skel-hero" />;
  else if (mine.error) body = <Card><ErrorState compact error={mine.error} onRetry={mine.reload} title="Pelejäsi ei saatu ladattua" /></Card>;
  else if (next) body = <div className="home-next rise"><GameCard game={next} variant="hero" onClick={() => navigate(openPath(next.id))} /></div>;
  else {
    body = (
      <Card padding="none" className="home-empty-next rise">
        <Illustration name="calendar" size={104} className="home-empty-next-art" />
        <div className="home-empty-next-text">
          <h3 className="home-empty-next-title">Ei vielä sovittua peliä</h3>
          <p className="home-empty-next-sub">Luo oma peli tai hyppää mukaan avoimeen — kenttä odottaa.</p>
        </div>
        <div className="home-empty-next-actions">
          <Button variant="dark" size="md" icon="plus" onClick={() => requirePaid(() => openCreateGame(), 'Luo peli')}>Luo peli</Button>
          <Button variant="outline" size="md" onClick={() => navigate('/pelaa/pelit')}>Selaa avoimia</Button>
        </div>
      </Card>
    );
  }
  return <Section title="Seuraava pelisi" action={action}>{body}</Section>;
}

// ── progress ─────────────────────────────────────────────────────────────────

function ProgressSection({ act }) {
  const toBadges = () => navigate('/pelaa/merkit');
  const action = { label: 'Merkit', onClick: toBadges };
  if (act.loading) {
    return (
      <Section title="Sinun kautesi" action={action}>
        <Card padding="none" className="home-progress" aria-busy="true">
          <div className="home-progress-streak"><Skeleton h={84} r={18} /></div>
          <div className="home-progress-stats">
            {[0, 1].map((i) => <div key={i} className="home-stat"><Skeleton w={52} h={26} /><Skeleton w={90} h={11} /></div>)}
          </div>
          <div className="home-goal"><Skeleton w={52} h={52} r={999} /><div className="grow stack-2"><Skeleton w="50%" h={14} /><Skeleton w="80%" h={10} /></div></div>
        </Card>
      </Section>
    );
  }
  if (act.error || !act.activity) {
    return (
      <Section title="Sinun kautesi" action={action}>
        <Card><ErrorState compact error={act.error} onRetry={() => act.reload()} title="Tilastoja ei saatu ladattua" /></Card>
      </Section>
    );
  }

  const now = new Date();
  const monthGames = playDates(act.activity).filter((o) => {
    const d = new Date(o.at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  const winRun = act.wins?.current || 0;
  const latest = (act.badges || []).find((b) => b.earned);
  const goal = (act.goals || [])[0];

  return (
    <Section title="Sinun kautesi" action={action}>
      <Card padding="none" className="home-progress">
        <div className="home-progress-streak">
          <StreakBadge streak={act.streak} size="lg" />
        </div>
        <div className="home-progress-stats">
          <div className="home-stat">
            <CountUp value={monthGames} className="home-stat-value" />
            <span className="home-stat-label">{monthGames === 1 ? 'peli' : 'peliä'} {MONTHS[now.getMonth()]}ssa</span>
          </div>
          <div className="home-stat">
            <span className="home-stat-value-row">
              <CountUp value={winRun} className="home-stat-value" />
              {winRun >= 2 && <Icon name="flame" size={18} className="home-stat-hot" />}
            </span>
            <span className="home-stat-label">{winRun === 1 ? 'voitto' : 'voittoa'} putkeen</span>
          </div>
        </div>

        {goal && (
          <button type="button" className="home-goal" onClick={toBadges}>
            <BadgeMedal badge={goal} size={54} />
            <span className="home-goal-text">
              <span className="home-goal-eyebrow">Seuraava merkki</span>
              <span className="home-goal-name">{goal.name}</span>
              <span className="home-goal-desc">{goal.desc}</span>
              <span className="home-goal-bar">
                <ProgressBar value={goal.progress} tone="green" label={`${goal.name}: ${goal.current}/${goal.target}`} />
                <span className="home-goal-count t-num">{goal.current}/{goal.target}</span>
              </span>
            </span>
          </button>
        )}

        <button type="button" className="home-latest" onClick={toBadges}>
          {latest ? (
            <>
              <BadgeMedal badge={latest} size={34} />
              <span className="home-latest-text">Uusin merkki: <strong>{latest.name}</strong></span>
            </>
          ) : (
            <>
              <span className="home-latest-icon"><Icon name="award" size={18} /></span>
              <span className="home-latest-text">Ensimmäinen merkki odottaa — pelaa peli ja kirjaa se</span>
            </>
          )}
          <Icon name="chevron-right" size={18} className="home-latest-chevron" />
        </button>
      </Card>
    </Section>
  );
}

// ── open games ───────────────────────────────────────────────────────────────

function ScrollerSkeleton({ kind }) {
  return (
    <div className="home-scroller" aria-busy="true" aria-label="Ladataan">
      {[0, 1, 2].map((i) => <Skeleton key={i} w={kind === 'player' ? 136 : 244} h={kind === 'player' ? 172 : 148} r={18} className="home-scroller-skel" />)}
    </div>
  );
}

function OpenGamesSection({ open, games, city }) {
  const { requirePaid } = usePaywall();
  const toAll = () => navigate('/pelaa/pelit');
  let body;
  if (open.loading) body = <ScrollerSkeleton kind="game" />;
  else if (open.error) body = <Card><ErrorState compact error={open.error} onRetry={open.reload} title="Avoimia pelejä ei saatu ladattua" /></Card>;
  else if (games.length === 0) {
    body = (
      <Card padding="none" className="home-empty-card">
        <EmptyState
          compact
          art="court"
          title={`${cityIn(city)} ei vielä avoimia pelejä`}
          text="Ole ensimmäinen — luo peli ja jaa linkki."
          action={<Button variant="dark" icon="plus" onClick={() => requirePaid(() => openCreateGame(), 'Luo peli')}>Luo peli</Button>}
        />
      </Card>
    );
  } else {
    body = (
      <div className="home-scroller stagger">
        {games.slice(0, MAX_SCROLLER).map((g, i) => (
          <div key={g.id} className="home-scroller-item" style={{ '--i': i }}>
            <GameCard game={g} variant="compact" onClick={() => requirePaid(() => navigate(openPath(g.id)), 'Avaa peli')} />
          </div>
        ))}
        <button type="button" className="home-more-tile" style={{ '--i': Math.min(games.length, MAX_SCROLLER) }} onClick={toAll}>
          <span className="home-more-icon"><Icon name="arrow-right" size={20} /></span>
          <span className="home-more-label">Näytä kaikki</span>
          <span className="home-more-sub">{plural(games.length, 'avoin peli', 'avointa peliä')}</span>
        </button>
      </div>
    );
  }
  return (
    <Section title="Avoimet pelit lähellä" action={{ label: 'Näytä kaikki', onClick: toAll }}>
      {body}
    </Section>
  );
}

// ── players playing now / this week ─────────────────────────────────────────

function PlayersSection({ players, list, nowCount }) {
  const toAll = () => navigate('/pelaa/pelaajat');
  let body;
  if (players.loading) body = <ScrollerSkeleton kind="player" />;
  else if (players.error) body = <Card><ErrorState compact error={players.error} onRetry={players.reload} title="Pelaajia ei saatu ladattua" /></Card>;
  else if (list.length === 0) {
    body = (
      <Card padding="none" className="home-empty-card">
        <EmptyState
          compact
          art="players"
          title="Hiljaista vielä"
          text="Laita Pelaan tällä viikolla -kytkin päälle, niin muut löytävät sinut."
          action={<Button variant="outline" icon="users" onClick={toAll}>Selaa pelaajia</Button>}
        />
      </Card>
    );
  } else {
    body = (
      <div className="home-scroller stagger">
        {list.map((p, i) => (
          <PlayerCard key={p.id} player={p} variant="compact" style={{ '--i': i }} onClick={() => navigate(`/pelaa/pelaaja/${p.id}`)} />
        ))}
      </div>
    );
  }
  return (
    <Section
      eyebrow={nowCount > 0 ? `⚡ ${nowCount} pelaa nyt` : undefined}
      title="Pelaavat tällä viikolla"
      action={{ label: 'Kaikki', onClick: toAll }}
      className="home-players"
    >
      {body}
    </Section>
  );
}

// ── invite a friend ──────────────────────────────────────────────────────────

function InviteFriendCard({ onOpen }) {
  return (
    <Card padding="none" className="home-friend">
      <div className="home-friend-inner">
        <span className="home-friend-art" aria-hidden="true"><Icon name="gift" size={26} strokeWidth={2.2} /></span>
        <span className="home-friend-text">
          <span className="home-friend-title">Kutsu kaveri Krossiin</span>
          <span className="home-friend-sub">Pelaatte yhdessä ja saat Kutsuja-merkin.</span>
        </span>
        <Button variant="dark" size="md" icon="share" className="home-friend-btn" onClick={onOpen}>Kutsu kaveri</Button>
      </div>
    </Card>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export function HomeScreen() {
  const { profile, paid } = useSession();
  const wide = useMediaQuery('(min-width: 1200px)');
  const [inviteOpen, setInviteOpen] = useState(false);
  const now = useNow(60_000);
  const city = profile?.city || '';
  const areas = useMemo(() => {
    const list = [...(profile?.areas || []), profile?.city].filter(Boolean).map(norm);
    return new Set(list);
  }, [profile?.areas, profile?.city]);

  const open = useAsync(() => api.games.listOpen(), []);
  const mine = useAsync(() => api.games.listMine(), []);
  const invites = useAsync(() => api.games.listInvites(), []);
  const requests = useAsync(() => api.messages.listRequests(), []);
  const players = useAsync(() => (paid && city ? api.players.list({ city }) : Promise.resolve([])), [paid, city]);
  const act = useActivity();

  // Refresh what an overlay (create game, invite reply, outcome check) may have changed.
  const { reload: reloadOpen } = open;
  const { reload: reloadMine } = mine;
  const { reload: reloadInvites } = invites;
  const { reload: reloadAct } = act;
  const refresh = useCallback(() => {
    reloadOpen({ silent: true });
    reloadMine({ silent: true });
    reloadInvites({ silent: true });
    reloadAct({ silent: true });
  }, [reloadOpen, reloadMine, reloadInvites, reloadAct]);
  useEffect(() => {
    window.addEventListener(GAMES_CHANGED, refresh);
    return () => window.removeEventListener(GAMES_CHANGED, refresh);
  }, [refresh]);

  const nearby = useMemo(() => (open.data || []).filter((g) => (
    !g.isMine && !g.iJoined && g.status === 'open' && (areas.size === 0 || areas.has(norm(g.city)))
  )), [open.data, areas]);
  const openThisWeek = nearby.filter((g) => !g.scheduledAt || Date.parse(g.scheduledAt) - now < 7 * DAY_MS).length;

  const activePlayers = useMemo(() => {
    const list = (players.data || []).filter((p) => isPlayingNow(p, now) || p.playingThisWeek);
    return list.sort((a, b) => Number(isPlayingNow(b, now)) - Number(isPlayingNow(a, now))).slice(0, 12);
  }, [players.data, now]);
  const nowCount = activePlayers.filter((p) => isPlayingNow(p, now)).length;

  const hasUpcoming = (mine.data?.upcoming || []).length > 0;
  const showOpen = paid || (!open.error && !open.loading && nearby.length > 0);

  const progress = <ProgressSection act={act} />;
  const recap = act.recaps?.length ? <div className="home-slot"><RecapTeaser recaps={act.recaps} /></div> : null;
  const invite = <InviteFriendCard onOpen={() => setInviteOpen(true)} />;

  return (
    <Page width="wide" className="home">
      <div className="home-layout">
        <HomeHero openThisWeek={openThisWeek} openLoading={open.loading} />

        <div className="home-main">
          {!paid && <UnlockCard city={city} openCount={nearby.length} />}
          <AttentionSection invites={invites} requests={requests} />
          {(paid || hasUpcoming) && <NextGameSection mine={mine} />}
          {!wide && progress}
          {showOpen && <OpenGamesSection open={open} games={nearby} city={city} />}
          {paid && <PlayersSection players={players} list={activePlayers} nowCount={nowCount} />}
          {!wide && recap}
          {!wide && invite}
        </div>

        {wide && (
          <aside className="home-rail" aria-label="Edistyminen">
            {progress}
            {recap}
            {invite}
          </aside>
        )}
      </div>
      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </Page>
  );
}
