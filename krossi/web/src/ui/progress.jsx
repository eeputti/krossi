// progress.jsx — progress bar/ring, animated counters and badge medals.
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** ProgressBar — value 0..1. tone: 'lime' | 'green' | 'clay' */
export function ProgressBar({ value = 0, tone = 'lime', label, className }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={cx('progress', `progress-${tone}`, className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <span className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** ProgressRing — circular progress, value 0..1, children rendered in the middle. */
export function ProgressRing({ value = 0, size = 56, stroke = 6, tone = 'lime', children, className }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(reducedMotion() ? value : 0);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(value)); return () => cancelAnimationFrame(t); }, [value]);
  return (
    <span className={cx('ring', `ring-${tone}`, className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="ring-track" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="ring-fill" fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, shown)))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      {children != null && <span className="ring-center">{children}</span>}
    </span>
  );
}

/** CountUp — animates a number from 0 (or the previous value) to `value`. */
export function CountUp({ value, duration = 900, format = (n) => String(n), className }) {
  const [n, setN] = useState(reducedMotion() ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reducedMotion() || typeof value !== 'number') { setN(value); return undefined; }
    const start = performance.now();
    const a = from.current;
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setN(Math.round(a + (value - a) * eased));
      if (k < 1) raf = requestAnimationFrame(step); else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className={cx('t-num', className)}>{typeof n === 'number' ? format(n) : n}</span>;
}

/**
 * BadgeMedal — a gamification badge as a round medal.
 *   badge: { name, icon, tier: 'bronze'|'silver'|'gold'|'special', earned, progress }
 *   size: px (default 64), showLabel: renders the name under it, onClick
 */
export function BadgeMedal({ badge, size = 64, showLabel, onClick, className }) {
  const locked = !badge.earned;
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={cx('medal', `medal-${badge.tier || 'bronze'}`, locked && 'is-locked', className)} title={badge.name}>
      <span className="medal-disc" style={{ width: size, height: size }}>
        <Icon name={badge.icon || 'award'} size={Math.round(size * 0.42)} strokeWidth={2.2} />
        {locked && badge.progress > 0 && (
          <svg className="medal-progress" viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="16.5" fill="none" strokeWidth="2.4" strokeDasharray={`${Math.round(badge.progress * 103.7)} 200`} transform="rotate(-90 18 18)" strokeLinecap="round" />
          </svg>
        )}
        {locked && <span className="medal-lock"><Icon name="lock" size={Math.max(10, Math.round(size * 0.2))} strokeWidth={2.4} /></span>}
      </span>
      {showLabel && <span className="medal-label">{badge.name}</span>}
    </Tag>
  );
}
