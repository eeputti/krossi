// art.jsx — the drill library's pictures: one line icon per topic (same 24px grid and 2px round
// strokes as ui/Icon) and the court diagram drawn from a drill's `diagram` data.
import { useId } from 'react';
import { COURT, VIEWS, pointOf, zoneOf } from '../../domain/drills/court.js';
import { CATEGORY } from '../../domain/drills/index.js';

// The UI kit's racket (strung), reused inside the topic icons.
const RACKET = (
  <>
    <path d="M11.46 12.54A6.47 4.95-45 0 1 20.62 3.38a6.47 4.95-45 0 1-9.16 9.16zM10.33 8.69 7.18 15.27 2.2 20.25l1.55 1.55 4.98-4.98 6.58-3.15M7.18 15.27l1.55 1.55" />
    <path d="M11.31 10.34l7.1-7.1M13.66 12.69l7.1-7.1M11.99 6.74l5.27 5.27M14.81 3.91l5.28 5.28" strokeWidth="1.3" />
  </>
);

const TOPIC_ICONS = {
  // sun coming up over the court: the start of a session
  lammittely: <><path d="M3 18.5h18M7 18.5a5 5 0 0 1 10 0" /><path d="M12 7.5v2.2M5.3 11.3l1.6 1.4M18.7 11.3l-1.6 1.4M3.5 15.5h1.8M18.7 15.5h1.8" /></>,
  // a racket and the ball in front of it
  pohjalyonnit: <>{RACKET}<circle cx="19" cy="18.6" r="2.1" /></>,
  // the racket straight up and the ball tossed above it
  syotto: <><g transform="translate(2 5.6) scale(0.8) rotate(-45 12 12)">{RACKET}</g><circle cx="12" cy="2.9" r="1.9" /></>,
  // a ball that comes in and goes straight back
  palautus: <><circle cx="4.6" cy="7.5" r="2" /><path d="M8.5 7.5H15a4.75 4.75 0 0 1 0 9.5H7.5" /><path d="m10.5 14-3 3 3 3" /></>,
  // the net with a ball above it
  verkkopeli: <><circle cx="12" cy="4.2" r="1.9" /><path d="M3 9v11M21 9v11M3 9.6h18" strokeWidth="2.4" /><path d="M3 14.2h18M7.5 9.6V20M12 9.6V20M16.5 9.6V20" strokeWidth="1.4" /></>,
  // two footprints
  liikkuminen: <><path d="M5.6 9.8c-.5-2.6.2-5.3 2.3-5.5 2-.2 3 2.4 2.6 5.2-.3 1.8-1 2.8-2.4 2.8s-2.2-.8-2.5-2.5z" /><circle cx="8.2" cy="15.6" r="1.7" /><path d="M13.6 13.8c-.4-2.6.4-5.3 2.4-5.4 2 0 2.9 2.6 2.4 5.3-.3 1.8-1 2.7-2.4 2.7s-2.2-.9-2.4-2.6z" /><circle cx="16.1" cy="19.6" r="1.7" /></>,
  // a scoreboard
  pistepeli: <><rect x="3" y="5" width="18" height="14" rx="2.2" /><path d="M12 5v14M7 9.6l1.7-1.2v7.2" /><ellipse cx="16.3" cy="12" rx="1.8" ry="3.3" /></>,
  // two pairs on either side of the net
  nelinpeli: <><circle cx="7" cy="6" r="2.2" /><circle cx="17" cy="6" r="2.2" /><circle cx="7" cy="18" r="2.2" /><circle cx="17" cy="18" r="2.2" /><path d="M2.5 12h19" strokeDasharray="2.2 2.2" /></>,
  // a smiling ball
  lapset: <><circle cx="12" cy="12" r="8.6" /><path d="M8.2 13.8c2.2 2.4 5.4 2.4 7.6 0" /><circle cx="9.2" cy="9.8" r="0.6" fill="currentColor" /><circle cx="14.8" cy="9.8" r="0.6" fill="currentColor" /></>,
  // a dumbbell
  fysiikka: <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9.5v5M20.5 9.5v5M6.5 12h11" />,
};

/** The topic's icon (falls back to a racket for a coach's own drill with no topic). */
export function DrillIcon({ cat, size = 20, strokeWidth = 2, className }) {
  const body = TOPIC_ICONS[cat];
  if (!body) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M5.3 5.4C7.9 7.7 9.2 10.3 9.2 12s-1.3 4.3-3.9 6.6M18.7 5.4c-2.6 2.3-3.9 4.9-3.9 6.6s1.3 4.3 3.9 6.6" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {body}
    </svg>
  );
}

// ── court diagram ───────────────────────────────────────────
// The upright court model (court.js) is drawn lying down, near baseline on the left:
// screen X = L − y, screen Y = x. That keeps the picture wide and short on a phone.

const { W, L, NET, SINGLES, CX, SERVICE } = COURT;
const toScreen = ([x, y]) => [L - y, x];

function curve(from, to, bend) {
  const [x1, y1] = toScreen(from);
  const [x2, y2] = toScreen(to);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // Pull the arrow back from its target so the head stops at the point, and bow it slightly.
  const back = Math.min(0.55, len * 0.2);
  const ex = x2 - (dx / len) * back;
  const ey = y2 - (dy / len) * back;
  const k = bend * len;
  const cx = (x1 + ex) / 2 - (dy / len) * k;
  const cy = (y1 + ey) / 2 + (dx / len) * k;
  return `M${f(x1)} ${f(y1)}Q${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}`;
}
const f = (n) => Math.round(n * 100) / 100;

const R = 0.84; // a player's circle, in metres

/**
 * Players placed on the same spot (a queue, three kids "at the baseline") are pushed apart until
 * their circles no longer overlap, and kept inside the picture. Positions are in screen space.
 */
function spreadPlayers(spots, box) {
  const pts = spots.map(([x, y]) => [x, y]);
  const gap = R * 2 + 0.16;
  for (let round = 0; round < 40; round += 1) {
    let moved = false;
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        let dx = pts[j][0] - pts[i][0];
        let dy = pts[j][1] - pts[i][1];
        let d = Math.hypot(dx, dy);
        if (d >= gap) continue;
        if (d < 0.01) { dx = 0; dy = 1; d = 1; } // exactly on top of each other: stack them across the court
        const push = (gap - Math.min(d, gap)) / 2;
        pts[i][0] -= (dx / d) * push; pts[i][1] -= (dy / d) * push;
        pts[j][0] += (dx / d) * push; pts[j][1] += (dy / d) * push;
        moved = true;
      }
    }
    pts.forEach((p) => {
      p[0] = Math.min(box.x + box.w - R - 0.1, Math.max(box.x + R + 0.1, p[0]));
      p[1] = Math.min(box.y + box.h - R - 0.1, Math.max(box.y + R + 0.1, p[1]));
    });
    if (!moved) break;
  }
  return pts;
}

/**
 * CourtDiagram — the drill's set-up on a dark court: players (white), the coach/feeder (lime),
 * ball flights (lime arrows), movement (dashed arrows), target zones and cones.
 */
export function CourtDiagram({ diagram, label, className }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  if (!diagram) return null;
  const view = VIEWS[diagram.view] || VIEWS.full;
  // The view rectangle in screen space.
  const vx = L - (view.y + view.h);
  const vy = view.x;
  const vw = view.h;
  const vh = view.w;
  const players = (diagram.players || []).map(([who, at]) => ({ who, p: pointOf(at) })).filter((x) => x.p);
  const ball = (diagram.ball || []).map((s) => [pointOf(s[0]), pointOf(s[1])]).filter(([a, b]) => a && b);
  const run = (diagram.run || []).map((s) => [pointOf(s[0]), pointOf(s[1])]).filter(([a, b]) => a && b);
  const zones = (diagram.zones || []).map(zoneOf).filter(Boolean);
  const cones = (diagram.cones || []).map(pointOf).filter(Boolean);

  const [lx, ly] = [L, 0];
  const line = (x1, y1, x2, y2, cls = 'cd-line') => {
    const [a, b] = toScreen([x1, y1]);
    const [c, d] = toScreen([x2, y2]);
    return <line className={cls} x1={f(a)} y1={f(b)} x2={f(c)} y2={f(d)} />;
  };
  const zoneRect = ([x, y, w, h], i) => {
    const [sx, sy] = toScreen([x, y + h]);
    return <rect key={`z${i}`} className="cd-zone" x={f(sx)} y={f(sy)} width={f(h)} height={f(w)} rx="0.25" />;
  };
  return (
    <svg className={className ? `court-diagram ${className}` : 'court-diagram'} viewBox={`${f(vx)} ${f(vy)} ${f(vw)} ${f(vh)}`}
      role="img" aria-label={label || 'Harjoitteen kenttäkuva'} preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id={`b${uid}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto-start-reverse">
          <path d="M1 1 9 5 1 9z" className="cd-head-ball" />
        </marker>
        <marker id={`r${uid}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.6" markerHeight="4.6" orient="auto-start-reverse">
          <path d="M1.5 1.5 8.5 5 1.5 8.5" className="cd-head-run" />
        </marker>
      </defs>
      <rect className="cd-surface" x={f(lx - L)} y={f(ly)} width={L} height={W} />
      {zones.map(zoneRect)}
      {/* doubles and singles lines, baselines, service lines and the centre service line */}
      <rect className="cd-line" x="0" y="0" width={L} height={W} fill="none" />
      {line(SINGLES[0], 0, SINGLES[0], L)}
      {line(SINGLES[1], 0, SINGLES[1], L)}
      {line(SINGLES[0], SERVICE[0], SINGLES[1], SERVICE[0])}
      {line(SINGLES[0], SERVICE[1], SINGLES[1], SERVICE[1])}
      {line(CX, SERVICE[0], CX, SERVICE[1])}
      {line(CX, 0, CX, 0.3)}
      {line(CX, L - 0.3, CX, L)}
      {line(-0.45, NET, W + 0.45, NET, 'cd-net')}
      {cones.map((c, i) => {
        const [x, y] = toScreen(c);
        return <path key={`c${i}`} className="cd-cone" d={`M${f(x - 0.42)} ${f(y + 0.36)}L${f(x)} ${f(y - 0.46)}L${f(x + 0.42)} ${f(y + 0.36)}Z`} />;
      })}
      {run.map(([a, b], i) => <path key={`r${i}`} className="cd-run" d={curve(a, b, 0)} markerEnd={`url(#r${uid})`} />)}
      {ball.map(([a, b], i) => <path key={`b${i}`} className="cd-ball" d={curve(a, b, i % 2 ? -0.07 : 0.07)} markerEnd={`url(#b${uid})`} />)}
      {spreadPlayers(players.map(({ p }) => toScreen(p)), { x: vx, y: vy, w: vw, h: vh }).map(([x, y], i) => {
        const { who } = players[i];
        return (
          <g key={`p${i}`} className={who === 'V' ? 'cd-player is-coach' : 'cd-player'}>
            <circle cx={f(x)} cy={f(y)} r={R} />
            <text x={f(x)} y={f(y)} dy="0.33" textAnchor="middle">{who}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** The legend under a diagram: only the marks the drill uses. */
export function DiagramLegend({ diagram }) {
  if (!diagram) return null;
  const hasCoach = (diagram.players || []).some(([w]) => w === 'V');
  const items = [
    (diagram.players || []).some(([w]) => w !== 'V') && ['player', 'Pelaaja'],
    hasCoach && ['coach', 'Valmentaja tai syöttäjä'],
    diagram.ball?.length && ['ball', 'Pallo'],
    diagram.run?.length && ['run', 'Liike'],
    diagram.zones?.length && ['zone', 'Maalialue'],
    diagram.cones?.length && ['cone', 'Kartio'],
  ].filter(Boolean);
  return (
    <ul className="cd-legend" aria-label="Kuvan merkit">
      {items.map(([k, label]) => <li key={k}><span className={`cd-key is-${k}`} aria-hidden="true" />{label}</li>)}
    </ul>
  );
}

export const topicLabel = (cat) => CATEGORY[cat]?.label || 'Oma harjoite';
