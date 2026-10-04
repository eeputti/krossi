// primitives.jsx — buttons, chips, cards and list rows.
import { forwardRef } from 'react';
import { Icon } from './Icon.jsx';
import { Spinner } from './feedback.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

/**
 * Button
 *   variant: 'lime' (main CTA) | 'dark' (green) | 'outline' | 'soft' (sand) | 'ghost' | 'danger' | 'on-dark' (white on green)
 *   size: 'sm' | 'md' | 'lg'      block: full width      loading: shows spinner, disables
 *   icon / iconRight: Icon names   as: 'button' | 'a' (pass href)
 */
export const Button = forwardRef(function Button(
  { variant = 'dark', size = 'md', block, loading, icon, iconRight, className, children, disabled, as = 'button', type, ...rest },
  ref,
) {
  const Tag = as;
  const iconSize = size === 'sm' ? 16 : size === 'lg' ? 20 : 18;
  return (
    <Tag
      ref={ref}
      type={Tag === 'button' ? type || 'button' : undefined}
      className={cx('btn', `btn-${variant}`, `btn-${size}`, block && 'btn-block', loading && 'is-loading', className)}
      disabled={Tag === 'button' ? disabled || loading : undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={iconSize} className="btn-spinner" /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {children != null && <span className="btn-label">{children}</span>}
      {iconRight && !loading ? <Icon name={iconRight} size={iconSize} /> : null}
    </Tag>
  );
});

/** IconButton — round icon-only button. `label` is required (aria-label + tooltip). variant: 'ghost' | 'soft' | 'dark' | 'lime' | 'on-dark' */
export const IconButton = forwardRef(function IconButton(
  { icon, label, variant = 'ghost', size = 'md', badge, className, iconSize, ...rest },
  ref,
) {
  return (
    <button ref={ref} type="button" aria-label={label} title={label} className={cx('icon-btn', `icon-btn-${variant}`, `icon-btn-${size}`, className)} {...rest}>
      <Icon name={icon} size={iconSize || (size === 'sm' ? 16 : size === 'lg' ? 22 : 19)} />
      {badge ? <span className="icon-btn-badge" aria-hidden="true">{badge > 9 ? '9+' : badge}</span> : null}
    </button>
  );
});

/** Chip — small label. tone: 'neutral' | 'lime' | 'green' | 'clay' | 'success' | 'danger' | 'warn' | 'outline' | 'on-dark'. size: 'sm' | 'md' */
export function Chip({ tone = 'neutral', size = 'md', icon, dot, className, children, ...rest }) {
  return (
    <span className={cx('chip', `chip-${tone}`, `chip-${size}`, className)} {...rest}>
      {dot ? <span className={cx('chip-dot', dot === 'live' && 'chip-dot-live')} aria-hidden="true" /> : null}
      {icon ? <Icon name={icon} size={size === 'sm' ? 12 : 14} /> : null}
      {children}
    </span>
  );
}

/**
 * Card — white surface. `interactive` (or onClick) adds hover lift + press feedback and renders a
 * <button>; pass `as="a"`/`href` for links. `tone`: 'default' | 'dark' (green hero) | 'lime' | 'sand'.
 * `padding`: 'none' | 'sm' | 'md' | 'lg'.
 */
export function Card({ as, interactive, onClick, tone = 'default', padding = 'md', className, children, ...rest }) {
  const clickable = interactive || !!onClick;
  const Tag = as || (clickable ? 'button' : 'div');
  return (
    <Tag
      type={Tag === 'button' ? 'button' : undefined}
      onClick={onClick}
      className={cx('card', `card-${tone}`, `card-pad-${padding}`, clickable && 'card-interactive', tone === 'dark' && 'on-dark', className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Section — titled block on a page. `action` = { label, onClick } renders a link button on the right. */
export function Section({ title, eyebrow, action, className, children }) {
  return (
    <section className={cx('section', className)}>
      {(title || action) && (
        <div className="section-head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <h2 className="section-title">{title}</h2>}
          </div>
          {action && (
            <button type="button" className="section-action" onClick={action.onClick}>
              {action.label}
              <Icon name="chevron-right" size={16} />
            </button>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * ListRow — tappable settings/list row.
 *   icon: Icon name (shown in a soft square)  |  leading: custom node (e.g. <Avatar/>)
 *   title, subtitle, right: node shown on the right (defaults to a chevron when onClick is set)
 *   tone: 'default' | 'danger'
 */
export function ListRow({ icon, leading, title, subtitle, right, onClick, href, tone = 'default', className, chevron = true, ...rest }) {
  const clickable = !!onClick || !!href;
  const Tag = href ? 'a' : clickable ? 'button' : 'div';
  return (
    <Tag type={Tag === 'button' ? 'button' : undefined} href={href} onClick={onClick} className={cx('list-row', clickable && 'list-row-interactive', `list-row-${tone}`, className)} {...rest}>
      {leading || (icon ? <span className="list-row-icon"><Icon name={icon} size={18} /></span> : null)}
      <span className="list-row-text">
        <span className="list-row-title">{title}</span>
        {subtitle && <span className="list-row-subtitle">{subtitle}</span>}
      </span>
      {right !== undefined ? <span className="list-row-right">{right}</span> : clickable && chevron ? <Icon name="chevron-right" size={18} className="list-row-chevron" /> : null}
    </Tag>
  );
}

/** StatTile — big number + label. tone: 'default' | 'lime' | 'dark' | 'clay'. `icon` optional. */
export function StatTile({ label, value, icon, tone = 'default', sub, className }) {
  return (
    <div className={cx('stat-tile', `stat-tile-${tone}`, className)}>
      {icon && <Icon name={icon} size={18} className="stat-tile-icon" />}
      <div className="stat-tile-value t-num">{value}</div>
      <div className="stat-tile-label">{label}</div>
      {sub && <div className="stat-tile-sub">{sub}</div>}
    </div>
  );
}

export function Divider({ className }) {
  return <hr className={cx('divider', className)} />;
}
