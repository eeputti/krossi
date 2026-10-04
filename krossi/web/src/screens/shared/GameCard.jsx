// GameCard — SHARED component. Owner: games agent. Other screens import it with exactly this interface:
//   <GameCard game={Game} onClick={fn} variant='list'|'compact'|'hero' showDistance />
//     list    — full-width card for game lists
//     compact — ~240 px card for horizontal scrollers
//     hero    — big dark-green 'Seuraava pelisi' card with a countdown and a lime "Avaa peli"
//   showDistance renders a distance chip when the game has `distanceKm` (see lib/geo.js withDistance).
//   Without onClick the card is a plain (non-interactive) block.
import { usePaywall } from '../../app/paywall.jsx';
import { useNow } from '../../app/hooks.js';
import { AvatarStack, Card, Chip, Icon } from '../../ui/index.js';
import { dateTile, dayDiff, firstName, formatTime, formatGameTime } from '../../lib/format.js';
import { formatDistance } from '../../lib/geo.js';
import {
  countdownLabel, gameTitle, isFull, levelLabel, locationShort, placeLine, priceLabel, spotsLabel, surfaceLabel,
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
      {game.minSkillLevel && <Chip tone={tone} size="sm">Taso {levelLabel(game.minSkillLevel).toLowerCase()}+</Chip>}
      {showDistance && game.distanceKm != null && <Chip tone="outline" size="sm" icon="pin">{formatDistance(game.distanceKm)}</Chip>}
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

export function GameCard({ game, onClick, variant = 'list', showDistance = false }) {
  const { paid } = usePaywall();
  if (!game) return null;
  if (variant === 'hero') return <HeroCard game={game} onClick={onClick} />;
  if (variant === 'compact') return <CompactCard game={game} onClick={onClick} showDistance={showDistance} paid={paid} />;
  return <ListCard game={game} onClick={onClick} showDistance={showDistance} paid={paid} />;
}

/** Re-exported for the games screens (same look as the card's date tile). */
export { DateTile as GameDateTile, People as GamePeople };
