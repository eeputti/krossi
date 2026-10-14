// LeagueScreen — /pelaa/liiga/:id. Hero, the admin card for the league's admin, and the phase:
//   signup   members, join / leave, "Aloita kausi" (Krossi-liiga) or "Jaa lohkot" (hallisarja)
//   round    groups → standings + fixtures with report / confirm / chat (admin: kirjaa tulos)
//   between  hallisarja: the round is over, the admin plans the next one (promotions proposed)
//   finished the final standings
// A hallisarja keeps every round: a round picker shows the earlier rounds' tables.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { LockedPreview, usePaywall } from '../../app/paywall.jsx';
import { appUrl, navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { firstName, plural } from '../../lib/format.js';
import {
  Button, Chip, ChipSelect, Disclosure, EmptyState, ErrorState, Icon, IconButton, Page, ProgressBar, ProgressRing,
  Segmented, Skeleton, SkeletonList, Toggle, TopBar, confetti, useConfirm, useShare, useToast,
} from '../../ui/index.js';
import { AdminCard, FakeStandings, FixtureCard, MemberList, StandingsTable } from './LeagueParts.jsx';
import { burstOrigin } from './LeaguesScreen.jsx';
import { ReportResultSheet } from './ReportResultSheet.jsx';
import { AdminResultSheet } from './AdminResultSheet.jsx';
import { LeagueAdminSheet } from './LeagueAdminSheet.jsx';
import { GroupPlannerSheet } from './GroupPlannerSheet.jsx';
import {
  MIN_MEMBERS_TO_START, MIN_ROUND_PLAYERS, daysUntil, fixtureState, fixturesOfRound, formatLabel, groupName, groupOrder,
  groupStandings, isHallisarja, isMyFixture, isTimed, leaguePhase, levelLabel, myGroupOf, parseDay, playedRounds,
  roundOf, roundRange, sortFixtures,
} from './leagueUtils.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const POLL_MS = 8000;

const shortDate = (day) => {
  const d = parseDay(day);
  return d ? `${d.getDate()}.${d.getMonth() + 1}.` : '';
};

export function LeagueScreen({ params }) {
  const id = params?.id;
  const { user } = useSession();
  const meId = user?.id;
  const { paid, requirePaid } = usePaywall();
  const toast = useToast();
  const confirm = useConfirm();
  const shareLink = useShare();
  const { data: league, error, loading, reload, setData } = useAsync(() => api.leagues.get(id), [id]);
  const [busy, setBusy] = useState(null); // 'join' | 'start' | 'close' | 'leave' | 'continues' | fixtureId
  const [reporting, setReporting] = useState(null);
  const [adminFixture, setAdminFixture] = useState(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const phase = leaguePhase(league);
  const hall = isHallisarja(league);

  usePendingWatch(league, meId, reload, toast);

  const share = () => {
    if (!league) return;
    shareLink({
      title: `${formatLabel(league)}: ${league.seasonLabel}`,
      text: hall
        ? `Lähde mukaan hallisarjaan! ${league.seasonLabel} · ${league.city}`
        : `Lähde mukaan Krossi-liigaan! ${league.seasonLabel} · ${league.city} · ${levelLabel(league.skillLevel)}`,
      url: appUrl(`/pelaa/liiga/${league.id}`),
    });
  };

  const openPlayer = (p) => {
    if (p.id === meId) { navigate('/pelaa/profiili'); return; }
    requirePaid(() => navigate(`/pelaa/pelaaja/${p.id}`), 'Näe pelaajat');
  };

  const act = async (key, fn, { ok, icon, burst } = {}) => {
    setBusy(key);
    try {
      await fn();
      if (burst) confetti(burst);
      if (ok) toast(ok, icon ? { icon } : undefined);
      await reload({ silent: true });
    } catch (err) {
      toast(err);
    } finally {
      setBusy(null);
    }
  };

  const join = (event) => {
    const at = burstOrigin(event);
    return requirePaid(() => act('join', () => api.leagues.join(league.id), {
      burst: { ...at, count: 80 },
      ok: hall && phase !== 'signup'
        ? 'Olet mukana! Pääset lohkoon seuraavalla kierroksella. 🎾'
        : 'Olet mukana! Saat ilmoituksen, kun kausi alkaa. 🎾',
    }), hall ? 'Liity sarjaan' : 'Liity liigaan');
  };

  const leave = async () => {
    const ok = await confirm({
      title: 'Perutaanko ilmoittautuminen?',
      message: hall ? 'Poistut sarjasta. Voit liittyä myöhemmin uudelleen.' : 'Poistut liigasta. Voit liittyä uudelleen, kunnes kausi alkaa.',
      confirmLabel: 'Peru ilmoittautuminen',
      danger: true,
    });
    if (ok) act('leave', () => api.leagues.leave(league.id), { ok: 'Ilmoittautuminen peruttu.' });
  };

  const start = async () => {
    const ok = await confirm({
      title: 'Aloitetaanko kausi?',
      message: `Pelaajat (${league.memberCount}) jaetaan lohkoihin ja ottelut arvotaan. Ilmoittautuminen sulkeutuu.`,
      confirmLabel: 'Aloita kausi',
    });
    if (ok) act('start', () => api.leagues.start(league.id), { burst: { count: 140 }, ok: 'Kausi alkoi! Lohkot on arvottu — sovi ekat pelit. 🎾', icon: 'trophy' });
  };

  const closeRound = async () => {
    const round = league.currentRound;
    const fixtures = fixturesOfRound(league, round);
    const unconfirmed = fixtures.filter((f) => f.result && !f.result.confirmedBy).length;
    const unplayed = fixtures.filter((f) => !f.result).length;
    const parts = [];
    if (unconfirmed) parts.push(`${plural(unconfirmed, 'vahvistamaton tulos hyväksytään', 'vahvistamatonta tulosta hyväksytään')} sellaisenaan`);
    if (unplayed) parts.push(`${plural(unplayed, 'pelaamaton ottelu jää', 'pelaamatonta ottelua jää')} ilman pisteitä — kirjaa ensin luovutukset tai 3–3-tasapelit`);
    const ok = await confirm({
      title: `Päätetäänkö kierros ${round}?`,
      message: `${parts.length ? `${parts.join('. ')}. ` : 'Kaikki ottelut on pelattu. '}Tuloksia ei voi enää ilmoittaa, ja voit jakaa seuraavan kierroksen lohkot.`,
      confirmLabel: `Päätä kierros ${round}`,
    });
    if (ok) act('close', () => api.leagues.closeRound(league.id), { burst: { count: 120 }, ok: `Kierros ${round} päättyi! Jaa seuraavan kierroksen lohkot.`, icon: 'flag' });
  };

  const setContinues = (value) => act('continues', () => api.leagues.setContinues(league.id, value), {
    ok: value ? 'Jatkat seuraavalla kierroksella. 🎾' : 'Selvä — sinua ei sijoiteta seuraavan kierroksen lohkoon.',
  });

  const openChat = (fixture) => requirePaid(async () => {
    setBusy(fixture.id);
    try {
      const conversationId = await api.leagues.openFixtureChat(fixture.id);
      navigate(`/pelaa/viestit/${conversationId}`);
    } catch (err) {
      toast(err);
      setBusy(null);
    }
  }, 'Avaa chat');

  const confirmResult = async (fixture, event) => {
    const at = burstOrigin(event);
    setBusy(fixture.id);
    try {
      await api.leagues.confirmResult(fixture.id);
      const won = fixture.result.winnerId === meId;
      const draw = !fixture.result.winnerId;
      confetti({ ...at, count: won ? 120 : 60 });
      toast(
        won ? 'Voitto kirjattu sarjataulukkoon! 🏆' : draw ? 'Tasapeli kirjattu — piste kummallekin.' : 'Tulos vahvistettu — ensi kerralla revanssi!',
        { icon: won ? 'trophy' : 'check-circle' },
      );
      setData((l) => (l ? {
        ...l,
        fixtures: l.fixtures.map((f) => (f.id === fixture.id ? { ...f, result: { ...f.result, confirmedBy: meId, confirmedAt: new Date().toISOString() } } : f)),
      } : l));
      reload({ silent: true });
    } catch (err) {
      toast(err);
    } finally {
      setBusy(null);
    }
  };

  const onReported = ({ won, draw }) => {
    const opp = reporting && (reporting.playerA.id === meId ? reporting.playerB : reporting.playerA);
    setReporting(null);
    if (won) confetti();
    toast(`${draw ? 'Tasapeli ilmoitettu!' : 'Tulos ilmoitettu!'} ${firstName(opp?.name)} vahvistaa sen vielä.`, { icon: 'send' });
    reload({ silent: true });
  };

  const onAdminSaved = (message) => {
    setAdminFixture(null);
    toast(message || 'Tulos tallennettu.', { icon: 'check-circle' });
    reload({ silent: true });
  };

  const onRoundStarted = (n) => {
    setPlannerOpen(false);
    confetti({ count: 160 });
    toast(`Kierros ${n} alkoi! Pelaajat näkevät lohkonsa nyt.`, { icon: 'trophy' });
    reload({ silent: true });
  };

  const onDeleted = () => {
    setAdminOpen(false);
    toast(hall ? 'Sarja poistettu.' : 'Liiga poistettu.', { icon: 'trash' });
    navigate('/pelaa/liigat', { replace: true });
  };

  const width = league && league.status !== 'signup' && (paid || league.isPublic) ? 'wide' : 'normal';

  return (
    <>
      <TopBar
        title={league?.seasonLabel || 'Liiga'}
        back="/pelaa/liigat"
        actions={league ? (
          <>
            {league.canManage && <IconButton icon="settings" label="Ylläpito" onClick={() => setAdminOpen(true)} />}
            <IconButton icon="share" label={hall ? 'Jaa sarja' : 'Jaa liiga'} onClick={share} />
          </>
        ) : null}
      />
      <Page width={width} className="leagues-page leagues-detail">
        {loading ? (
          <LeagueSkeleton />
        ) : error ? (
          <ErrorState error={error} onRetry={() => reload()} />
        ) : !league ? (
          <EmptyState
            art="league"
            title="Liigaa ei löytynyt"
            text="Se on ehkä poistettu tai linkki on vanhentunut. Katso kaupunkisi muut liigat."
            action={<Button variant="dark" icon="trophy" onClick={() => navigate('/pelaa/liigat', { replace: true })}>Selaa liigoja</Button>}
          />
        ) : (
          <>
            <LeagueHero league={league} meId={meId} paid={paid} />
            {league.canManage && (
              <AdminCard league={league} meId={meId} onOpenAdmin={() => setAdminOpen(true)}>
                <AdminPhaseActions
                  league={league} phase={phase} busy={busy}
                  onPlan={() => setPlannerOpen(true)} onClose={closeRound}
                />
              </AdminCard>
            )}
            {!paid ? (
              league.isPublic ? (
                <UnpaidPublicLeague id={league.id} league={league} meId={meId} />
              ) : (
                <LockedPreview title="Avaa liigat" text="Näe pelaajat ja sarjataulukko, liity mukaan ja ilmoita tuloksesi.">
                  <FakeStandings />
                </LockedPreview>
              )
            ) : phase === 'signup' ? (
              hall ? (
                <HallSignupView league={league} meId={meId} busy={busy} onJoin={join} onLeave={leave} onShare={share} onPlayer={openPlayer} />
              ) : (
                <SignupView league={league} meId={meId} busy={busy} onJoin={join} onLeave={leave} onStart={start} onShare={share} onPlayer={openPlayer} />
              )
            ) : (
              <>
                {hall && <HallStatusCard league={league} meId={meId} phase={phase} busy={busy} onJoin={join} onLeave={leave} onContinues={setContinues} />}
                <SeasonView
                  league={league} meId={meId} busy={busy}
                  onPlayer={openPlayer}
                  onReport={(f) => setReporting(f)}
                  onConfirm={confirmResult}
                  onChat={openChat}
                  onAdmin={league.canManage ? (f) => setAdminFixture(f) : null}
                />
              </>
            )}
            {hall && <HallInfo league={league} />}
          </>
        )}
      </Page>
      <ReportResultSheet
        open={Boolean(reporting)}
        onClose={() => setReporting(null)}
        fixture={reporting}
        meId={meId}
        timed={isTimed(league)}
        onSaved={onReported}
      />
      {league?.canManage && (
        <>
          <AdminResultSheet open={Boolean(adminFixture)} onClose={() => setAdminFixture(null)} fixture={adminFixture} league={league} onSaved={onAdminSaved} />
          <LeagueAdminSheet
            open={adminOpen} onClose={() => setAdminOpen(false)} league={league} meId={meId}
            onChanged={() => reload({ silent: true })} onDeleted={onDeleted}
          />
          {hall && <GroupPlannerSheet open={plannerOpen} onClose={() => setPlannerOpen(false)} league={league} onStarted={onRoundStarted} />}
        </>
      )}
    </>
  );
}

/** The admin's next step for the phase (shown in the AdminCard next to "Ylläpito"). */
function AdminPhaseActions({ league, phase, busy, onPlan, onClose }) {
  if (!isHallisarja(league) || phase === 'finished') return null;
  if (phase === 'round') {
    // Quiet until the round's last day, then the obvious next step.
    const round = roundOf(league, league.currentRound);
    const due = round && daysUntil(round.endsOn) <= 0;
    return <Button variant={due ? 'dark' : 'outline'} icon="flag" loading={busy === 'close'} onClick={onClose}>Päätä kierros {league.currentRound}</Button>;
  }
  const next = (league.currentRound || 0) + 1;
  const enough = league.members.length >= MIN_ROUND_PLAYERS;
  return (
    <Button variant="lime" icon="grid" disabled={!enough} onClick={onPlan}>
      {next === 1 ? 'Jaa lohkot ja aloita' : `Jaa lohkot · kierros ${next}`}
    </Button>
  );
}

/** Silent refresh while something is pending (sign-ups, my result awaiting confirmation) + friendly toasts. */
function usePendingWatch(league, meId, reload, toast) {
  const prev = useRef(null);
  const waitingCount = league ? league.fixtures.filter((f) => fixtureState(f, meId) === 'waiting').length : 0;
  const pending = Boolean(league && (league.status === 'signup' || waitingCount > 0));

  useEffect(() => {
    if (!pending) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') reload({ silent: true }); }, POLL_MS);
    return () => clearInterval(t);
  }, [pending, reload]);

  useEffect(() => {
    const before = prev.current;
    prev.current = league || null;
    if (!before || !league || before.id !== league.id) return;
    const iAmIn = league.members.some((m) => m.id === meId);
    if (league.status === 'signup' && iAmIn) {
      const known = new Set(before.members.map((m) => m.id));
      const fresh = league.members.filter((m) => !known.has(m.id) && m.id !== meId);
      if (fresh.length === 1) toast(`${firstName(fresh[0].name)} liittyi mukaan!`, { icon: 'users' });
      else if (fresh.length > 1) toast(`${fresh.length} uutta pelaajaa liittyi!`, { icon: 'users' });
    }
    const was = new Map(before.fixtures.map((f) => [f.id, fixtureState(f, meId)]));
    league.fixtures.forEach((f) => {
      if (was.get(f.id) === 'waiting' && fixtureState(f, meId) === 'done' && !f.result.setByAdmin) {
        const opp = f.playerA.id === meId ? f.playerB : f.playerA;
        const won = f.result.winnerId === meId;
        if (won) confetti({ count: 60 });
        toast(`${firstName(opp.name)} vahvisti tuloksen${won ? ' — voitto taulukossa!' : '.'}`, { icon: 'check-circle' });
      }
    });
  }, [league, meId, toast]);
}

function PhaseChip({ league }) {
  const phase = leaguePhase(league);
  const n = league.currentRound;
  if (phase === 'signup') return <Chip tone="lime" size="sm" dot="live">Ilmoittautuminen auki</Chip>;
  if (phase === 'finished') return <Chip tone="on-dark" size="sm" icon="flag">Kausi päättynyt</Chip>;
  if (phase === 'between') return <Chip tone="on-dark" size="sm" icon="flag">Kierros {n} päättyi</Chip>;
  return <Chip tone="on-dark" size="sm" dot="live">{isHallisarja(league) ? `Kierros ${n} käynnissä` : 'Kausi käynnissä'}</Chip>;
}

/** Round strip in the hero: dates, days left and how much of the round has passed. */
function RoundStrip({ league }) {
  const phase = leaguePhase(league);
  if (phase === 'finished') return null;
  const current = roundOf(league, league.currentRound);
  const next = roundOf(league, (league.currentRound || 0) + 1);
  if (phase === 'round' && current) {
    const left = daysUntil(current.endsOn);
    const total = Math.max(1, (parseDay(current.endsOn) - parseDay(current.startsOn)) / 86400000 + 1);
    const passed = Math.min(1, Math.max(0, (total - Math.max(0, left)) / total));
    return (
      <div className="leagues-hero-round">
        <div className="leagues-hero-round-top">
          <span className="leagues-hero-round-label"><Icon name="calendar" size={15} />Kierros {current.roundNumber} · {roundRange(current)}</span>
          <span className="leagues-hero-round-left t-num">
            {left > 1 ? `${left} päivää jäljellä` : left === 1 ? 'Huomenna viimeinen päivä' : left === 0 ? 'Tänään viimeinen päivä' : 'Aika päättyi'}
          </span>
        </div>
        <ProgressBar value={passed} tone="lime" label="Kierroksesta kulunut" />
      </div>
    );
  }
  if (next) {
    return (
      <div className="leagues-hero-round is-next">
        <span className="leagues-hero-round-label"><Icon name="calendar" size={15} />{next.roundNumber === 1 ? '1. kierros' : `Kierros ${next.roundNumber}`} · {roundRange(next)}</span>
      </div>
    );
  }
  return null;
}

function LeagueHero({ league, meId, paid }) {
  const hall = isHallisarja(league);
  const phase = leaguePhase(league);
  const iAmIn = league.members?.some((m) => m.id === meId) || league.iAmMember;
  const round = hall ? league.currentRound : null;
  const groups = phase === 'signup' ? [] : groupOrder(league, meId, round);
  const myGroup = myGroupOf(league, meId);
  const mine = useMemo(() => {
    if (!iAmIn || myGroup == null || phase === 'signup') return null;
    const rows = groupStandings(league, round, myGroup);
    const rank = rows.findIndex((r) => r.player.id === meId);
    const myFx = (hall ? fixturesOfRound(league, round) : league.fixtures).filter((f) => f.groupNumber === myGroup && isMyFixture(f, meId));
    const done = myFx.filter((f) => f.result?.confirmedBy).length;
    return { rank: rank + 1, size: rows.length, row: rows[rank], done, total: myFx.length, leader: rows[0] };
  }, [league, meId, iAmIn, myGroup, phase, round, hall]);

  return (
    <section className={cx('leagues-hero', 'court-lines', 'on-dark', `is-${league.status}`)} aria-labelledby="league-title">
      <div className="leagues-hero-top">
        <PhaseChip league={league} />
        {iAmIn && <Chip tone="lime" size="sm" icon="check" className="pop">Olet mukana</Chip>}
        {hall && league.isPublic && <Chip tone="on-dark" size="sm" icon="eye">Julkinen</Chip>}
      </div>
      <div className="eyebrow">{formatLabel(league)} · {league.city}</div>
      <h1 id="league-title" className="leagues-hero-title">{league.seasonLabel}</h1>
      <div className="leagues-hero-facts">
        <span><Icon name="target" size={16} />{levelLabel(league.skillLevel)}</span>
        <span><Icon name="users" size={16} />{plural(league.memberCount, 'pelaaja', 'pelaajaa')}</span>
        {groups.length > 0 && <span><Icon name="grid" size={16} />{plural(groups.length, 'lohko', 'lohkoa')}</span>}
        {hall && <span><Icon name="clock" size={16} />{isTimed(league) ? 'Tunnin aikapeli' : 'Erät'}</span>}
        {league.venue && <span><Icon name="pin" size={16} />{league.venue}</span>}
        {!league.canManage && league.organizer?.name && (
          <span><Icon name="shield" size={16} />Ylläpitäjä: {firstName(league.organizer.name)}</span>
        )}
      </div>
      {hall && <RoundStrip league={league} />}

      {paid && mine && mine.row && (
        <div className="leagues-hero-me rise">
          <div className="leagues-hero-rank">
            <span className="leagues-hero-rank-num t-num">{mine.rank}.</span>
            <span className="leagues-hero-rank-sub">{hall ? `${groupName(league, myGroup)} · ${mine.size} pelaajaa` : `sijasi · ${mine.size} pelaajaa`}</span>
          </div>
          <div className="leagues-hero-me-stats">
            <div className="leagues-hero-me-line">
              {hall
                ? <span><strong className="t-num">{mine.row.points}</strong> pistettä</span>
                : <span><strong className="t-num">{mine.row.wins}–{mine.row.losses}</strong> voitot–häviöt</span>}
              <span><strong className="t-num">{mine.done}/{mine.total}</strong> pelattu</span>
            </div>
            <ProgressBar value={mine.total ? mine.done / mine.total : 0} tone="lime" label="Pelatut ottelut" />
          </div>
        </div>
      )}
      {paid && (phase === 'finished' || phase === 'between') && mine?.leader && mine.leader.points > 0 && (
        <div className="leagues-hero-winner pop">
          <Icon name="trophy" size={18} />
          <span>Lohkon voittaja: <strong>{mine.leader.player.id === meId ? 'Sinä! 🎉' : firstName(mine.leader.player.name)}</strong></span>
        </div>
      )}
    </section>
  );
}

function SignupView({ league, meId, busy, onJoin, onLeave, onStart, onShare, onPlayer }) {
  const iAmIn = league.members.some((m) => m.id === meId);
  const iCreated = league.createdBy === meId;
  const count = league.members.length || league.memberCount;
  const missing = Math.max(0, MIN_MEMBERS_TO_START - count);
  const ready = missing === 0;
  return (
    <>
      <section className={cx('leagues-signup', ready && 'is-ready')}>
        <ProgressRing value={count / MIN_MEMBERS_TO_START} size={68} stroke={7} tone={ready ? 'green' : 'lime'}>
          <span className="leagues-signup-ring t-num">{ready ? <Icon name="check" size={26} strokeWidth={3} /> : <>{count}<span>/{MIN_MEMBERS_TO_START}</span></>}</span>
        </ProgressRing>
        <div className="leagues-signup-text">
          <h2 className="leagues-signup-title">
            {ready ? 'Porukka on koossa!' : `Vielä ${missing} pelaaja${missing === 1 ? '' : 'a'}, niin kausi voi alkaa`}
          </h2>
          <p className="leagues-signup-sub">
            {ready
              ? (iCreated ? 'Voit aloittaa kauden, kun haluat — myöhemmin liittyvät eivät pääse mukaan.' : 'Perustaja aloittaa kauden pian. Lisää pelaajia mahtuu vielä mukaan.')
              : 'Jaa linkki kavereille — mitä enemmän pelaajia, sitä enemmän matseja.'}
          </p>
        </div>
      </section>

      <div className="leagues-signup-actions">
        {iAmIn ? (
          <Chip tone="success" icon="check-circle" className="leagues-signup-in">Olet mukana</Chip>
        ) : (
          <Button variant="lime" size="lg" icon="plus" loading={busy === 'join'} onClick={onJoin} className="leagues-signup-join">Liity liigaan</Button>
        )}
        {iCreated && (
          <Button variant="dark" size={iAmIn ? 'lg' : 'md'} icon="play" disabled={!ready} loading={busy === 'start'} onClick={onStart}>Aloita kausi</Button>
        )}
        <Button variant="outline" size={iAmIn ? 'lg' : 'md'} icon="share" onClick={onShare}>Kutsu kavereita</Button>
      </div>
      {iCreated && !ready && <p className="leagues-hint">Aloita kausi -nappi aukeaa, kun mukana on {MIN_MEMBERS_TO_START} pelaajaa.</p>}
      {iAmIn && !iCreated && (
        <button type="button" className="leagues-textlink" disabled={busy === 'leave'} onClick={onLeave}>Peru ilmoittautuminen</button>
      )}

      <section className="leagues-section">
        <div className="leagues-section-head">
          <h2 className="leagues-section-title">Ilmoittautuneet</h2>
          <span className="leagues-section-count t-num">{count}</span>
        </div>
        {league.members.length > 0
          ? <MemberList members={league.members} meId={meId} createdBy={league.createdBy} onPlayer={onPlayer} />
          : <EmptyState compact art="players" title="Ei vielä ilmoittautuneita" text="Ole ensimmäinen!" />}
      </section>
    </>
  );
}

/** Hallisarja before round 1: sign-ups; the admin makes the groups (no minimum to "start"). */
function HallSignupView({ league, meId, busy, onJoin, onLeave, onShare, onPlayer }) {
  const iAmIn = league.members.some((m) => m.id === meId);
  const count = league.members.length;
  const first = roundOf(league, 1);
  return (
    <>
      <section className="leagues-signup is-hall">
        <span className="leagues-signup-count t-num" aria-hidden="true">{count}</span>
        <div className="leagues-signup-text">
          <h2 className="leagues-signup-title">{count === 0 ? 'Ilmoittautuminen on auki' : `${plural(count, 'pelaaja', 'pelaajaa')} ilmoittautunut`}</h2>
          <p className="leagues-signup-sub">
            {league.canManage
              ? 'Kun porukka on koossa, jaa lohkot tason mukaan ja aloita 1. kierros.'
              : `Ylläpitäjä jakaa lohkot tason mukaan ennen 1. kierrosta${first ? ` (alkaa ${shortDate(first.startsOn)})` : ''}. Pelaat kerran jokaista lohkosi pelaajaa vastaan.`}
          </p>
        </div>
      </section>
      <div className="leagues-signup-actions">
        {iAmIn ? (
          <Chip tone="success" icon="check-circle" className="leagues-signup-in">Olet mukana</Chip>
        ) : (
          <Button variant="lime" size="lg" icon="plus" loading={busy === 'join'} onClick={onJoin} className="leagues-signup-join">Ilmoittaudu sarjaan</Button>
        )}
        <Button variant="outline" size={iAmIn ? 'lg' : 'md'} icon="share" onClick={onShare}>Kutsu pelaajia</Button>
      </div>
      {league.isPublic && !iAmIn && (
        <p className="leagues-hint"><Icon name="eye" size={14} /> Sarjataulukko on julkinen: nimesi näkyy siinä muodossa "Etunimi S.".</p>
      )}
      {iAmIn && (
        <button type="button" className="leagues-textlink" disabled={busy === 'leave'} onClick={onLeave}>Peru ilmoittautuminen</button>
      )}

      <section className="leagues-section">
        <div className="leagues-section-head">
          <h2 className="leagues-section-title">Ilmoittautuneet</h2>
          <span className="leagues-section-count t-num">{count}</span>
        </div>
        {count > 0
          ? <MemberList members={league.members} meId={meId} createdBy={league.createdBy} onPlayer={onPlayer} hall />
          : <EmptyState compact art="players" title="Ei vielä ilmoittautuneita" text="Jaa linkki hallin pelaajille." />}
      </section>
    </>
  );
}

/**
 * Hallisarja during / between rounds, from my point of view: join (newcomers wait for the next
 * round), "jatkan seuraavalla kierroksella", leave between rounds.
 */
function HallStatusCard({ league, meId, phase, busy, onJoin, onLeave, onContinues }) {
  const me = league.members.find((m) => m.id === meId);
  const next = roundOf(league, (league.currentRound || 0) + 1);
  const waiting = league.members.filter((m) => m.groupNumber == null).length;
  if (phase === 'finished') return null;

  if (!me) {
    return (
      <section className="leagues-status rise">
        <div className="leagues-status-text">
          <h2 className="leagues-status-title">Haluatko mukaan?</h2>
          <p className="leagues-status-sub">Ilmoittaudu nyt, niin ylläpitäjä sijoittaa sinut lohkoon seuraavalla kierroksella{next ? ` (alkaa ${shortDate(next.startsOn)})` : ''}.</p>
        </div>
        <Button variant="lime" icon="plus" loading={busy === 'join'} onClick={onJoin}>Ilmoittaudu</Button>
      </section>
    );
  }

  const placed = me.groupNumber != null;
  return (
    <section className={cx('leagues-status', 'rise', phase === 'between' && 'is-between')}>
      {phase === 'between' ? (
        <div className="leagues-status-text">
          <h2 className="leagues-status-title">Kierros {league.currentRound} on pelattu</h2>
          <p className="leagues-status-sub">
            {next ? `Seuraava kierros ${roundRange(next)}. ` : ''}Ylläpitäjä jakaa uudet lohkot: lohkon voittaja nousee ja viimeinen putoaa.
            {waiting > 0 ? ` ${plural(waiting, 'uusi pelaaja odottaa', 'uutta pelaajaa odottaa')} lohkoa.` : ''}
          </p>
        </div>
      ) : !placed ? (
        <div className="leagues-status-text">
          <h2 className="leagues-status-title">Olet ilmoittautunut</h2>
          <p className="leagues-status-sub">Pääset lohkoon seuraavalla kierroksella{next ? ` (alkaa ${shortDate(next.startsOn)})` : ''}. Siihen asti voit seurata sarjataulukkoa.</p>
        </div>
      ) : null}
      <Toggle
        checked={me.continues !== false}
        disabled={busy === 'continues'}
        onChange={onContinues}
        icon="repeat"
        label="Jatkan seuraavalla kierroksella"
        hint={me.continues !== false ? 'Sinut sijoitetaan seuraavan kierroksen lohkoon.' : 'Sinua ei sijoiteta seuraavaan kierrokseen.'}
      />
      {(phase === 'between' || !placed) && (
        <button type="button" className="leagues-textlink" disabled={busy === 'leave'} onClick={onLeave}>Poistu sarjasta</button>
      )}
    </section>
  );
}

/** Säännöt, pelipaikka ja kierrokset (hallisarja). */
function HallInfo({ league }) {
  if (!league.description && !league.venue && !(league.rounds || []).length) return null;
  return (
    <section className="leagues-section">
      <Disclosure title="Säännöt ja kierrokset" summary={`${plural(league.rounds.length, 'kierros', 'kierrosta')}`} icon="info">
        <div className="leagues-info">
          {league.description && <p className="leagues-info-text">{league.description}</p>}
          {league.venue && <p className="leagues-info-row"><Icon name="pin" size={15} />{league.venue}</p>}
          <p className="leagues-info-row"><Icon name="clock" size={15} />{isTimed(league) ? 'Tunnin aikapeli: eniten geimejä voittaa, tasapeli on mahdollinen. Voitto 2, tasapeli 1, häviö 0 pistettä.' : 'Erät: voitto 2 pistettä.'}</p>
          {league.rounds.length > 0 && (
            <ol className="leagues-info-rounds">
              {league.rounds.map((r) => (
                <li key={r.roundNumber} className={cx(r.status === 'active' && 'is-active', r.status === 'completed' && 'is-done')}>
                  <span className="leagues-info-round-name">Kierros {r.roundNumber}</span>
                  <span className="t-num">{roundRange(r)}</span>
                  <span className="leagues-info-round-status">{r.status === 'active' ? 'Käynnissä' : r.status === 'completed' ? 'Pelattu' : 'Tulossa'}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Disclosure>
    </section>
  );
}

/** Unpaid player, public league: the real standings (public names), joining needs Krossi open. */
function UnpaidPublicLeague({ id, league, meId }) {
  const { openPaywall } = usePaywall();
  const { data, error, loading, reload } = useAsync(() => api.leagues.publicGet(id), [id]);
  return (
    <>
      <section className="leagues-status rise">
        <div className="leagues-status-text">
          <h2 className="leagues-status-title">Pelaatko tässä sarjassa?</h2>
          <p className="leagues-status-sub">Avaa Krossi, niin voit ilmoittautua, sopia pelit chatissa ja ilmoittaa tuloksesi.</p>
        </div>
        <Button variant="lime" icon="lock" onClick={() => openPaywall()}>Avaa Krossi</Button>
      </section>
      {loading ? <div className="leagues-section"><SkeletonList count={4} variant="row" /></div>
        : error ? <ErrorState error={error} onRetry={() => reload()} compact />
          : data && data.status !== 'signup' ? <SeasonView league={{ ...data, members: data.members }} meId={meId} readOnly />
            : <EmptyState compact art="league" title="Lohkot jaetaan pian" text={`${league.seasonLabel}: ylläpitäjä jakaa lohkot ennen 1. kierrosta.`} />}
    </>
  );
}

/**
 * The season: (round picker) → group picker → standings + fixtures.
 *   readOnly: no actions (public view, unpaid players)
 */
export function SeasonView({ league, meId, busy, onPlayer, onReport, onConfirm, onChat, onAdmin, readOnly = false }) {
  const hall = isHallisarja(league);
  const phase = leaguePhase(league);
  const rounds = hall ? playedRounds(league) : [];
  const [round, setRound] = useState(hall ? (league.currentRound || rounds[0] || 1) : null);
  // A new round (or another league) jumps to the current round; silent refreshes keep the pick.
  useEffect(() => {
    if (!hall) return;
    if (rounds.includes(league.currentRound)) setRound(league.currentRound);
    else if (round == null || !rounds.includes(round)) setRound(rounds[0] ?? null);
  }, [rounds.join(','), league.currentRound, league.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = groupOrder(league, meId, round);
  const myGroup = myGroupOf(league, meId, round);
  const [group, setGroup] = useState(groups[0] ?? null);
  useEffect(() => {
    if (group == null || !groups.includes(group)) setGroup(groups[0] ?? null);
  }, [groups.join(','), group]); // eslint-disable-line react-hooks/exhaustive-deps

  const fixtures = (hall ? fixturesOfRound(league, round) : league.fixtures).filter((f) => f.groupNumber === group);
  const rows = useMemo(() => groupStandings(league, round, group), [league, round, group]);
  const { mine, others } = useMemo(() => sortFixtures(fixtures, meId), [fixtures, meId]);
  const active = !readOnly && phase === 'round' && (!hall || round === league.currentRound);
  const myDone = mine.filter((f) => f.result?.confirmedBy).length;
  const toConfirm = mine.filter((f) => fixtureState(f, meId) === 'confirm').length;
  const sorted = [...groups].sort((a, b) => a - b);
  const gi = sorted.indexOf(group);
  const zones = hall ? { up: gi > 0, down: gi >= 0 && gi < sorted.length - 1 } : null;

  if (groups.length === 0) {
    return <EmptyState art="league" title="Lohkoja ei vielä ole" text="Lohkot näkyvät täällä heti, kun kierros alkaa." />;
  }

  const options = groups.map((g) => ({ value: String(g), label: g === myGroup ? `${groupName(league, g)} · oma` : groupName(league, g) }));
  const fixtureCard = (f, i, compact) => (
    <FixtureCard
      key={f.id}
      index={i}
      fixture={f}
      meId={meId}
      league={league}
      state={fixtureState(f, meId)}
      active={active}
      compact={compact}
      busy={busy === f.id}
      onReport={() => onReport?.(f)}
      onConfirm={(e) => onConfirm?.(f, e)}
      onChat={() => onChat?.(f)}
      onAdmin={!readOnly && onAdmin ? () => onAdmin(f) : null}
    />
  );

  return (
    <>
      {rounds.length > 1 && (
        <div className="leagues-rounds">
          <Segmented
            ariaLabel="Kierros"
            size="sm"
            options={[...rounds].sort((a, b) => a - b).map((r) => ({ value: String(r), label: `Kierros ${r}` }))}
            value={String(round)}
            onChange={(v) => setRound(Number(v))}
          />
        </div>
      )}
      {groups.length > 1 && (
        <div className="leagues-groups">
          {groups.length <= 3 ? (
            <Segmented ariaLabel="Lohko" options={options} value={String(group)} onChange={(v) => setGroup(Number(v))} />
          ) : (
            <ChipSelect ariaLabel="Lohko" layout="scroll" size="sm" options={options} value={String(group)} onChange={(v) => v && setGroup(Number(v))} />
          )}
        </div>
      )}

      <div className="leagues-season" key={`${round}-${group}`}>
        <section className="leagues-section leagues-season-table">
          <div className="leagues-section-head">
            <h2 className="leagues-section-title">Sarjataulukko</h2>
            <span className="leagues-section-meta">{groupName(league, group)}{hall && rounds.length > 1 ? ` · kierros ${round}` : ''}</span>
          </div>
          <StandingsTable rows={rows} meId={meId} onPlayer={readOnly ? null : onPlayer} league={league} zones={zones} />
        </section>

        <div className="leagues-season-fixtures">
          {mine.length > 0 && (
            <section className="leagues-section">
              <div className="leagues-section-head">
                <h2 className="leagues-section-title">Omat ottelut</h2>
                <span className="leagues-section-meta t-num">{myDone}/{mine.length} pelattu</span>
              </div>
              {toConfirm > 0 && active && (
                <p className="leagues-alert pop"><Icon name="bell" size={16} />{toConfirm === 1 ? 'Yksi tulos odottaa vahvistustasi' : `${toConfirm} tulosta odottaa vahvistustasi`}</p>
              )}
              {hall && active && isTimed(league) && mine.some((f) => !f.result) && (
                <p className="leagues-hint leagues-fx-hint">Ilmoita tulos 24 tunnin sisällä ottelusta. Kenttä ja pallot maksetaan puoliksi.</p>
              )}
              <div className="leagues-fx-list stagger">{mine.map((f, i) => fixtureCard(f, i, false))}</div>
            </section>
          )}

          <section className="leagues-section">
            <div className="leagues-section-head">
              <h2 className="leagues-section-title">{mine.length > 0 ? 'Lohkon muut ottelut' : 'Ottelut'}</h2>
              <span className="leagues-section-meta t-num">{others.filter((f) => f.result?.confirmedBy).length}/{others.length} pelattu</span>
            </div>
            {others.length > 0
              ? <div className="leagues-fx-grid stagger">{others.map((f, i) => fixtureCard(f, i, true))}</div>
              : <EmptyState compact art="calendar" title="Ei muita otteluita" text="Tässä lohkossa pelataan vain omat ottelusi." />}
          </section>
        </div>
      </div>
    </>
  );
}

function LeagueSkeleton() {
  return (
    <div aria-busy="true" aria-label="Ladataan liigaa">
      <div className="leagues-hero leagues-hero-skeleton">
        <Skeleton w={150} h={24} r={999} />
        <Skeleton w="58%" h={30} className="leagues-sk-gap" />
        <Skeleton w="72%" h={14} />
      </div>
      <div className="leagues-section"><SkeletonList count={4} variant="row" /></div>
    </div>
  );
}
