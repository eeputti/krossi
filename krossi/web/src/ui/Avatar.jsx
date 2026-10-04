// Avatar.jsx — profile pictures with initials fallback, status dot and stacks.
import { useState } from 'react';

const cx = (...c) => c.filter(Boolean).join(' ');

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/**
 * Avatar
 *   person: PersonLite/Profile ({ name, avatarUrl, avatarColor }) — or pass src/name/color directly
 *   size: px (default 40)
 *   status: 'now' (⚡ pelaa nyt, lime pulse) | 'week' (pelaa tällä viikolla, green dot) | null
 *   ring: draws a white ring (for stacks / on photos)
 */
export function Avatar({ person, src, name, color, size = 40, status, ring, className }) {
  const [broken, setBroken] = useState(false);
  const url = src ?? person?.avatarUrl ?? null;
  const label = name ?? person?.name ?? 'Pelaaja';
  const tone = color ?? person?.avatarColor ?? 'blue';
  const showImg = url && !broken;
  return (
    <span
      className={cx('avatar', `avatar-${tone}`, ring && 'avatar-ring', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * (label.split(' ').length > 1 ? 0.36 : 0.42)) }}
      aria-hidden="true"
    >
      {showImg ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} /> : <span className="avatar-initials">{initials(label)}</span>}
      {status && <span className={cx('avatar-status', `avatar-status-${status}`)} style={{ width: Math.max(10, size * 0.28), height: Math.max(10, size * 0.28) }} />}
    </span>
  );
}

/**
 * AvatarStack — overlapping avatars with "+N".
 *   people: PersonLite[], max (default 3), size, emptySlots: number of dashed placeholder circles to append
 */
export function AvatarStack({ people = [], max = 3, size = 28, emptySlots = 0, className }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  const slots = Math.min(emptySlots, Math.max(0, max + 2 - shown.length));
  return (
    <span className={cx('avatar-stack', className)} style={{ '--stack-size': `${size}px` }}>
      {shown.map((p, i) => <Avatar key={p.id || i} person={p} size={size} ring />)}
      {extra > 0 && <span className="avatar-stack-more" style={{ width: size, height: size }}>+{extra}</span>}
      {Array.from({ length: slots }, (_, i) => <span key={`slot-${i}`} className="avatar-stack-slot" style={{ width: size, height: size }} />)}
    </span>
  );
}
