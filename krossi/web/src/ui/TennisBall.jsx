// TennisBall — the one Krossi tennis ball, used everywhere a ball is drawn (splash, loading,
// wordmark, recaps…). Same artwork as the app icon and the link-preview image
// (scripts/make-icons.mjs): lime felt with a soft highlight and the two white seams.
//
//   <TennisBall size={40} />
//   <TennisBall size={56} motion="bounce" />   'bounce' | 'spin' | 'float' | null
import { useId } from 'react';

const cx = (...c) => c.filter(Boolean).join(' ');

export function TennisBall({ size = 32, motion = null, shadow = false, className, title }) {
  const id = useId().replace(/:/g, '');
  return (
    <span
      className={cx('tball', motion && `tball-${motion}`, shadow && 'tball-has-shadow', className)}
      style={{ '--tball-size': `${size}px` }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
    >
      <svg className="tball-svg" width={size} height={size} viewBox="0 0 100 100">
        <defs>
          <radialGradient id={`g${id}`} cx="35%" cy="30%" r="75%">
            <stop offset="0" stopColor="#E4F25A" />
            <stop offset=".7" stopColor="#CFE414" />
            <stop offset="1" stopColor="#B9CC0E" />
          </radialGradient>
          <clipPath id={`c${id}`}><circle cx="50" cy="50" r="46" /></clipPath>
        </defs>
        <circle cx="50" cy="50" r="46" fill={`url(#g${id})`} />
        <g clipPath={`url(#c${id})`} fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round">
          <path d="M10 30c18-6 40-4 56 8s22 22 28 32" />
          <path d="M30 80c14 7 34 6 50-6" />
        </g>
      </svg>
      {shadow && <span className="tball-shadow" />}
    </span>
  );
}
