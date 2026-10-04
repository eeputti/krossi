// PlayerCard — SHARED component. Owner: players agent. Other screens import it with exactly this interface:
//   <PlayerCard player={Profile|PersonLite} onClick={fn} variant='list'|'compact' right={node} />
//     list    = full-width card: avatar with status, name + age, level/style chips, availability hint
//     compact = small tile for horizontal scrollers (~132 px wide)
//     right   = node on the right of a list card (e.g. a button); it is rendered OUTSIDE the
//               clickable area, so buttons inside it are fine
//   optional extras (list variant):
//     subtitle  node that replaces the availability hint line (e.g. '5 yhteistä peliä · eilen')
//     badge     node shown first in the chip row (e.g. <Chip tone="clay">Eniten pelattu</Chip>)
//     className, style (e.g. {'--i': i} inside a .stagger list)
// Works with a PersonLite too: missing fields simply aren't shown.
import { useNow } from '../../app/hooks.js';
import { Avatar, Chip, Icon } from '../../ui/index.js';
import {
  ageText, availabilityHint, isPlayingNow, levelRank, levelText, playerStatus, styleLabel,
} from '../players/playerInfo.js';

const cx = (...c) => c.filter(Boolean).join(' ');

/** Level as 4 little bars + label. tone: 'default' | 'on-dark' */
export function LevelTag({ player, short = true, tone = 'default', className }) {
  const rank = levelRank(player?.skillLevel);
  const text = levelText(player, { short });
  if (!rank) return null;
  return (
    <span className={cx('players-level', `players-level-${tone}`, className)} title={levelText(player)}>
      <span className="players-level-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => <span key={n} className={cx('players-level-bar', n <= rank && 'is-on')} />)}
      </span>
      {text}
    </span>
  );
}

export function PlayerCard({ player, onClick, variant = 'list', right, subtitle, badge, className, style }) {
  const now = useNow(60_000);
  if (!player) return null;
  const status = playerStatus(player, now);
  const playingNow = isPlayingNow(player, now);
  const age = ageText(player.ageRange);
  const Main = onClick ? 'button' : 'div';
  const label = `${player.name}${age ? `, ${age}` : ''}`;

  if (variant === 'compact') {
    return (
      <Main
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        aria-label={onClick ? `Avaa pelaajan ${player.name} profiili` : undefined}
        className={cx('players-tile', onClick && 'is-interactive', playingNow && 'is-now', className)}
        style={style}
      >
        <Avatar person={player} size={60} status={status} />
        <span className="players-tile-name truncate">{player.name}</span>
        {age && <span className="players-tile-age">{age}</span>}
        <LevelTag player={player} className="players-tile-level" />
        {playingNow ? (
          <span className="players-tile-flag players-tile-flag-now"><Icon name="bolt" size={12} strokeWidth={2.4} />Pelaa nyt</span>
        ) : player.playingThisWeek ? (
          <span className="players-tile-flag"><span className="players-dot" aria-hidden="true" />Tällä viikolla</span>
        ) : null}
      </Main>
    );
  }

  const styles = player.playStyles || [];
  const shownStyles = styles.slice(0, 2);
  const moreStyles = styles.length - shownStyles.length;
  const hint = subtitle ?? (playingNow && player.playingNowNote ? `“${player.playingNowNote}”` : availabilityHint(player.availability));
  const hintIcon = subtitle != null ? null : playingNow && player.playingNowNote ? 'chat' : 'clock';

  return (
    <div className={cx('players-card', onClick && 'is-interactive', playingNow && 'is-now', className)} style={style}>
      <Main type={onClick ? 'button' : undefined} onClick={onClick} className="players-card-main" aria-label={onClick ? `Avaa pelaajan ${label} profiili` : undefined}>
        <Avatar person={player} size={52} status={status} />
        <span className="players-card-body">
          <span className="players-card-head">
            <span className="players-card-name truncate">{player.name}</span>
            {age && <span className="players-card-age">{age}</span>}
          </span>
          <span className="players-card-tags">
            {badge}
            {playingNow ? (
              <Chip tone="lime" size="sm" icon="bolt" className="players-now-chip">Pelaa nyt</Chip>
            ) : player.playingThisWeek ? (
              <Chip tone="success" size="sm" dot>Tällä viikolla</Chip>
            ) : null}
            <LevelTag player={player} />
            {shownStyles.map((s) => <Chip key={s} tone="outline" size="sm">{styleLabel(s)}</Chip>)}
            {moreStyles > 0 && <Chip tone="outline" size="sm">+{moreStyles}</Chip>}
          </span>
          {hint ? (
            <span className={cx('players-card-hint', playingNow && subtitle == null && 'is-note', subtitle != null && 'is-sub')}>
              {hintIcon && <Icon name={hintIcon} size={13} />}
              <span className="truncate">{hint}</span>
            </span>
          ) : null}
        </span>
        {!right && onClick && <Icon name="chevron-right" size={18} className="players-card-chevron" />}
      </Main>
      {right && <div className="players-card-right">{right}</div>}
    </div>
  );
}
