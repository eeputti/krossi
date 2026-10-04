// BadgesScreen — /pelaa/merkit: every badge by group, tap for details and progress.
import { useMemo, useState } from 'react';
import { BADGES } from '../../features/gamification.js';
import { formatDate } from '../../lib/format.js';
import { BadgeMedal, Button, Chip, ErrorState, Icon, Page, ProgressBar, Sheet, Skeleton, TopBar } from '../../ui/index.js';
import { openCreateGame } from '../../app/AppShell.jsx';
import { useActivity } from '../shared/useActivity.js';

const GROUPS = [
  { id: 'pelit', title: 'Pelit', icon: 'ball' },
  { id: 'voitot', title: 'Voitot', icon: 'trophy' },
  { id: 'putket', title: 'Putket', icon: 'flame' },
  { id: 'yhteisö', title: 'Yhteisö', icon: 'users' },
  { id: 'erikoiset', title: 'Erikoiset', icon: 'sparkles' },
];
const ORDER = new Map(BADGES.map((b, i) => [b.id, i]));
const TIER_LABEL = { bronze: 'Pronssi', silver: 'Hopea', gold: 'Kulta', special: 'Erikoismerkki' };

function BadgeDetail({ badge, onClose }) {
  const open = Boolean(badge);
  const [shown, setShown] = useState(badge);
  if (badge && badge !== shown) setShown(badge);
  const b = badge || shown;
  const left = b ? Math.max(0, b.target - b.current) : 0;
  return (
    <Sheet open={open} onClose={onClose} size="sm" footer={<Button variant={b?.earned ? 'dark' : 'lime'} size="lg" block onClick={() => { onClose(); if (!b?.earned) openCreateGame(); }}>{b?.earned ? 'Hienoa!' : 'Pelataanko?'}</Button>}>
      {b && (
        <div className="profile-badge-detail">
          <div className={`profile-badge-detail-art${b.earned ? ' is-earned' : ''}`}>
            <span className="pop"><BadgeMedal badge={b} size={116} /></span>
          </div>
          <Chip tone={b.earned ? 'success' : 'neutral'} size="sm" icon={b.earned ? 'check' : 'lock'}>
            {b.earned ? 'Ansaittu' : TIER_LABEL[b.tier] || 'Merkki'}
          </Chip>
          <h2 className="profile-badge-detail-name">{b.name}</h2>
          <p className="profile-badge-detail-desc">{b.desc}</p>
          {b.earned ? (
            <p className="profile-badge-detail-date">
              <Icon name="calendar" size={15} />
              {b.earnedAt ? `Ansaittu ${formatDate(b.earnedAt)}` : 'Ansaittu — hienoa työtä!'}
            </p>
          ) : (
            <div className="profile-badge-detail-progress">
              <div className="row-between">
                <span className="profile-badge-detail-progress-label">Edistyminen</span>
                <span className="t-num profile-badge-detail-progress-count">{Math.min(b.current, b.target)} / {b.target}</span>
              </div>
              <ProgressBar value={b.progress} tone="clay" label={`${b.name}: ${b.current}/${b.target}`} />
              <span className="profile-badge-detail-left">{left === 1 ? 'Enää yksi puuttuu!' : `Vielä ${left} jäljellä`}</span>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

export function BadgesScreen() {
  const { badges, goals, loading, error, reload } = useActivity();
  const [selected, setSelected] = useState(null);

  const groups = useMemo(() => {
    if (!badges) return [];
    return GROUPS.map((g) => {
      const list = badges.filter((b) => b.group === g.id).sort((a, b) => ORDER.get(a.id) - ORDER.get(b.id));
      return { ...g, list, earned: list.filter((b) => b.earned).length };
    }).filter((g) => g.list.length > 0);
  }, [badges]);

  const earned = badges ? badges.filter((b) => b.earned).length : 0;
  const total = badges ? badges.length : BADGES.length;
  const goal = goals?.[0];

  let body;
  if (loading) {
    body = (
      <>
        <Skeleton h={150} r={24} />
        {[0, 1].map((i) => (
          <div key={i} className="profile-badge-group">
            <Skeleton w={110} h={18} />
            <div className="profile-badge-grid">{[0, 1, 2, 3].map((j) => <Skeleton key={j} w={68} h={68} r={34} className="profile-badge-skel" />)}</div>
          </div>
        ))}
      </>
    );
  } else if (error) {
    body = <ErrorState error={error} onRetry={reload} title="Merkit eivät latautuneet" />;
  } else {
    body = (
      <>
        <div className="profile-badges-hero court-lines rise">
          <span className="eyebrow">Merkkikokoelma</span>
          <div className="profile-badges-hero-count">
            <span className="t-num">{earned}</span>
            <span className="profile-badges-hero-total t-num">/ {total} merkkiä</span>
          </div>
          <ProgressBar value={total ? earned / total : 0} tone="lime" label="Ansaitut merkit" className="profile-badges-hero-bar" />
          <p className="profile-badges-hero-next">
            {goal
              ? <>Seuraavaksi <strong>{goal.name}</strong> · {Math.min(goal.current, goal.target)}/{goal.target}</>
              : earned === total ? 'Kaikki merkit kerätty — olet legenda!' : 'Pelaa, voita ja kutsu kavereita — merkit kertyvät itsestään.'}
          </p>
        </div>

        {groups.map((g, gi) => (
          <section key={g.id} className="profile-badge-group">
            <div className="profile-badge-group-head">
              <h2 className="profile-badge-group-title"><Icon name={g.icon} size={17} />{g.title}</h2>
              <span className="profile-badge-group-count t-num">{g.earned}/{g.list.length}</span>
            </div>
            <div className="profile-badge-grid">
              {g.list.map((b, i) => (
                <span key={b.id} className="profile-pop" style={{ '--i': gi * 2 + i }}>
                  <BadgeMedal badge={b} size={68} showLabel onClick={() => setSelected(b)} />
                </span>
              ))}
            </div>
          </section>
        ))}
      </>
    );
  }

  return (
    <>
      <TopBar title="Merkit" back="/pelaa/profiili" />
      <Page className="profile-subpage profile-badges-page">
        {body}
      </Page>
      <BadgeDetail badge={selected} onClose={() => setSelected(null)} />
    </>
  );
}
