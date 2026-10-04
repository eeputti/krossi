// LeagueScreen — /pelaa/liiga/:id: hero, sign-up (members, join, start season) or the running
// season (groups → standings + fixtures with report / confirm / chat).
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { LockedPreview, usePaywall } from '../../app/paywall.jsx';
import { appUrl, navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { firstName, plural } from '../../lib/format.js';
import {
  Button, Chip, ChipSelect, EmptyState, ErrorState, Icon, IconButton, Page, ProgressBar, ProgressRing, Segmented,
  Skeleton, SkeletonList, TopBar, confetti, useConfirm, useShare, useToast,
} from '../../ui/index.js';
import { FakeStandings, FixtureCard, MemberList, StandingsTable } from './LeagueParts.jsx';
import { burstOrigin } from './LeaguesScreen.jsx';
import { ReportResultSheet } from './ReportResultSheet.jsx';
import {
  MIN_MEMBERS_TO_START, cityIn, computeStandings, fixtureState, groupOrder, isMyFixture, levelLabel, myGroupOf,
  sortFixtures,
} from './leagueUtils.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const POLL_MS = 8000;

export function LeagueScreen({ params }) {
  const id = params?.id;
  const { user } = useSession();
  const meId = user?.id;
  const { paid, requirePaid } = usePaywall();
  const toast = useToast();
  const confirm = useConfirm();
  const shareLink = useShare();
  const { data: league, error, loading, reload, setData } = useAsync(() => api.leagues.get(id), [id]);
  const [busy, setBusy] = useState(null); // 'join' | 'start' | fixtureId
  const [reporting, setReporting] = useState(null);

  usePendingWatch(league, meId, reload, toast);

  const share = () => {
    if (!league) return;
    shareLink({
      title: `Krossi-liiga: ${league.seasonLabel}`,
      text: `Lähde mukaan Krossi-liigaan! ${league.seasonLabel} · ${league.city} · ${levelLabel(league.skillLevel)}`,
      url: appUrl(`/pelaa/liiga/${league.id}`),
    });
  };

  const openPlayer = (p) => {
    if (p.id === meId) { navigate('/pelaa/profiili'); return; }
    requirePaid(() => navigate(`/pelaa/pelaaja/${p.id}`), 'Näe pelaajat');
  };

  const join = (event) => {
    const at = burstOrigin(event);
    return requirePaid(async () => {
      setBusy('join');
      try {
        await api.leagues.join(league.id);
        confetti({ ...at, count: 80 });
        toast('Olet mukana! Saat ilmoituksen, kun kausi alkaa. 🎾');
        await reload({ silent: true });
      } catch (err) {
        toast(err);
      } finally {
        setBusy(null);
      }
    }, 'Liity liigaan');
  };

  const start = async () => {
    const ok = await confirm({
      title: 'Aloitetaanko kausi?',
      message: `Pelaajat (${league.memberCount}) jaetaan lohkoihin ja ottelut arvotaan. Ilmoittautuminen sulkeutuu.`,
      confirmLabel: 'Aloita kausi',
    });
    if (!ok) return;
    setBusy('start');
    try {
      await api.leagues.start(league.id);
      confetti({ count: 140 });
      toast('Kausi alkoi! Lohkot on arvottu — sovi ekat pelit. 🎾', { icon: 'trophy' });
      await reload({ silent: true });
    } catch (err) {
      toast(err);
    } finally {
      setBusy(null);
    }
  };

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
      confetti({ ...at, count: won ? 120 : 60 });
      toast(won ? 'Voitto kirjattu sarjataulukkoon! 🏆' : 'Tulos vahvistettu — ensi kerralla revanssi!', { icon: won ? 'trophy' : 'check-circle' });
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

  const onReported = ({ won }) => {
    const opp = reporting && (reporting.playerA.id === meId ? reporting.playerB : reporting.playerA);
    setReporting(null);
    if (won) confetti();
    toast(`Tulos ilmoitettu! ${firstName(opp?.name)} vahvistaa sen vielä.`, { icon: 'send' });
    reload({ silent: true });
  };

  const width = league && league.status !== 'signup' && paid ? 'wide' : 'normal';

  return (
    <>
      <TopBar
        title={league?.seasonLabel || 'Liiga'}
        back="/pelaa/liigat"
        actions={league ? <IconButton icon="share" label="Jaa liiga" onClick={share} /> : null}
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
            {!paid ? (
              <LockedPreview title="Avaa liigat" text="Näe pelaajat ja sarjataulukko, liity mukaan ja ilmoita tuloksesi.">
                <FakeStandings />
              </LockedPreview>
            ) : league.status === 'signup' ? (
              <SignupView
                league={league} meId={meId} busy={busy}
                onJoin={join} onStart={start} onShare={share} onPlayer={openPlayer}
              />
            ) : (
              <SeasonView
                league={league} meId={meId} busy={busy}
                onPlayer={openPlayer}
                onReport={(f) => setReporting(f)}
                onConfirm={confirmResult}
                onChat={openChat}
              />
            )}
          </>
        )}
      </Page>
      <ReportResultSheet
        open={Boolean(reporting)}
        onClose={() => setReporting(null)}
        fixture={reporting}
        meId={meId}
        onSaved={onReported}
      />
    </>
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
      if (fresh.length === 1) toast(`${firstName(fresh[0].name)} liittyi liigaan!`, { icon: 'users' });
      else if (fresh.length > 1) toast(`${fresh.length} uutta pelaajaa liittyi!`, { icon: 'users' });
    }
    const was = new Map(before.fixtures.map((f) => [f.id, fixtureState(f, meId)]));
    league.fixtures.forEach((f) => {
      if (was.get(f.id) === 'waiting' && fixtureState(f, meId) === 'done') {
        const opp = f.playerA.id === meId ? f.playerB : f.playerA;
        const won = f.result.winnerId === meId;
        if (won) confetti({ count: 60 });
        toast(`${firstName(opp.name)} vahvisti tuloksen${won ? ' — voitto taulukossa!' : '.'}`, { icon: 'check-circle' });
      }
    });
  }, [league, meId, toast]);
}

function LeagueHero({ league, meId, paid }) {
  const iAmIn = league.members?.some((m) => m.id === meId) || league.iAmMember;
  const groups = groupOrder(league, meId);
  const myGroup = myGroupOf(league, meId);
  const mine = useMemo(() => {
    if (!iAmIn || myGroup == null || league.status === 'signup') return null;
    const members = league.members.filter((m) => m.groupNumber === myGroup);
    const fixtures = league.fixtures.filter((f) => f.groupNumber === myGroup);
    const rows = computeStandings(members, fixtures);
    const rank = rows.findIndex((r) => r.player.id === meId);
    const myFx = fixtures.filter((f) => isMyFixture(f, meId));
    const done = myFx.filter((f) => f.result?.confirmedBy).length;
    return { rank: rank + 1, size: rows.length, row: rows[rank], done, total: myFx.length, leader: rows[0] };
  }, [league, meId, iAmIn, myGroup]);

  const status = league.status;
  return (
    <section className={cx('leagues-hero', 'court-lines', 'on-dark', `is-${status}`)} aria-labelledby="league-title">
      <div className="leagues-hero-top">
        {status === 'signup' && <Chip tone="lime" size="sm" dot="live">Ilmoittautuminen auki</Chip>}
        {status === 'active' && <Chip tone="on-dark" size="sm" dot="live">Kausi käynnissä</Chip>}
        {status === 'finished' && <Chip tone="on-dark" size="sm" icon="flag">Kausi päättynyt</Chip>}
        {iAmIn && <Chip tone="lime" size="sm" icon="check" className="pop">Olet mukana</Chip>}
      </div>
      <div className="eyebrow">Krossi-liiga · {league.city}</div>
      <h1 id="league-title" className="leagues-hero-title">{league.seasonLabel}</h1>
      <div className="leagues-hero-facts">
        <span><Icon name="target" size={16} />{levelLabel(league.skillLevel)}</span>
        <span><Icon name="users" size={16} />{plural(league.memberCount, 'pelaaja', 'pelaajaa')}</span>
        {groups.length > 0 && <span><Icon name="grid" size={16} />{plural(groups.length, 'lohko', 'lohkoa')}</span>}
      </div>

      {paid && mine && mine.row && (
        <div className="leagues-hero-me rise">
          <div className="leagues-hero-rank">
            <span className="leagues-hero-rank-num t-num">{mine.rank}.</span>
            <span className="leagues-hero-rank-sub">sijasi · {mine.size} pelaajaa</span>
          </div>
          <div className="leagues-hero-me-stats">
            <div className="leagues-hero-me-line">
              <span><strong className="t-num">{mine.row.wins}–{mine.row.losses}</strong> voitot–häviöt</span>
              <span><strong className="t-num">{mine.done}/{mine.total}</strong> pelattu</span>
            </div>
            <ProgressBar value={mine.total ? mine.done / mine.total : 0} tone="lime" label="Pelatut ottelut" />
          </div>
        </div>
      )}
      {paid && status === 'finished' && mine?.leader && mine.leader.wins > 0 && (
        <div className="leagues-hero-winner pop">
          <Icon name="trophy" size={18} />
          <span>Lohkon voittaja: <strong>{mine.leader.player.id === meId ? 'Sinä! 🎉' : firstName(mine.leader.player.name)}</strong></span>
        </div>
      )}
    </section>
  );
}

function SignupView({ league, meId, busy, onJoin, onStart, onShare, onPlayer }) {
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

function SeasonView({ league, meId, busy, onPlayer, onReport, onConfirm, onChat }) {
  const groups = groupOrder(league, meId);
  const myGroup = myGroupOf(league, meId);
  const [group, setGroup] = useState(groups[0] ?? null);
  useEffect(() => {
    if (group == null || !groups.includes(group)) setGroup(groups[0] ?? null);
  }, [groups.join(','), group]); // eslint-disable-line react-hooks/exhaustive-deps

  const members = league.members.filter((m) => m.groupNumber === group);
  const fixtures = league.fixtures.filter((f) => f.groupNumber === group);
  const rows = useMemo(() => computeStandings(members, fixtures), [members, fixtures]);
  const { mine, others } = useMemo(() => sortFixtures(fixtures, meId), [fixtures, meId]);
  const active = league.status === 'active';
  const myDone = mine.filter((f) => f.result?.confirmedBy).length;
  const toConfirm = mine.filter((f) => fixtureState(f, meId) === 'confirm').length;

  if (groups.length === 0) {
    return <EmptyState art="league" title="Lohkoja ei vielä ole" text="Lohkot näkyvät täällä heti, kun kausi on arvottu." />;
  }

  const options = groups.map((g) => ({ value: String(g), label: g === myGroup ? `Lohko ${g} · oma` : `Lohko ${g}` }));
  const fixtureCard = (f, i, compact) => (
    <FixtureCard
      key={f.id}
      index={i}
      fixture={f}
      meId={meId}
      state={fixtureState(f, meId)}
      active={active}
      compact={compact}
      busy={busy === f.id}
      onReport={() => onReport(f)}
      onConfirm={(e) => onConfirm(f, e)}
      onChat={() => onChat(f)}
    />
  );

  return (
    <>
      {groups.length > 1 && (
        <div className="leagues-groups">
          {groups.length <= 3 ? (
            <Segmented ariaLabel="Lohko" options={options} value={String(group)} onChange={(v) => setGroup(Number(v))} />
          ) : (
            <ChipSelect ariaLabel="Lohko" layout="scroll" size="sm" options={options} value={String(group)} onChange={(v) => v && setGroup(Number(v))} />
          )}
        </div>
      )}

      <div className="leagues-season" key={group}>
        <section className="leagues-section leagues-season-table">
          <div className="leagues-section-head">
            <h2 className="leagues-section-title">Sarjataulukko</h2>
            <span className="leagues-section-meta">Lohko {group}</span>
          </div>
          <StandingsTable rows={rows} meId={meId} onPlayer={onPlayer} />
        </section>

        <div className="leagues-season-fixtures">
          {mine.length > 0 && (
            <section className="leagues-section">
              <div className="leagues-section-head">
                <h2 className="leagues-section-title">Omat ottelut</h2>
                <span className="leagues-section-meta t-num">{myDone}/{mine.length} pelattu</span>
              </div>
              {toConfirm > 0 && (
                <p className="leagues-alert pop"><Icon name="bell" size={16} />{toConfirm === 1 ? 'Yksi tulos odottaa vahvistustasi' : `${toConfirm} tulosta odottaa vahvistustasi`}</p>
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
