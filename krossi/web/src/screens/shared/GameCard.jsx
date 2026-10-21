// GameCard — SHARED component. Owner: games agent. Other screens import it with exactly this interface:
//   <GameCard game={Game} onClick={fn} variant='list'|'open'|'compact'|'hero' showDistance />
//     list    — full-width card with a date tile (Omat, next to the court bookings)
//     open    — person-first card for open games in Peliseura, same layout as on krossi.app
//     compact — ~240 px card for horizontal scrollers
//     hero    — big dark-green 'Seuraava pelisi' card with a countdown and a lime "Avaa peli"
//   showDistance renders a distance chip when the game has `distanceKm` (see lib/geo.js withDistance).
//   Without onClick the card is a plain (non-interactive) block.
import { usePaywall } from '../../app/paywall.jsx';
import { useNow } from '../../app/hooks.js';
import { Avatar, AvatarStack, Card, Chip, Icon } from '../../ui/index.js';
import {
  capitalize, dateTile, dayDiff, dayLabel, firstName, formatDayMonth, formatTime, formatGameTime, WEEKDAYS, WEEKDAYS_SHORT,
} from '../../lib/format.js';
import { formatDistance } from '../../lib/geo.js';
import {
  countdownLabel, gameTitle, isFull, levelLabel, levelShort, locationShort, placeLine, priceLabel, spotsLabel, surfaceLabel, venueName,
} from '../games/gameUtils.js';

const cx = (...c) => c.filter(Boolean).join(' ');

function DateTile({ iso, size = 'md' }) {
  const tile = dateTile(iso);
  const today = iso && dayDiff(iso) === 0;
  if (!tile) {
    return (
      <span className={cx('gcard-tile', `gcard-tile-${size}`, 'is-open')} aria-hidden="true">
        <Icon name="clock" size={size === 'sm' ? 16 : 20} />
        <span className="gcard-tile-wd">Avoin</span>
      </span>
    );
  }
  return (
    <span className={cx('gcard-tile', `gcard-tile-${size}`, today && 'is-today')} aria-hidden="true">
      <span className="gcard-tile-wd">{today && size !== 'sm' ? 'Tänään' : tile.weekday}</span>
      <span className="gcard-tile-day t-num">{tile.day}</span>
    </span>
  );
}

function RoleBadge({ game, paid }) {
  if (game.isMine) return <Chip tone="green" size="sm" icon="star">Sinä järjestät</Chip>;
  if (game.iJoined) return <Chip tone="success" size="sm" icon="check">Olet mukana</Chip>;
  if (game.onWaitlist) return <Chip tone="warn" size="sm">Jonossa</Chip>;
  if (!paid) return <span className="gcard-lock" title="Avaa Krossi nähdäksesi pelin"><Icon name="lock" size={14} strokeWidth={2.4} /></span>;
  return null;
}

function TagChips({ game, showDistance, tone = 'neutral' }) {
  const loc = locationShort(game.locationType);
  const surface = surfaceLabel(game.courtSurface);
  const price = game.kind === 'event' ? priceLabel(game) : null;
  return (
    <span className="gcard-chips">
      {game.kind === 'event' && <Chip tone="lime" size="sm" icon="flag">Tapahtuma{price ? ` · ${price}` : ''}</Chip>}
      {loc && <Chip tone={tone} size="sm">{loc}</Chip>}
      {surface && <Chip tone={tone} size="sm">{surface}</Chip>}
      {game.minSkillLevel && <Chip tone={tone} size="sm">Taso {levelShort(game.minSkillLevel)}+</Chip>}
      {showDistance && game.distanceKm != null && <Chip tone="outline" size="sm" icon="pin">{formatDistance(game.distanceKm)}</Chip>}
    </span>
  );
}

/** 'Tänään klo 19.00' | 'Huomenna klo 7.00' | 'Perjantai klo 10.00' (this week) | 'Pe 31.10. klo 10.00' | 'Aika sovitaan' */
function whenLine(iso, now) {
  if (!iso) return 'Aika sovitaan';
  const diff = dayDiff(iso, now);
  const d = new Date(iso);
  let day;
  if (diff === 0 || diff === 1 || diff < 0) day = dayLabel(iso, now);
  else if (diff < 7) day = capitalize(WEEKDAYS[d.getDay()]);
  else day = `${capitalize(WEEKDAYS_SHORT[d.getDay()])} ${formatDayMonth(iso)}`;
  return `${day} klo ${formatTime(iso)}`;
}

/** 'Kispi Areena · Sisällä · Kova' — the venue (or city) with indoor/outdoor and surface. */
function placeDetails(game) {
  return [venueName(game) || placeLine(game), locationShort(game.locationType), surfaceLabel(game.courtSurface)].filter(Boolean).join(' · ');
}

/** Who has joined (small avatars) and the free places (dashed circles), at most three in all. */
function Slots({ game }) {
  if (isFull(game)) return <Chip tone="neutral" size="sm">Täynnä</Chip>;
  const joined = (game.participants || []).slice(0, 2);
  const free = Math.max(0, Math.min(game.spotsLeft || 0, 3 - joined.length));
  return (
    <span className="gcard-slots" aria-label={spotsLabel(game)}>
      {joined.map((p, i) => <Avatar key={p.id || i} person={p} size={22} />)}
      {Array.from({ length: free }).map((_, i) => <span key={`free-${i}`} className="gcard-slot" />)}
    </span>
  );
}

function People({ game, size = 26, max = 3 }) {
  const people = [game.creator, ...(game.participants || [])].filter(Boolean);
  return <AvatarStack people={people} max={max} size={size} emptySlots={Math.min(game.spotsLeft || 0, 2)} />;
}

function SpotsChip({ game, size = 'sm' }) {
  return isFull(game)
    ? <Chip tone="neutral" size={size}>Täynnä</Chip>
    : <Chip tone="lime" size={size}>{spotsLabel(game)}</Chip>;
}

function HeroCard({ game, onClick }) {
  const now = useNow(60_000);
  return (
    <Card tone="dark" padding="none" onClick={onClick} className="gcard gcard-hero court-lines">
      <span className="gcard-hero-top">
        <span className="gcard-countdown"><span className="gcard-countdown-dot" aria-hidden="true" />{countdownLabel(game.scheduledAt, now)}</span>
        {game.isMine && <Chip tone="on-dark" size="sm">Sinä järjestät</Chip>}
      </span>
      <span className="gcard-hero-title">{gameTitle(game)}</span>
      <span className="gcard-hero-meta">
        <Icon name="pin" size={15} />
        <span className="truncate">{placeLine(game)}</span>
      </span>
      <span className="gcard-hero-foot">
        <People game={game} size={32} />
        <span className="gcard-hero-spots">{spotsLabel(game)}</span>
        {onClick && <span className="btn btn-lime btn-md gcard-hero-cta"><span className="btn-label">Avaa peli</span><Icon name="arrow-right" size={18} /></span>}
      </span>
    </Card>
  );
}

function CompactCard({ game, onClick, showDistance, paid }) {
  const today = game.scheduledAt && dayDiff(game.scheduledAt) === 0;
  return (
    <Card padding="none" onClick={onClick} className={cx('gcard', 'gcard-compact', today && 'is-today')}>
      <span className="gcard-compact-top">
        <DateTile iso={game.scheduledAt} size="sm" />
        <span className="gcard-compact-when">
          <span className="gcard-compact-day">{game.scheduledAt ? formatGameTime(game.scheduledAt).split(' klo ')[0] : 'Aika sovitaan'}</span>
          {game.scheduledAt && <span className="gcard-compact-time t-num">klo {formatTime(game.scheduledAt)}</span>}
        </span>
        <span className="gcard-compact-badge"><RoleBadge game={game} paid={paid} /></span>
      </span>
      <span className="gcard-title truncate">{gameTitle(game)}</span>
      <span className="gcard-meta truncate">{placeLine(game)}{showDistance && game.distanceKm != null ? ` · ${formatDistance(game.distanceKm)}` : ''}</span>
      <span className="gcard-foot">
        <People game={game} size={24} max={3} />
        <SpotsChip game={game} />
      </span>
    </Card>
  );
}

function ListCard({ game, onClick, showDistance, paid }) {
  const creatorName = game.isMine ? 'Sinä' : firstName(game.creator?.name);
  return (
    <Card padding="none" onClick={onClick} className={cx('gcard', 'gcard-list', game.isMine && 'is-mine', game.iJoined && 'is-joined')}>
      <span className="gcard-main">
        <DateTile iso={game.scheduledAt} />
        <span className="gcard-body">
          <span className="gcard-head">
            <span className="gcard-title truncate">{gameTitle(game)}</span>
            <RoleBadge game={game} paid={paid} />
          </span>
          <span className="gcard-meta">
            {game.scheduledAt
              ? <span className="gcard-time t-num"><Icon name="clock" size={14} />klo {formatTime(game.scheduledAt)}</span>
              : <span className="gcard-time"><Icon name="clock" size={14} />Aika sovitaan</span>}
            <span className="gcard-place truncate"><Icon name="pin" size={14} />{placeLine(game)}</span>
          </span>
          <TagChips game={game} showDistance={showDistance} />
        </span>
      </span>
      <span className="gcard-foot gcard-foot-list">
        <People game={game} />
        <span className="gcard-creator truncate">
          <strong>{creatorName}</strong> {game.isMine ? 'järjestät' : 'järjestää'}
        </span>
        <SpotsChip game={game} />
      </span>
    </Card>
  );
}

function OpenCard({ game, onClick, showDistance, paid }) {
  const now = useNow(60_000);
  const creator = game.creator;
  const name = game.isMine ? 'Sinä' : firstName(creator?.name) || 'Pelaaja';
  const age = !game.isMine && creator?.ageRange ? `, ${String(creator.ageRange).replace('-', '–')}` : '';
  const level = creator?.skillLevel ? levelLabel(creator.skillLevel) : null;
  const price = game.kind === 'event' ? priceLabel(game) : null;
  const badge = <RoleBadge game={game} paid={paid} />;
  const hasBadge = game.isMine || game.iJoined || game.onWaitlist || !paid;
  return (
    <Card padding="none" onClick={onClick} className={cx('gcard', 'gcard-open', game.isMine && 'is-mine', game.iJoined && 'is-joined')}>
      <span className="gcard-top">
        <span className="gcard-when t-num">{whenLine(game.scheduledAt, new Date(now))}</span>
        <Chip tone="neutral" size="sm" className="gcard-type">{gameTitle(game)}</Chip>
      </span>
      <span className="gcard-person">
        <Avatar person={creator} size={42} />
        <span className="gcard-who">
          <span className="gcard-name truncate">{name}{age}</span>
          <span className="gcard-place truncate">{placeDetails(game)}</span>
        </span>
        <Slots game={game} />
      </span>
      {game.description && <span className="gcard-desc">{game.description}</span>}
      <span className="gcard-open-foot">
        <span className="gcard-tags">
          {game.kind === 'event' && <Chip tone="lime" size="sm" icon="flag">Tapahtuma{price ? ` · ${price}` : ''}</Chip>}
          {level && <Chip tone="neutral" size="sm">{level}</Chip>}
          {game.minSkillLevel && <Chip tone="neutral" size="sm">Taso {levelShort(game.minSkillLevel)}+</Chip>}
          {showDistance && game.distanceKm != null && <Chip tone="outline" size="sm" icon="pin">{formatDistance(game.distanceKm)}</Chip>}
        </span>
        {hasBadge ? badge : onClick && <span className="gcard-go">Avaa peli <Icon name="arrow-right" size={14} /></span>}
      </span>
    </Card>
  );
}

export function GameCard({ game, onClick, variant = 'list', showDistance = false }) {
  const { paid } = usePaywall();
  if (!game) return null;
  if (variant === 'hero') return <HeroCard game={game} onClick={onClick} />;
  if (variant === 'open') return <OpenCard game={game} onClick={onClick} showDistance={showDistance} paid={paid} />;
  if (variant === 'compact') return <CompactCard game={game} onClick={onClick} showDistance={showDistance} paid={paid} />;
  return <ListCard game={game} onClick={onClick} showDistance={showDistance} paid={paid} />;
}

/** Re-exported for the games screens (same look as the card's date tile). */
export { DateTile as GameDateTile, People as GamePeople };
