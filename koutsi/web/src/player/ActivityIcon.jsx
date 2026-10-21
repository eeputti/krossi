// ActivityIcon — what a player's own log was, as a line icon in the Krossi set's style (24×24,
// 2px round strokes). Lenkki, Kuntosali, Liikkuvuus and Muu laji have no icon in ui/Icon.jsx
// (a copy of Krossi's set, kept as is), so they are drawn here.
import { Icon } from '../ui/index.js';
import { activityById } from '../domain/ownWeek.js';

const OWN = {
  run: <><circle cx="15" cy="4.5" r="2" /><path d="M7.5 10.5 10.5 8h4l2 3.5 2.5 1M12.5 8l-2 5.5 3.5 3V21M10.5 13.5l-2 4H5" /></>,
  dumbbell: <path d="M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11" />,
  stretch: <><circle cx="12" cy="4.5" r="2" /><path d="M4 9.5 12 11l8-1.5M12 11v4.5L8 21M12 15.5l4 5.5" /></>,
  sport: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3v18M5.6 5.6c3.5 3.5 3.5 9.3 0 12.8M18.4 5.6c-3.5 3.5-3.5 9.3 0 12.8" /></>,
};

export function ActivityIcon({ activity, size = 20, strokeWidth = 2 }) {
  const name = activityById(activity).icon;
  if (!OWN[name]) return <Icon name={name} size={size} strokeWidth={strokeWidth} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {OWN[name]}
    </svg>
  );
}
