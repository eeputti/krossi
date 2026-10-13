// feedback.jsx — loading, empty and error states.
import { Illustration } from './illustrations.jsx';
import { Icon } from './Icon.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

/** Spinner — small ring. Inherits currentColor. */
export function Spinner({ size = 22, className }) {
  return <span className={cx('spinner', className)} style={{ width: size, height: size }} role="status" aria-label="Ladataan" />;
}

/** Skeleton — shimmering placeholder block. w/h accept numbers (px) or CSS strings; r = radius. */
export function Skeleton({ w = '100%', h = 14, r = 8, className, style }) {
  return <span className={cx('skeleton', className)} style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />;
}

/** SkeletonList — `count` card-shaped placeholders. variant: 'card' (default) | 'row' | 'chat' */
export function SkeletonList({ count = 4, variant = 'card' }) {
  return (
    <div className={cx('skeleton-list', `skeleton-list-${variant}`)} aria-busy="true" aria-label="Ladataan">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-item">
          <Skeleton w={variant === 'row' ? 36 : 44} h={variant === 'row' ? 36 : 44} r={999} />
          <div className="skeleton-lines">
            <Skeleton w={`${60 - (i % 3) * 12}%`} h={14} />
            <Skeleton w={`${40 + (i % 2) * 18}%`} h={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * EmptyState — illustrated empty view.
 *   art: illustration name (court, ball, chat, players, calendar, trophy, league, search, lock, mail, celebrate, map, racket, wave)
 *   title, text, action: <Button/> node(s), compact: smaller art for inline use
 */
export function EmptyState({ art = 'court', title, text, action, compact, className }) {
  return (
    <div className={cx('empty', compact && 'empty-compact', className)}>
      <Illustration name={art} size={compact ? 120 : 176} className="empty-art" />
      {title && <h3 className="empty-title">{title}</h3>}
      {text && <p className="empty-text">{text}</p>}
      {action && <div className="empty-actions">{action}</div>}
    </div>
  );
}

/** ErrorState — load failure with a retry button. `error` may be an ApiError. */
export function ErrorState({ error, onRetry, title = 'Hups, nyt ei latautunut', compact }) {
  const msg = error?.userMessage || 'Yhteys pätkii tai jokin meni pieleen.';
  return (
    <div className={cx('empty', 'empty-error', compact && 'empty-compact')} role="alert">
      <span className="empty-error-icon"><Icon name="alert" size={26} /></span>
      <h3 className="empty-title">{title}</h3>
      <p className="empty-text">{msg}</p>
      {onRetry && (
        <div className="empty-actions">
          <button type="button" className="btn btn-outline btn-md" onClick={onRetry}>
            <Icon name="refresh" size={18} /><span className="btn-label">Yritä uudelleen</span>
          </button>
        </div>
      )}
    </div>
  );
}
