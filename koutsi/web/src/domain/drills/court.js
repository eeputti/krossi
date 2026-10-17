// court.js — the tennis court the drill diagrams are drawn on, in metres.
//
// The model is a court standing upright: x runs across (0 = left doubles line, 10.97 = right),
// y runs along (0 = far baseline at the top, 23.77 = near baseline at the bottom). The player
// being trained ("A") usually stands on the near side. Diagrams are rendered on their side
// (near baseline on the left), but every drill is written in these upright coordinates.
//
// Named points and zones keep the drill data readable: 'nBd' is the near player's deuce
// corner, 'fZa' a deep target in the far player's ad corner. Deuce and ad are always from the
// point of view of the player on that side, so 'nBd' ↔ 'fBd' is a cross-court rally and
// 'nBd' ↔ 'fBa' a rally down the line.

export const COURT = {
  W: 10.97, L: 23.77, NET: 11.885,
  SINGLES: [1.37, 9.6], CX: 5.485,
  SERVICE: [5.485, 18.285],
};

const { W, L } = COURT;

// Near-side points (bottom half). The far side is the same set turned half a circle.
const NEAR_POINTS = {
  B: [5.49, 24.4], Bd: [7.9, 24.4], Ba: [3.1, 24.4], // behind the baseline: middle, deuce corner, ad corner
  Bdw: [10.2, 24.2], Baw: [0.8, 24.2], //                pulled wide outside the singles lines
  SrvD: [6.3, 24.25], SrvA: [4.7, 24.25], //            serving positions next to the centre mark
  RetD: [9.1, 23.4], RetA: [1.9, 23.4], //              returning positions
  M: [5.49, 21.2], Md: [7.6, 21.2], Ma: [3.4, 21.2], // between the baseline and the service line
  S: [5.49, 18.6], Sd: [7.6, 18.6], Sa: [3.4, 18.6], // on the service line
  N: [5.49, 14.3], Nd: [7.5, 14.3], Na: [3.5, 14.3], // at the net, about 2.5 m from it
  Z: [5.49, 21.6], Zd: [8.5, 21.8], Za: [2.5, 21.8], // deep targets (where a ball lands)
  Q: [9.3, 25.7], Q2: [10.5, 25.7], //                  waiting in line behind the baseline (a group's queue)
  Sh: [5.49, 15.0], Shd: [8.2, 15.0], Sha: [2.8, 15.0], // short targets just over the net
  Td: [5.95, 17.6], Bod: [7.55, 17.6], Wd: [9.1, 17.6], // serve targets in the deuce box: T, body, wide
  Ta: [5.05, 17.6], Boa: [3.45, 17.6], Wa: [1.9, 17.6], // …and in the ad box
};

// Near-side zones as [x, y, w, h].
const NEAR_ZONES = {
  Deep: [1.37, 20.77, 8.23, 3.0], DeepD: [5.49, 20.77, 4.11, 3.0], DeepA: [1.37, 20.77, 4.12, 3.0],
  CornerD: [7.3, 20.27, 2.3, 3.5], CornerA: [1.37, 20.27, 2.3, 3.5],
  Mid: [4.2, 18.29, 2.57, 5.48], // the middle channel from the service line to the baseline
  BoxD: [5.49, 11.89, 4.11, 6.4], BoxA: [1.37, 11.89, 4.12, 6.4],
  Short: [1.37, 11.89, 8.23, 3.2], ShortD: [5.49, 11.89, 4.11, 3.2], ShortA: [1.37, 11.89, 4.12, 3.2],
  TzD: [5.49, 16.0, 1.1, 2.29], BzD: [6.9, 16.0, 1.3, 2.29], WzD: [8.5, 16.0, 1.1, 2.29],
  TzA: [4.39, 16.0, 1.1, 2.29], BzA: [2.77, 16.0, 1.3, 2.29], WzA: [1.37, 16.0, 1.1, 2.29],
  AlleyD: [9.6, 11.89, 1.37, 11.88], AlleyA: [0, 11.89, 1.37, 11.88],
  Half: [1.37, 11.89, 8.23, 11.88], HalfD: [5.49, 11.89, 4.11, 11.88], HalfA: [1.37, 11.89, 4.12, 11.88],
  Back: [1.37, 18.29, 8.23, 5.48], // the whole backcourt (service line → baseline)
};

const turnPoint = ([x, y]) => [round(W - x), round(L - y)];
const turnZone = ([x, y, w, h]) => [round(W - x - w), round(L - y - h), w, h];
const round = (n) => Math.round(n * 100) / 100;

export const POINTS = {};
export const ZONES = {};
Object.entries(NEAR_POINTS).forEach(([k, p]) => { POINTS[`n${k}`] = p; POINTS[`f${k}`] = turnPoint(p); });
Object.entries(NEAR_ZONES).forEach(([k, z]) => { ZONES[`n${k}`] = z; ZONES[`f${k}`] = turnZone(z); });

// 'full' = the whole court, 'half' = the near half, 'mini' = between the service lines.
// Each view is a rectangle in court coordinates, with room around the lines for the players.
export const VIEWS = {
  full: { x: -1.8, y: -2.9, w: W + 3.6, h: L + 5.8 },
  half: { x: -1.8, y: COURT.NET - 1.2, w: W + 3.6, h: L - COURT.NET + 4.1 },
  mini: { x: -1.2, y: COURT.SERVICE[0] - 1.6, w: W + 2.4, h: COURT.SERVICE[1] - COURT.SERVICE[0] + 3.2 },
};

/** A point given as a name ('nBd') or as [x, y]; null when it is neither. */
export function pointOf(p) {
  if (Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) return p;
  return typeof p === 'string' && POINTS[p] ? POINTS[p] : null;
}

/** A zone given as a name ('fDeep') or as [x, y, w, h]; null when it is neither. */
export function zoneOf(z) {
  if (Array.isArray(z) && z.length === 4 && z.every(Number.isFinite)) return z;
  return typeof z === 'string' && ZONES[z] ? ZONES[z] : null;
}
