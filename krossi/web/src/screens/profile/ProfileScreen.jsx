// ProfileScreen — /pelaa/profiili: who I am, how I play and everything I've earned.
import { useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { usePaywall } from '../../app/paywall.jsx';
import { Link, navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { profileCompleteness } from '../../features/gamification.js';
import { AGE_RANGES, PRICE_LABEL, SKILL_LEVELS, labelOf } from '../../lib/constants.js';
import { capitalize, firstName, plural } from '../../lib/format.js';
import {
  Avatar, AvatarStack, BadgeMedal, Button, Card, Chip, CountUp, EmptyState, ErrorState, Icon, IconButton,
  ListRow, Page, PageHeader, ProgressBar, ProgressRing, Section, Skeleton, StatTile, useConfirm, useToast,
} from '../../ui/index.js';
import { InviteSheet } from '../shared/InviteSheet.jsx';
import { MatchResultSheet } from '../shared/MatchResultSheet.jsx';
import { RecapTeaser } from '../shared/RecapTeaser.jsx';
import { StreakBadge } from '../shared/StreakBadge.jsx';
import { useActivity } from '../shared/useActivity.js';
import { MatchHistorySheet } from './MatchHistorySheet.jsx';
import { ResultCard } from './ResultCard.jsx';

const EDIT = '/pelaa/profiili/muokkaa';

/** '30–40 v' for ranges, '34 v' for legacy plain numbers. */
function ageText(ageRange) {
  if (!ageRange) return '';
  if (/^\d+$/.test(ageRange)) return `${ageRange} v`;
  const label = labelOf(AGE_RANGES, ageRange);
  return label ? `${label}${/\d$/.test(label) ? ' v' : ''}` : '';
}

function ProfileHero({ profile }) {
  const level = labelOf(SKILL_LEVELS, profile.skillLevel) || 'Keskitaso';
  const classes = profile.skillLevel === 'kilpapelaaja' && profile.competitionClasses?.length ? ` · ${profile.competitionClasses.join(', ')}` : '';
  const playingNow = profile.playingNowUntil && new Date(profile.playingNowUntil) > new Date();
  const age = ageText(profile.ageRange);
  const areas = profile.areas?.length ? profile.areas : (profile.city ? [profile.city] : []);
  return (
    <Card tone="dark" padding="none" className="profile-hero court-lines rise">
      <div className="profile-hero-avatar">
        <Avatar person={profile} size={96} ring status={playingNow ? 'now' : profile.playingThisWeek ? 'week' : null} />
        <Link to={EDIT} className="profile-hero-camera" aria-label="Vaihda profiilikuva">
          <Icon name="camera" size={17} strokeWidth={2.2} />
        </Link>
      </div>
      <div className="profile-hero-body">
        <h2 className="profile-hero-name">
          {profile.name}
          {age && <span className="profile-hero-age">, {age}</span>}
        </h2>
        <div className="profile-hero-chips">
          <Chip tone="lime" icon="racket">{level}{classes}</Chip>
          {areas.map((c) => <Chip key={c} tone="on-dark" icon="pin">{c}</Chip>)}
          {playingNow
            ? <Chip tone="on-dark" dot="live">Pelaa nyt</Chip>
            : profile.playingThisWeek && <Chip tone="on-dark" dot>Pelaa tällä viikolla</Chip>}
        </div>
        {profile.bio
          ? <p className="profile-hero-bio">{profile.bio}</p>
          : <Link to={EDIT} className="profile-hero-bio-empty"><Icon name="plus" size={15} />Lisää lyhyt esittely</Link>}
      </div>
      <div className="profile-hero-actions">
        <Button variant="on-dark" size="sm" icon="edit" onClick={() => navigate(EDIT)}>Muokkaa profiilia</Button>
      </div>
    </Card>
  );
}

function CompletenessCard({ profile }) {
  const { score, missing } = profileCompleteness(profile);
  if (score >= 1) return null;
  const pct = Math.round(score * 100);
  return (
    <Card interactive className="profile-complete rise" onClick={() => navigate(EDIT)}>
      <ProgressRing value={score} size={62} stroke={6} tone="green"><span className="t-num">{pct}%</span></ProgressRing>
      <span className="profile-complete-text">
        <span className="profile-complete-title">Profiilisi on {pct} % valmis</span>
        <span className="profile-complete-sub">Täysi profiili löytää sopivat pelikaverit nopeammin.</span>
        <span className="profile-complete-chips">
          {missing.slice(0, 4).map((m) => <Chip key={m.key} size="sm" tone="outline" icon="plus">{m.label}</Chip>)}
        </span>
      </span>
      <Icon name="chevron-right" size={20} className="profile-complete-chevron" />
    </Card>
  );
}

function UnlockCard() {
  const { openPaywall } = usePaywall();
  return (
    <Card tone="lime" className="profile-unlock rise">
      <span className="profile-unlock-icon"><Icon name="lock" size={20} /></span>
      <span className="profile-unlock-text">
        <span className="profile-unlock-title">Avaa koko Krossi</span>
        <span className="profile-unlock-sub">Näe pelaajat, liity peleihin ja järjestä omia — kertamaksu {PRICE_LABEL}.</span>
      </span>
      <Button variant="dark" size="sm" onClick={() => openPaywall()}>Avaa</Button>
    </Card>
  );
}

function StatsSkeleton() {
  return (
    <div className="profile-stats">
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={98} r={18} />)}
    </div>
  );
}

function Stats({ totals, streak, wins }) {
  const winPct = totals.winRate == null ? null : Math.round(totals.winRate * 100);
  const tiles = [
    { key: 'played', tone: 'dark', icon: 'ball', label: 'Pelatut', value: totals.gamesPlayed },
    { key: 'organized', tone: 'default', icon: 'flag', label: 'Järkätyt', value: totals.gamesOrganized },
    { key: 'wins', tone: 'lime', icon: 'trophy', label: 'Voitot', value: totals.wins, sub: winPct == null ? 'Kirjaa tulos' : `${winPct} % voitoista` },
    { key: 'partners', tone: 'default', icon: 'users', label: 'Pelikaverit', value: totals.partners },
  ];
  return (
    <>
      <div className="profile-stats stagger">
        {tiles.map((t, i) => (
          <div key={t.key} style={{ '--i': i }}>
            <StatTile tone={t.tone} icon={t.icon} label={t.label} sub={t.sub} value={<CountUp value={t.value} />} />
          </div>
        ))}
      </div>
      <div className="profile-streaks rise">
        <StreakBadge streak={streak} size="lg" />
        <div className="profile-winstreak">
          <span className="profile-winstreak-icon"><Icon name="trophy" size={19} /></span>
          <span className="profile-winstreak-value t-num"><CountUp value={wins.current} /></span>
          <span className="profile-winstreak-label">{wins.current === 1 ? 'voitto putkeen' : 'voittoa putkeen'}</span>
          <span className="profile-winstreak-sub">Paras {wins.best}</span>
        </div>
      </div>
    </>
  );
}

function BadgesPreview({ badges, goals }) {
  const earned = badges.filter((b) => b.earned);
  const latest = earned.slice(0, 4);
  const goal = goals?.[0];
  const openBadges = () => navigate('/pelaa/merkit');
  return (
    <Section title="Merkit" action={{ label: 'Kaikki merkit', onClick: openBadges }}>
      <Card className="profile-badges">
        <div className="profile-badges-head">
          <span className="profile-badges-count t-num">{earned.length} / {badges.length}</span>
          <span className="profile-badges-count-label">merkkiä ansaittu</span>
          <ProgressBar value={badges.length ? earned.length / badges.length : 0} tone="green" label="Ansaitut merkit" className="profile-badges-bar" />
        </div>
        {latest.length > 0 ? (
          <div className="profile-badges-row">
            {latest.map((b, i) => (
              <span key={b.id} className="profile-pop" style={{ '--i': i }}>
                <BadgeMedal badge={b} size={56} showLabel onClick={openBadges} />
              </span>
            ))}
          </div>
        ) : (
          <p className="profile-badges-empty">Ensimmäinen merkki odottaa — pelaa peli ja ansaitse se!</p>
        )}
        {goal && (
          <button type="button" className="profile-goal" onClick={openBadges}>
            <BadgeMedal badge={goal} size={44} />
            <span className="profile-goal-text">
              <span className="profile-goal-eyebrow">Seuraava tavoite</span>
              <span className="profile-goal-title">{goal.name}</span>
              <span className="profile-goal-desc">{goal.desc}</span>
              <ProgressBar value={goal.progress} tone="clay" label={`${goal.name}: ${goal.current}/${goal.target}`} />
            </span>
            <span className="profile-goal-count t-num">{Math.min(goal.current, goal.target)}/{goal.target}</span>
          </button>
        )}
      </Card>
    </Section>
  );
}

function Recaps({ recaps }) {
  if (!recaps?.length) return null;
  const teased = recaps.find((r) => r.type === 'month')?.key;
  // Seasons first, then the newest months — a short row, not a wall of chips.
  const others = [
    ...recaps.filter((r) => r.type === 'season'),
    ...recaps.filter((r) => r.type === 'month' && r.key !== teased),
  ].slice(0, 6);
  return (
    <Section title="Koosteet">
      <div className="profile-recaps">
        <RecapTeaser recaps={recaps} />
        {others.length > 0 && (
          <div className="profile-recap-chips">
            {others.map((r) => (
              <Link key={r.key} to={`/pelaa/kooste/${r.key}`} className="profile-recap-chip">
                <Icon name={r.type === 'season' ? 'trophy' : 'calendar'} size={15} />
                {capitalize(r.label)}
                <span className="profile-recap-chip-count t-num">{r.gamesPlayed}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

function History({ query, onAdd, onEdit, onShowAll }) {
  const { data: results, loading, error, reload } = query;
  const latest = (results || []).slice(0, 3);
  return (
    <Section title="Pelihistoria" action={results?.length ? { label: 'Näytä kaikki', onClick: onShowAll } : undefined}>
      {loading ? (
        <div className="profile-results">{[0, 1].map((i) => <Skeleton key={i} h={118} r={18} />)}</div>
      ) : error ? (
        <ErrorState compact error={error} onRetry={reload} />
      ) : latest.length === 0 ? (
        <Card className="profile-history-empty">
          <EmptyState compact art="trophy" title="Ei vielä tuloksia" text="Kirjaa matsin tulos, niin voitot ja putket alkavat kertyä." />
        </Card>
      ) : (
        <div className="profile-results stagger">
          {latest.map((r, i) => <ResultCard key={r.id} result={r} style={{ '--i': i }} onClick={() => onEdit(r)} />)}
        </div>
      )}
      <Button variant="soft" block icon="plus" onClick={onAdd} className="profile-add-result">Lisää tulos</Button>
    </Section>
  );
}

function Partners() {
  const { requirePaid } = usePaywall();
  const { data: partners, loading, error, reload } = useAsync(() => api.players.listPartners(), []);
  const open = () => requirePaid(() => navigate('/pelaa/pelikaverit'), 'Näe pelikaverisi');
  let body;
  if (loading) {
    body = <Card className="profile-partners"><Skeleton w={110} h={38} r={19} /><span className="profile-partners-text"><Skeleton w="60%" h={14} /><Skeleton w="85%" h={12} /></span></Card>;
  } else if (error) {
    body = <ErrorState compact error={error} onRetry={reload} />;
  } else {
    const top = partners?.[0];
    body = (
      <Card interactive className="profile-partners" onClick={open}>
        {partners?.length
          ? <AvatarStack people={partners.map((p) => p.player)} max={4} size={38} />
          : <span className="profile-partners-icon"><Icon name="users" size={20} /></span>}
        <span className="profile-partners-text">
          <span className="profile-partners-title">{partners?.length ? plural(partners.length, 'pelikaveri', 'pelikaveria') : 'Ei vielä pelikavereita'}</span>
          <span className="profile-partners-sub">
            {top ? `Useimmin: ${firstName(top.player.name)} · ${plural(top.gamesTogether, 'peli', 'peliä')} yhdessä` : 'Pelaa peli, niin pelikaverit kertyvät tänne.'}
          </span>
        </span>
        <Icon name="chevron-right" size={20} className="profile-partners-chevron" />
      </Card>
    );
  }
  return <Section title="Pelikaverit">{body}</Section>;
}

export function ProfileScreen() {
  const { profile, paid, isAdmin } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const activity = useActivity();
  const resultsQuery = useAsync(() => api.results.listMine(), []);
  const [sheet, setSheet] = useState({ open: false, initial: null });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const refresh = () => {
    resultsQuery.reload({ silent: true });
    activity.reload({ silent: true });
  };
  const addResult = () => setSheet({ open: true, initial: null });
  const editResult = (r) => setSheet({ open: true, initial: r });
  const deleteResult = async (r) => {
    const ok = await confirm({ title: 'Poistetaanko tulos?', message: 'Tulos poistuu pelihistoriastasi ja tilastoistasi.', confirmLabel: 'Poista tulos', danger: true });
    if (!ok) return;
    try {
      await api.results.remove(r.id);
      resultsQuery.setData((list) => (list || []).filter((x) => x.id !== r.id));
      activity.reload({ silent: true });
      toast('Tulos poistettu');
    } catch (err) {
      toast(err);
    }
  };

  if (!profile) {
    return (
      <Page width="wide" className="profile-page">
        <PageHeader title="Profiili" />
        <Skeleton h={220} r={24} />
      </Page>
    );
  }

  const activityBlock = activity.loading ? (
    <><StatsSkeleton /><Skeleton h={92} r={18} className="profile-skel-gap" /></>
  ) : activity.error ? (
    <ErrorState compact error={activity.error} onRetry={activity.reload} title="Tilastot eivät latautuneet" />
  ) : (
    <Stats totals={activity.totals} streak={activity.streak} wins={activity.wins} />
  );

  return (
    <Page width="wide" className="profile-page">
      <PageHeader
        title="Profiili"
        actions={<IconButton icon="settings" label="Asetukset" variant="soft" onClick={() => navigate('/pelaa/asetukset')} />}
      />

      <ProfileHero profile={profile} />
      {!paid && <UnlockCard />}

      <div className="profile-columns">
        <div className="profile-col">
          <CompletenessCard profile={profile} />
          <Section title="Tilastot">{activityBlock}</Section>
          {activity.loading ? (
            <Section title="Merkit"><Skeleton h={190} r={18} /></Section>
          ) : !activity.error && activity.badges ? (
            <BadgesPreview badges={activity.badges} goals={activity.goals} />
          ) : null}
        </div>

        <div className="profile-col">
          {!activity.loading && !activity.error && <Recaps recaps={activity.recaps} />}
          <History query={resultsQuery} onAdd={addResult} onEdit={editResult} onShowAll={() => setHistoryOpen(true)} />
          <Partners />
          <Section title="Lisää">
            <div className="list-group">
              <ListRow icon="trophy" title="Liigat" subtitle="Kaupunkisi tennisliigat" onClick={() => navigate('/pelaa/liigat')} />
              <ListRow icon="gift" title="Kutsu kaveri" subtitle="Tuo pelikaveri Krossiin" onClick={() => setInviteOpen(true)} />
              <ListRow icon="settings" title="Asetukset" subtitle="Ilmoitukset, näkyvyys ja tili" onClick={() => navigate('/pelaa/asetukset')} />
              {isAdmin && <ListRow icon="shield" title="Ylläpito" subtitle="Tilastot ja käyttäjät" onClick={() => navigate('/pelaa/yllapito')} />}
            </div>
          </Section>
        </div>
      </div>

      <MatchHistorySheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        results={resultsQuery.data || []}
        onAdd={addResult}
        onEdit={editResult}
        onDelete={deleteResult}
      />
      <MatchResultSheet
        open={sheet.open}
        initial={sheet.initial}
        onClose={() => setSheet((s) => ({ ...s, open: false }))}
        onSaved={refresh}
      />
      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </Page>
  );
}
