// HomeScreen — Omat (/pelaa/koti), the first tab: what is mine and what waits on me.
//
//   head        greeting, the next thing in one line, bell (Ilmoitukset), avatar (Profiili on phones)
//   attention   pending game invites (Liity / Ei kiitos), play requests and "Pelasitteko?" about past
//               games — a card here instead of a sheet popping up over the screen
//   tulevat     my games and my courts no game is played on, soonest first (gamesAndCourts), or the
//               two doors (Varaa kenttä / Etsi peliseuraa) when there is nothing yet
//   menneet     my latest past games with their outcome, the rest behind "Näytä kaikki"
// Finding somebody to play with is the Peliseura tab, booking the Varaa tab, progress (putket, merkit,
// koosteet), leagues and inviting a friend are in Profiili — Omat only shows what is mine.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync, useNow } from '../../app/hooks.js';
import { usePaywall } from '../../app/paywall.jsx';
import { Link, navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { gamesAndCourts } from '../../features/booking.js';
import { WEEKDAYS, capitalize, dayDiff, firstName, formatGameTime, greeting } from '../../lib/format.js';
import {
  Avatar, AvatarStack, Button, Card, Chip, ErrorState, Icon, Illustration, Page, Section, Skeleton, confetti, useToast,
} from '../../ui/index.js';
import { useBookingHall } from '../booking/useBookingHall.js';
import { GAMES_CHANGED, gameTitle, notifyGamesChanged, placeLine } from '../games/gameUtils.js';
import { isPlayingNow } from '../players/playerInfo.js';
import { CourtCard } from '../shared/CourtCard.jsx';
import { GameCard, GameDateTile } from '../shared/GameCard.jsx';
import { NotificationsButton, useNotificationFeed } from './Notifications.jsx';
import { askOutcome } from './PendingOutcomeCheck.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const PAST_PREVIEW = 3;
const openPath = (id) => `/pelaa/peli/${id}`;

// ── head ─────────────────────────────────────────────────────────────────────

function nextLine(next, loading) {
  if (loading) return 'Katsotaan, mitä sinulla on tulossa…';
  if (!next) return 'Ei sovittuja pelejä tällä hetkellä.';
  if (next.kind === 'court') return `Seuraavaksi ${next.booking.courtName} · ${formatGameTime(next.booking.startsAt)}`;
  return `Seuraavaksi ${gameTitle(next.game)} · ${formatGameTime(next.game.scheduledAt)}`;
}

function HomeHead({ next, loading, feed }) {
  const { profile } = useSession();
  const now = useNow(30_000);
  const city = profile?.city || '';
  const today = new Date(now);
  const dateLabel = `${capitalize(WEEKDAYS[today.getDay()])} ${today.getDate()}.${today.getMonth() + 1}.`;
  const at = next ? (next.kind === 'court' ? next.booking.startsAt : next.game.scheduledAt) : null;
  const soon = Boolean(at) && dayDiff(at, today) === 0;
  return (
    <section className="home-hero on-dark" aria-labelledby="home-hero-title">
      <div className="home-hero-top">
        <span className="eyebrow">{dateLabel}{city ? ` · ${city}` : ''}</span>
        <span className="home-hero-tools">
          <NotificationsButton feed={feed} />
          <Link to="/pelaa/profiili" className="home-hero-me hide-desktop" aria-label="Oma profiili">
            <Avatar person={profile} size={38} ring status={isPlayingNow(profile, now) ? 'now' : profile?.playingThisWeek ? 'week' : null} />
          </Link>
        </span>
      </div>
      <h1 id="home-hero-title" className="home-hero-title">{greeting(today)}, {firstName(profile?.name)}!</h1>
      <p className="home-hero-context">
        <span className={cx('home-hero-dot', soon && 'is-live')} aria-hidden="true" />
        <span>{nextLine(next, loading)}</span>
      </p>
    </section>
  );
}

// ── attention: invites, play requests, "Pelasitteko?" ───────────────────────

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

function RowCard({ people, title, sub, onClick, style }) {
  return (
    <Card padding="none" onClick={onClick} className="home-requests" style={style}>
      <AvatarStack people={people} max={3} size={38} />
      <span className="home-requests-text">
        <span className="home-requests-title">{title}</span>
        <span className="home-requests-msg truncate">{sub}</span>
      </span>
      <span className="home-requests-go" aria-hidden="true"><Icon name="chevron-right" size={18} /></span>
    </Card>
  );
}

function RequestsCard({ requests, style }) {
  const first = requests[0];
  const title = requests.length === 1
    ? `${firstName(first.from?.name)} pyytää pelaamaan`
    : `${requests.length} pelipyyntöä odottaa`;
  return <RowCard people={requests.map((r) => r.from)} title={title} sub={`“${first.message}”`} onClick={() => navigate('/pelaa/viestit')} style={style} />;
}

// A past game whose outcome is still open: tapping it asks "Pelasitteko?" (PendingOutcomeCheck).
function OutcomeCard({ game, uid, style }) {
  const others = [game.creator, ...(game.participants || [])].filter((p) => p && p.id !== uid);
  const who = others.length ? ` · ${others.map((p) => firstName(p.name)).join(', ')}` : '';
  return (
    <RowCard
      people={others}
      title="Pelasitteko?"
      sub={`${gameTitle(game)}${who} · ${formatGameTime(game.scheduledAt)}`}
      onClick={() => askOutcome(game)}
      style={style}
    />
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

function AttentionSection({ invites, requests, outcomes }) {
  const { user } = useSession();
  const inviteList = invites.data || [];
  const requestList = requests.data || [];
  const outcomeList = outcomes.data || [];
  const count = inviteList.length + (requestList.length ? 1 : 0) + outcomeList.length;
  const failed = invites.error || requests.error;
  if (!count && !failed) return null;
  let i = 0;
  return (
    <Section title="Odottaa vastaustasi" className="home-attention">
      <div className="home-stack stagger">
        {inviteList.map((inv) => (
          <GameInviteCard key={inv.id} invite={inv} style={{ '--i': i++ }} onDone={(id) => invites.setData((list) => (list || []).filter((x) => x.id !== id))} />
        ))}
        {requestList.length > 0 && <RequestsCard requests={requestList} style={{ '--i': i++ }} />}
        {outcomeList.map((g) => <OutcomeCard key={g.id} game={g} uid={user?.id} style={{ '--i': i++ }} />)}
        {invites.error && <InlineError text="Pelikutsuja ei saatu ladattua." onRetry={invites.reload} />}
        {requests.error && <InlineError text="Pelipyyntöjä ei saatu ladattua." onRetry={requests.reload} />}
      </div>
    </Section>
  );
}

// ── tulevat ──────────────────────────────────────────────────────────────────

// Nothing coming up: the app's two doors.
function EmptyPlan() {
  return (
    <Card padding="none" className="home-empty-next rise">
      <Illustration name="calendar" size={104} className="home-empty-next-art" />
      <div className="home-empty-next-text">
        <h3 className="home-empty-next-title">Ei vielä sovittua peliä</h3>
        <p className="home-empty-next-sub">Varaa kenttä, jos sinulla on jo kaveri — tai etsi peliseuraa.</p>
      </div>
      <div className="home-empty-next-actions">
        <Button variant="dark" size="md" icon="court" onClick={() => navigate('/pelaa/varaa')}>Varaa kenttä</Button>
        <Button variant="outline" size="md" icon="users" onClick={() => navigate('/pelaa/pelaajat')}>Etsi peliseuraa</Button>
      </div>
    </Card>
  );
}

function PlanSection({ mine, bookings, plan, loading }) {
  let body;
  if (loading) body = <div className="home-stack"><Skeleton h={112} r={20} /><Skeleton h={112} r={20} /></div>;
  else if (mine.error) body = <Card><ErrorState compact error={mine.error} onRetry={mine.reload} title="Pelejäsi ei saatu ladattua" /></Card>;
  else if (plan.length === 0) body = <EmptyPlan />;
  else {
    body = (
      <div className="home-stack stagger">
        {plan.map((item, i) => (
          <div key={`${item.kind}-${item.id}`} style={{ '--i': i }}>
            {item.kind === 'court'
              ? <CourtCard booking={item.booking} empty={item.empty} />
              : <GameCard game={item.game} onClick={() => navigate(openPath(item.game.id))} />}
          </div>
        ))}
      </div>
    );
  }
  return (
    <Section title="Tulevat" eyebrow={!loading && plan.length > 1 ? `${plan.length} tulossa` : undefined}>
      {body}
      {!loading && bookings.error && <InlineError text="Kenttävarauksiasi ei saatu ladattua." onRetry={bookings.reload} />}
    </Section>
  );
}

// ── menneet ──────────────────────────────────────────────────────────────────

function outcomeChip(game) {
  if (game.status === 'cancelled') return <Chip tone="danger" size="sm">Peruttu</Chip>;
  if (game.outcome === 'played') return <Chip tone="success" size="sm" icon="check">Pelattu</Chip>;
  if (game.outcome === 'not_played') return <Chip tone="neutral" size="sm">Ei pelattu</Chip>;
  return <Chip tone="warn" size="sm">Pelasitteko?</Chip>;
}

function PastSection({ past }) {
  const [showAll, setShowAll] = useState(false);
  if (!past.length) return null;
  const shown = showAll ? past : past.slice(0, PAST_PREVIEW);
  return (
    <Section title="Menneet">
      <div className="games-past stagger">
        {shown.map((g, i) => (
          <button key={g.id} type="button" className="games-past-row" onClick={() => navigate(openPath(g.id))} style={{ '--i': i }}>
            <GameDateTile iso={g.scheduledAt} size="sm" />
            <span className="games-past-text">
              <span className="games-past-title truncate">{gameTitle(g)}</span>
              <span className="games-past-meta truncate">{formatGameTime(g.scheduledAt)} · {placeLine(g)}</span>
            </span>
            {outcomeChip(g)}
          </button>
        ))}
      </div>
      {past.length > PAST_PREVIEW && (
        <Button variant="ghost" size="sm" className="games-past-more" iconRight={showAll ? 'chevron-up' : 'chevron-down'} onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Näytä vähemmän' : `Näytä kaikki ${past.length}`}
        </Button>
      )}
    </Section>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

export function HomeScreen() {
  const { profile } = useSession();
  const myCities = useMemo(() => [...(profile?.areas || []), profile?.city].filter(Boolean), [profile?.areas, profile?.city]);

  const open = useAsync(() => api.games.listOpen(), []); // only for the bell (new open games nearby)
  const mine = useAsync(() => api.games.listMine(), []);
  const invites = useAsync(() => api.games.listInvites(), []);
  const requests = useAsync(() => api.messages.listRequests(), []);
  const outcomes = useAsync(() => api.games.pendingOutcomes(), []);
  const feed = useNotificationFeed({ open, mine, invites, requests, areas: myCities });
  // Court bookings join Tulevat where a hall is bookable (the demo and admins, for now).
  const { hall, loading: hallLoading } = useBookingHall(myCities, { anyCity: true });
  const bookings = useAsync(() => (hall ? api.booking.listMine() : Promise.resolve(null)), [hall?.id]);
  const plan = useMemo(() => gamesAndCourts(mine.data?.upcoming, bookings.data?.upcoming), [mine.data, bookings.data]);
  // With a hall, wait for its bookings too, so the list doesn't reshuffle when they arrive.
  const planLoading = mine.loading || hallLoading || Boolean(hall && !bookings.data && !bookings.error);

  // Refresh what an overlay (create game, invite reply, outcome check, booking) may have changed.
  const { reload: reloadOpen } = open;
  const { reload: reloadMine } = mine;
  const { reload: reloadInvites } = invites;
  const { reload: reloadOutcomes } = outcomes;
  const { reload: reloadBookings } = bookings;
  const refresh = useCallback(() => {
    reloadOpen({ silent: true });
    reloadMine({ silent: true });
    reloadInvites({ silent: true });
    reloadOutcomes({ silent: true });
    reloadBookings({ silent: true });
  }, [reloadOpen, reloadMine, reloadInvites, reloadOutcomes, reloadBookings]);
  useEffect(() => {
    window.addEventListener(GAMES_CHANGED, refresh);
    return () => window.removeEventListener(GAMES_CHANGED, refresh);
  }, [refresh]);

  return (
    <Page className="home">
      <div className="home-layout">
        <HomeHead next={plan[0]} loading={planLoading} feed={feed} />
        <div className="home-main">
          <AttentionSection invites={invites} requests={requests} outcomes={outcomes} />
          <PlanSection mine={mine} bookings={bookings} plan={plan} loading={planLoading} />
          <PastSection past={mine.data?.past || []} />
        </div>
      </div>
    </Page>
  );
}
