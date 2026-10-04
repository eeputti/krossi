// slides.jsx — the recap story slides and buildSlides(recap), which picks the ones that have data.
//
// Every slide component receives the same props:
//   { recap, words, onShare, sharing, onClose, onPlay, onSeason }
// `bg` picks the slide background (see recap.css): 'green' | 'deep' | 'lime' | 'clay' | 'sand'.
import { Avatar, BadgeMedal, Button, CountUp, Icon, Illustration, ProgressRing } from '../../ui/index.js';
import { capitalize } from '../../lib/format.js';
import { TIME_ICON, deltaText, gamesLine, streakLine, unit, winsLine } from './copy.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const TIER_RANK = { gold: 4, silver: 3, special: 2, bronze: 1 };

/** Staggered entrance: <In d={2}>…</In> rises in after 2 steps. */
function In({ d = 0, as: Tag = 'div', className, children }) {
  return <Tag className={cx('recap-in', className)} style={{ '--d': d }}>{children}</Tag>;
}

function Body({ className, children }) {
  return <div className={cx('recap-body', className)}>{children}</div>;
}

// 1 — intro
function IntroSlide({ recap, words }) {
  return (
    <Body className="recap-intro">
      <div className="recap-intro-ball" aria-hidden="true"><span /></div>
      <In className="recap-eyebrow">Krossi-kooste</In>
      <In d={1} as="h1" className="recap-title recap-title-xl">{words.name}</In>
      <In d={2} className="recap-lead">Sun {words.unit} kentällä</In>
      <In d={4} className="recap-headline">{recap.headline}</In>
      <In d={6} className="recap-hint">Napauta jatkaaksesi <Icon name="arrow-right" size={16} /></In>
    </Body>
  );
}

// 2 — games played
function GamesSlide({ recap, words }) {
  const n = recap.gamesPlayed;
  const delta = deltaText(recap.comparedToPrevious);
  const dots = Math.min(n, 30);
  return (
    <Body>
      <In className="recap-eyebrow">Pelit</In>
      <In d={1} className="recap-lead">Pelasit</In>
      <In d={1} className="recap-big"><CountUp value={n} duration={1100} /></In>
      <In d={2} className="recap-unit">{unit.games(n)} {words.inessive}</In>
      {delta ? (
        <In d={3} className={cx('recap-delta', `recap-delta-${delta.tone}`)}>
          <Icon name={delta.tone === 'down' ? 'arrow-right' : delta.tone === 'up' ? 'arrow-up-right' : 'repeat'} size={16} />
          {delta.text}
        </In>
      ) : (
        <In d={3} className="recap-delta recap-delta-same"><Icon name="sparkles" size={16} />Ensimmäinen {words.unit} Krossissa!</In>
      )}
      <In d={4} className="recap-line">{gamesLine(n, recap.period.type === 'season')}</In>
      <div className="recap-dots" aria-hidden="true">
        {Array.from({ length: dots }, (_, i) => <span key={i} className="recap-dot" style={{ '--i': i }} />)}
        {n > dots && <span className="recap-dot-more" style={{ '--i': dots }}>+{n - dots}</span>}
      </div>
    </Body>
  );
}

// 3 — wins and losses
function WinsSlide({ recap }) {
  const decided = recap.wins + recap.losses;
  if (decided === 0) {
    return (
      <Body>
        <In className="recap-eyebrow">Ottelut</In>
        <In d={1} className="recap-icon-bubble"><Icon name="trophy" size={44} /></In>
        <In d={2} as="h2" className="recap-title">Tuloksia ei vielä kirjattu</In>
        <In d={3} className="recap-line">Kirjaa tulos pelin jälkeen, niin näet seuraavassa koosteessa voittoprosenttisi.</In>
      </Body>
    );
  }
  return (
    <Body>
      <In className="recap-eyebrow">Ottelut</In>
      <In d={1} className="recap-ring-wrap">
        <ProgressRing value={recap.winRate} size={200} stroke={16} tone="lime" className="recap-ring">
          <span className="recap-ring-value"><CountUp value={Math.round(recap.winRate * 100)} duration={1200} format={(v) => `${v} %`} /></span>
          <span className="recap-ring-label">voitoista</span>
        </ProgressRing>
      </In>
      <In d={2} as="h2" className="recap-title">
        <span className="recap-accent">{recap.wins} {unit.wins(recap.wins)}</span>
        <span className="recap-sep"> · </span>
        {recap.losses} {unit.losses(recap.losses)}
      </In>
      {recap.setsWon + recap.setsLost > 0 && (
        <In d={3} className="recap-pill">Erät {recap.setsWon}–{recap.setsLost}</In>
      )}
      <In d={4} className="recap-line">{winsLine(recap)}</In>
    </Body>
  );
}

// 4 — most played partner
function PartnerSlide({ recap, words }) {
  const { person, count } = recap.topPartner;
  const fresh = recap.newPartners.length;
  return (
    <Body className="recap-partner">
      <In className="recap-eyebrow">Pelikaveri</In>
      <In d={1} className="recap-lead">Eniten kentällä kanssasi</In>
      <div className="recap-avatar-wrap">
        <Avatar person={person} size={148} className="recap-avatar" />
        <span className="recap-orbit" aria-hidden="true"><span /></span>
      </div>
      <In d={3} as="h2" className="recap-title recap-title-xl">{person.name}</In>
      <In d={4} className="recap-pill"><Icon name="racket" size={16} />{count} {unit.games(count)} yhdessä</In>
      {fresh > 0 && (
        <In d={5} className="recap-line">+ {fresh} {unit.partners(fresh)} {words.inessive}</In>
      )}
    </Body>
  );
}

// 5 — favourite venue, time of day and weekday
function VenueSlide({ recap }) {
  const { topVenue, favoriteTime, busiestWeekday } = recap;
  return (
    <Body>
      <In className="recap-eyebrow">Kentällä</In>
      {topVenue ? (
        <>
          <In d={1} className="recap-lead">Suosikkikenttäsi</In>
          <In d={1} className="recap-pin" aria-hidden="true"><Icon name="pin" size={30} /></In>
          <In d={2} as="h2" className="recap-title recap-title-xl recap-clamp">{topVenue.name}</In>
          <In d={3} className="recap-pill">{topVenue.count} {unit.visits(topVenue.count)}</In>
        </>
      ) : (
        <In d={1} as="h2" className="recap-title recap-title-xl">Sun pelirytmi</In>
      )}
      <div className="recap-tiles">
        {favoriteTime && (
          <In d={4} className="recap-tile">
            <span className="recap-tile-icon"><Icon name={TIME_ICON[favoriteTime] || 'clock'} size={22} /></span>
            <span className="recap-tile-label">Lempiaika</span>
            <span className="recap-tile-value">{capitalize(favoriteTime)}</span>
          </In>
        )}
        {busiestWeekday && (
          <In d={5} className="recap-tile">
            <span className="recap-tile-icon"><Icon name="calendar" size={22} /></span>
            <span className="recap-tile-label">Vilkkain päivä</span>
            <span className="recap-tile-value">{capitalize(busiestWeekday)}</span>
          </In>
        )}
      </div>
    </Body>
  );
}

// 6 — week streak
function StreakSlide({ recap }) {
  const n = recap.longestWeekStreakInPeriod;
  return (
    <Body className="recap-streak">
      <In className="recap-eyebrow">Putki</In>
      <In d={1} className="recap-flame" aria-hidden="true"><Icon name="flame" size={52} strokeWidth={2.2} /></In>
      <In d={1} className="recap-big"><CountUp value={n} duration={1000} /></In>
      <In d={2} className="recap-unit">{unit.weeks(n)} putkeen</In>
      <In d={3} className="recap-line">{streakLine(n)}</In>
      <div className="recap-weeks" aria-hidden="true">
        {Array.from({ length: Math.min(n, 12) }, (_, i) => <span key={i} className="recap-week" style={{ '--i': i }} />)}
      </div>
    </Body>
  );
}

// 7 — new badges
function BadgesSlide({ recap, words }) {
  const badges = recap.newBadges;
  // Show the shiniest ones first (a season can easily have 15+ badges).
  const shown = [...badges]
    .sort((a, b) => (TIER_RANK[b.tier] ?? 0) - (TIER_RANK[a.tier] ?? 0) || (a.earnedAt < b.earnedAt ? 1 : -1))
    .slice(0, 6);
  return (
    <Body className="recap-badges">
      <In className="recap-eyebrow">Merkit</In>
      <In d={1} as="h2" className="recap-title recap-title-xl">
        <span className="recap-accent">{badges.length}</span> {unit.badges(badges.length)}!
      </In>
      <In d={2} className="recap-line">Ansaitsit nämä {words.inessive}.</In>
      <div className="recap-medals">
        {shown.map((badge, i) => (
          <span key={badge.id} className="recap-medal" style={{ '--i': i }}>
            <BadgeMedal badge={badge} size={74} showLabel />
          </span>
        ))}
      </div>
      {badges.length > shown.length && <In d={6} className="recap-line">+ {badges.length - shown.length} muuta</In>}
    </Body>
  );
}

// 8 — summary + share
function SummarySlide({ recap, words, onShare, sharing, onClose, onSeason }) {
  const tiles = [
    { value: recap.gamesPlayed, label: unit.games(recap.gamesPlayed) },
    { value: recap.wins, label: unit.wins(recap.wins) },
    { value: recap.longestWeekStreakInPeriod, label: `${unit.weeks(recap.longestWeekStreakInPeriod)} putkeen` },
    { value: recap.newBadges.length, label: unit.badges(recap.newBadges.length) },
  ];
  return (
    <Body className="recap-summary">
      <In className="recap-eyebrow">{capitalize(words.genitive)} kooste</In>
      <In d={1} as="h2" className="recap-title">{words.name}</In>
      <In d={2} className="recap-summary-card">
        <div className="recap-summary-grid">
          {tiles.map((t, i) => (
            <div key={i} className={cx('recap-summary-tile', i === 0 && 'is-hero')}>
              <span className="recap-summary-value">{t.value}</span>
              <span className="recap-summary-label">{t.label}</span>
            </div>
          ))}
        </div>
        {(recap.topPartner || recap.topVenue) && (
          <div className="recap-summary-rows">
            {recap.topPartner && (
              <div className="recap-summary-row">
                <Avatar person={recap.topPartner.person} size={34} />
                <span className="recap-summary-row-text">
                  <span className="recap-summary-row-label">Eniten pelattu</span>
                  <span className="recap-summary-row-value">{recap.topPartner.person.name}</span>
                </span>
              </div>
            )}
            {recap.topVenue && (
              <div className="recap-summary-row">
                <span className="recap-summary-row-icon"><Icon name="pin" size={18} /></span>
                <span className="recap-summary-row-text">
                  <span className="recap-summary-row-label">Suosikkikenttä</span>
                  <span className="recap-summary-row-value">{recap.topVenue.name}</span>
                </span>
              </div>
            )}
          </div>
        )}
      </In>
      <In d={3} className="recap-actions">
        <Button variant="lime" size="lg" block icon="share" loading={sharing} onClick={onShare}>Jaa kuva</Button>
        <div className="recap-actions-row">
          <Button variant="on-dark" block onClick={onClose}>Takaisin</Button>
          {recap.period.type === 'month' && (
            <Button variant="on-dark" block iconRight="arrow-right" onClick={onSeason}>Koko kausi</Button>
          )}
        </div>
      </In>
    </Body>
  );
}

// Empty month / season — the only slide.
function EmptySlide({ recap, words, onPlay, onClose }) {
  const text = recap.inProgress || recap.period.start > new Date()
    ? `Luo peli tai pyydä kaveria mukaan — ${words.genitive} kooste täyttyy pelien myötä.`
    : recap.headline;
  return (
    <Body className="recap-empty">
      <In className="recap-eyebrow">{words.name}</In>
      <In d={1}><Illustration name="court" size={220} className="recap-empty-art" /></In>
      <In d={2} as="h2" className="recap-title">{words.thisUnit} ei vielä pelejä — haasta joku!</In>
      <In d={3} className="recap-line">{text}</In>
      <In d={4} className="recap-actions">
        <Button variant="lime" size="lg" block icon="plus" onClick={onPlay}>Pelataanko?</Button>
        <Button variant="outline" block onClick={onClose}>Takaisin</Button>
      </In>
    </Body>
  );
}

/** Ordered slides for a recap; slides without data are left out. */
export function buildSlides(recap) {
  if (recap.isEmpty) return [{ id: 'empty', bg: 'sand', Component: EmptySlide }];
  const slides = [
    { id: 'intro', bg: 'green', Component: IntroSlide },
    { id: 'games', bg: 'lime', Component: GamesSlide },
    { id: 'wins', bg: 'deep', Component: WinsSlide },
  ];
  if (recap.topPartner) slides.push({ id: 'partner', bg: 'clay', Component: PartnerSlide });
  if (recap.topVenue || recap.busiestWeekday) slides.push({ id: 'venue', bg: 'sand', Component: VenueSlide });
  if (recap.longestWeekStreakInPeriod >= 2) slides.push({ id: 'streak', bg: 'green', Component: StreakSlide });
  if (recap.newBadges.length > 0) slides.push({ id: 'badges', bg: 'deep', Component: BadgesSlide, celebrate: true });
  slides.push({ id: 'summary', bg: 'green', Component: SummarySlide });
  return slides;
}

export const LIGHT_BGS = new Set(['lime', 'clay', 'sand']);
