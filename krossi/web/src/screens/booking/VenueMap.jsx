// VenueMap.jsx — plain floor map ("pohjakartta") of one booking location, with its courts
// coloured by availability. Layout data lives in venueMaps.js.
//
//   <VenueMap mapKey="lahti-janus" courts={location.courts} states={{ [courtId]: 'free' }}
//             labels={{ [courtId]: '23 €' }} onSelect={(courtId) => …} />
//   <VenueMap compact … />   booking sheets: no legend, labels only on the courts in `states`
//
// A matter-of-fact floor plan: thin hall outlines, the entrances, the place name and the
// courts, coloured by state only (booking-map.css). One SVG draws the plan; the courts sit on
// top of it as absolutely positioned HTML pieces (percentages of the map), so tappable courts
// are real <button>s with focus rings and every label is HTML text at a fixed px size —
// readable on a 300 px phone without growing huge on desktop. Labels don't scale with the
// drawing, so each court gets the longest label that fits inside it at the current width
// (measured with a ResizeObserver): "Tennis 1 / 25 €" → "Te1 / 25 €" → "Te1" → "1". Courts of
// one kind all use full names or all use short ones, so a row never mixes "Tennis 1" and "Te2".
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { VENUE_MAPS, hasVenueMap } from './venueMaps.js';

export { hasVenueMap };

const cx = (...c) => c.filter(Boolean).join(' ');
const r1 = (v) => Math.round(v * 10) / 10;
const pct = (v) => `${(v * 100).toFixed(3)}%`;

const STATES = ['free', 'busy', 'mine', 'selected', 'closed'];
const STATE_WORD = { free: 'vapaa', busy: 'varattu', mine: 'oma varauksesi', selected: 'valittu', closed: 'suljettu' };
const DEFAULT_SUB = { busy: 'Varattu', closed: 'Suljettu', mine: 'Sinun' };

// ── Measuring ────────────────────────────────────────────────────────────────

/** Layout width of the element in px (0 until measured); follows resizes. */
function useWidth(ref, key) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = (w) => setWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
    update(el.clientWidth);
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver((entries) => update(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, key]);
  return width;
}

/** Label sizes (px) for a map this wide; booking-map.css reads them as --bmap-fs-*. */
function typeScale(px) {
  if (px >= 560) return { name: 13, sub: 12, small: 12, place: 14 };
  if (px >= 420) return { name: 12.5, sub: 11.5, small: 11.5, place: 13.5 };
  return { name: 11.5, sub: 11, small: 11, place: 13 };
}

// Advance widths of SF Pro Text at weight 700, in hundredths of an em — measured at 11–13.5 px
// and rounded up; weight 600 runs about 3 % narrower. Segoe UI and Roboto run narrower still,
// so a label we decide fits fits there too. Anything not listed counts as a wide glyph.
const glyphs = (chars, widths) => [...chars].map((c, i) => [c, widths[i]]);
const GLYPH = new Map([
  ...glyphs('abcdefghijklmnopqrstuvwxyzäöå', [60, 66, 60, 66, 61, 43, 66, 65, 30, 30, 62, 31, 95, 64, 63, 66, 66, 45, 57, 43, 64, 60, 87, 60, 61, 58, 60, 63, 60]),
  ...glyphs('ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÅ', [75, 71, 75, 76, 63, 61, 77, 80, 33, 62, 72, 61, 92, 78, 80, 69, 80, 71, 69, 67, 77, 74, 102, 74, 72, 68, 75, 80, 75]),
  ...glyphs('0123456789', [70, 53, 66, 68, 70, 68, 70, 64, 71, 70]),
  ...glyphs(' .,:;-–€()/+', [27, 36, 36, 36, 36, 49, 64, 72, 44, 44, 45, 70]),
]);
function textWidth(text, px, weight = 700) {
  let w = 0;
  for (const ch of String(text)) w += GLYPH.get(ch) ?? 75;
  return (w / 100) * px * (weight < 700 ? 0.97 : 1);
}

const LINE = 1.15;
const PLATE_X = 1; // the label sits on a plate of the court's own colour that hides the lines
const PLATE_Y = 1;

/** { name, sub, tight } when name (+ sub under it) fits inside a box of w × h px, else null. */
function fitIn(name, sub, w, h, nameSize, subSize, nameWeight = 700) {
  if (!name) return null;
  const width = Math.max(textWidth(name, nameSize, nameWeight), sub ? textWidth(sub, subSize, 600) : 0) + PLATE_X * 2;
  if (width > w - 1) return null;
  const height = nameSize * LINE + (sub ? subSize * LINE : 0);
  if (height + PLATE_Y * 2 <= h - 2) return { name, sub: sub || null, tight: false };
  if (height <= h - 0.5) return { name, sub: sub || null, tight: true };
  return null;
}

/** First text variant ('\n' = line break) that fits the box, or null. */
function fitText(variants, w, h, px, weight = 600, pad = 2) {
  for (const v of variants) {
    if (!v) continue;
    const lines = String(v).split('\n');
    if (Math.max(...lines.map((l) => textWidth(l, px, weight))) + pad * 2 <= w && lines.length * px * LINE <= h) return v;
  }
  return null;
}

/**
 * Label for every court (Map key → { name, sub, tight }). The second line (price, "Varattu",
 * "Sinun") wins over the long name; a kind uses full names only when all its courts fit one.
 * Courts outside the view ('other') get a small name only, and none at all on compact maps.
 */
function courtLabels(items, k, fs, compact) {
  const out = new Map();
  const groups = new Map();
  for (const item of items) {
    const key = `${item.geo.kind}:${item.state === 'other' ? 'other' : 'shown'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const [key, list] of groups) {
    const other = key.endsWith(':other');
    if (other && compact) continue;
    const size = other ? fs.small : fs.name;
    const weight = other ? 600 : 700;
    const sub = (item) => (other ? null : item.sub);
    const full = list.every((item) => fitIn(item.name, sub(item), item.geo.w * k, item.geo.h * k, size, fs.sub, weight));
    for (const item of list) {
      const tries = full ? [[item.name, sub(item)]] : [];
      tries.push([item.short, sub(item)], [item.short, null], [item.num, null]);
      for (const [name, second] of tries) {
        const label = fitIn(name, second, item.geo.w * k, item.geo.h * k, size, fs.sub, weight);
        if (label) {
          out.set(item.key, label);
          break;
        }
      }
    }
  }
  return out;
}

// ── Court data ───────────────────────────────────────────────────────────────

function courtItems(map, courts, states, labels) {
  const byMapId = new Map();
  for (const c of Array.isArray(courts) ? courts : []) {
    if (c && c.mapId && Object.prototype.hasOwnProperty.call(map.courts, c.mapId) && !byMapId.has(c.mapId)) byMapId.set(c.mapId, c);
  }
  const items = [];
  const add = (mapId, court) => {
    const geo = map.courts[mapId];
    const raw = court ? states?.[court.id] : null;
    const state = STATES.includes(raw) ? raw : 'other';
    const name = court?.name || geo.label;
    const custom = court ? labels?.[court.id] : null;
    const hasCustom = custom != null && custom !== '';
    const sub = state === 'other' ? null : (hasCustom ? String(custom) : DEFAULT_SUB[state] || null);
    items.push({
      key: mapId,
      geo,
      id: court ? court.id : null,
      state,
      name,
      short: court?.shortName || geo.short || name,
      num: (/(\d+)\s*$/.exec(name) || [])[1] || null,
      sub,
      subIsDefault: Boolean(sub) && !hasCustom,
      aria: `${name}, ${STATE_WORD[state] || ''}${sub && hasCustom ? `, ${sub}` : ''}`,
    });
  };
  // Courts in the caller's order (that's the tab order), then the map's courts nobody claimed.
  for (const [mapId, court] of byMapId) add(mapId, court);
  for (const mapId of Object.keys(map.courts)) if (!byMapId.has(mapId)) add(mapId, null);
  return items;
}

// ── Court drawings ───────────────────────────────────────────────────────────
// Each court's lines are drawn in its own little SVG (viewBox = its size in map units), laid
// out in a "vertical" frame — u across the court (W), v along it (L) — from the real
// dimensions in metres, then swapped for crosswise ('h') courts.

function courtLines(geo) {
  const vertical = geo.orientation !== 'h';
  const W = vertical ? geo.w : geo.h;
  const L = vertical ? geo.h : geo.w;
  const pt = vertical ? (u, v) => `${r1(u)} ${r1(v)}` : (u, v) => `${r1(v)} ${r1(u)}`;
  const seg = (u1, v1, u2, v2) => `M${pt(u1, v1)}L${pt(u2, v2)}`;
  const box = (u1, v1, u2, v2) => `M${pt(u1, v1)}L${pt(u2, v1)}L${pt(u2, v2)}L${pt(u1, v2)}Z`;
  const mid = L / 2;
  const cu = W / 2;

  if (geo.kind === 'sulka') {
    // 6.1 × 13.4 m with a little floor around it
    const u0 = W * 0.08;
    const v0 = L * 0.04;
    const u1 = W - u0;
    const v1 = L - v0;
    const short = 1.98 * ((v1 - v0) / 13.4);
    return {
      lines: box(u0, v0, u1, v1) + seg(u0, mid - short, u1, mid - short) + seg(u0, mid + short, u1, mid + short)
        + seg(cu, v0, cu, mid - short) + seg(cu, mid + short, cu, v1),
      net: seg(u0, mid, u1, mid),
    };
  }
  if (geo.kind === 'padel') {
    // 10 × 20 m glass box; service lines 6.95 m from the net
    const g = W * 0.05;
    const sv = 6.95 * (L / 20);
    return {
      lines: box(g, g, W - g, L - g) + seg(g, mid - sv, W - g, mid - sv) + seg(g, mid + sv, W - g, mid + sv)
        + seg(cu, mid - sv, cu, mid + sv),
      net: seg(g, mid, W - g, mid),
    };
  }
  if (geo.kind === 'squash') {
    // 6.4 × 9.75 m, front wall at the top; short line 5.44 m from it, 1.6 m service boxes
    const sx = W / 6.4;
    const sy = L / 9.75;
    const s = 5.44 * sy;
    return {
      lines: seg(0, s, W, s) + seg(cu, s, cu, L) + box(0, s, 1.6 * sx, s + 1.6 * sy) + box(W - 1.6 * sx, s, W, s + 1.6 * sy),
      net: seg(0, 0.6, W, 0.6),
    };
  }
  // tennis: 10.97 × 23.77 m doubles court inside an 18.3 × 36.6 m playing area
  const sx = W / 18.3;
  const sy = L / 36.6;
  const u0 = (W - 10.97 * sx) / 2;
  const v0 = (L - 23.77 * sy) / 2;
  const u1 = W - u0;
  const v1 = L - v0;
  const si = 1.37 * sx;
  const sv = 6.4 * sy;
  return {
    lines: box(u0, v0, u1, v1) + seg(u0 + si, v0, u0 + si, v1) + seg(u1 - si, v0, u1 - si, v1)
      + seg(u0 + si, mid - sv, u1 - si, mid - sv) + seg(u0 + si, mid + sv, u1 - si, mid + sv)
      + seg(cu, mid - sv, cu, mid + sv),
    net: seg(u0 - 0.9 * sx, mid, u1 + 0.9 * sx, mid),
  };
}

const linesCache = new WeakMap();
function CourtLines({ geo }) {
  let art = linesCache.get(geo);
  if (!art) {
    art = courtLines(geo);
    linesCache.set(geo, art);
  }
  return (
    <svg className="bmap-court-lines" viewBox={`0 0 ${geo.w} ${geo.h}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={art.lines} />
      <path className="bmap-court-net" d={art.net} />
    </svg>
  );
}

function Court({ item, label, view, onSelect }) {
  const { geo, state } = item;
  const interactive = (state === 'free' || state === 'selected') && typeof onSelect === 'function';
  const className = cx('bmap-court', `bmap-court--${geo.kind}`, `is-${state}`, interactive && 'is-interactive');
  const style = place(view, geo.x, geo.y, geo.w, geo.h);
  const body = (
    <>
      <CourtLines geo={geo} />
      {label && (
        <span className={cx('bmap-court-label', label.tight && 'is-tight')} aria-hidden="true">
          <span className="bmap-court-name">{label.name}</span>
          {label.sub && <span className={cx('bmap-court-sub', state === 'mine' && item.subIsDefault && 'is-mine')}>{label.sub}</span>}
        </span>
      )}
    </>
  );
  if (interactive) {
    return (
      <button
        type="button"
        className={className}
        style={style}
        aria-label={item.aria}
        aria-pressed={state === 'selected'}
        onClick={() => onSelect(item.id)}
      >
        {body}
      </button>
    );
  }
  if (state === 'other') return <div className={className} style={style} aria-hidden="true">{body}</div>;
  return <div className={className} style={style} role="img" aria-label={item.aria}>{body}</div>;
}

// ── The plan ─────────────────────────────────────────────────────────────────

/** CSS variables that place an element over the map rect (x, y, w, h) in map units. */
function place([vx, vy, vw, vh], x, y, w, h) {
  return { '--l': pct((x - vx) / vw), '--t': pct((y - vy) / vh), '--w': pct(w / vw), '--h': pct(h / vh) };
}

const ARROW = 'M0 4V30M-6 11L0 4L6 11'; // points up, tip just outside a wall at y = 0
const ROTATE = { up: 0, right: 90, down: 180, left: -90 };

function Entrance({ x, y, dir }) {
  const across = dir === 'left' || dir === 'right';
  return (
    <g>
      <path className="bmap-door" d={across ? `M${x} ${y - 12}V${y + 12}` : `M${x - 12} ${y}H${x + 12}`} />
      <path className="bmap-arrow" d={ARROW} transform={`translate(${x} ${y}) rotate(${ROTATE[dir] ?? 0})`} />
    </g>
  );
}

function Plan({ map }) {
  const of = (type) => map.features.filter((f) => f.type === type);
  const buildings = of('building');
  const radius = (b) => b.r ?? 4;
  return (
    <svg className="bmap-svg" viewBox={map.viewBox.join(' ')} aria-hidden="true" focusable="false">
      {of('road').map((f, i) => <rect key={`road${i}`} className="bmap-road" x={f.x} y={f.y} width={f.w} height={f.h} />)}
      {of('path').map((f, i) => (
        <path key={`path${i}`} className="bmap-path" strokeWidth={f.width} d={f.points.map(([px, py], j) => `${j ? 'L' : 'M'}${px} ${py}`).join('')} />
      ))}
      {of('trees').map((f, i) => (
        <g key={`trees${i}`} className="bmap-trees">
          {f.points.map(([tx, ty, tr]) => <circle key={`${tx}-${ty}`} cx={tx} cy={ty} r={tr} />)}
        </g>
      ))}
      {/* Walls are stroked double width and then covered by the floors, so buildings that
          touch (hall + corridor + annex) share one outline. */}
      <g className="bmap-walls">
        {buildings.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={radius(b)} />)}
      </g>
      <g className="bmap-floor">
        {buildings.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={radius(b)} />)}
      </g>
      {of('room').map((f, i) => <rect key={`room${i}`} className="bmap-room" x={f.x} y={f.y} width={f.w} height={f.h} rx="2" />)}
      {(map.entrances || []).map((e, i) => <Entrance key={`door${i}`} {...e} />)}
    </svg>
  );
}

/** Text on the plan (rooms, buildings, street, entrances) as HTML over the SVG. */
function planLabels(map, compact) {
  const out = [];
  map.features.forEach((f, i) => {
    if (!f.label || (compact && f.level !== 1)) return;
    out.push({
      key: `f${i}`, kind: f.type, variants: [f.label, ...(f.labelAlts || [])],
      box: f.box || [f.x, f.y, f.w, f.h], vertical: Boolean(f.vertical), align: f.align,
    });
  });
  (map.entrances || []).forEach((e, i) => {
    out.push({ key: `e${i}`, kind: 'entrance', variants: [e.label, ...(e.labelAlts || [])], box: e.box, align: e.align });
  });
  return out;
}

function PlanLabel({ label, view, k, fs }) {
  const [x, y, w, h] = label.box;
  const bold = label.kind === 'entrance' || label.kind === 'building';
  const text = fitText(label.variants, (label.vertical ? h : w) * k, (label.vertical ? w : h) * k, fs.small, bold ? 700 : 600);
  if (!text) return null;
  return (
    <span
      className={cx('bmap-label', `bmap-label--${label.kind}`, label.vertical && 'is-vertical', label.align && `is-${label.align}`)}
      style={place(view, x, y, w, h)}
      aria-hidden="true"
    >
      <span className="bmap-label-text">{text}</span>
    </span>
  );
}

function Legend({ items }) {
  const entries = [['free', 'Vapaa'], ['busy', 'Varattu'], ['selected', 'Valittu']];
  if (items.some((i) => i.state === 'mine')) entries.push(['mine', 'Sinun']);
  return (
    <ul className="bmap-legend" aria-hidden="true">
      {entries.map(([state, text]) => (
        <li key={state} className="bmap-legend-item">
          <span className={`bmap-swatch is-${state}`} />
          {text}
        </li>
      ))}
    </ul>
  );
}

// ── The map ──────────────────────────────────────────────────────────────────

/**
 * Floor map of a booking location.
 * @param {{
 *   mapKey: string,                       'lahti-janus' | 'lahti-kispi' | 'lahti-kisapuisto'
 *   courts?: Array<{ id: string, name: string, shortName?: string, sport?: string, mapId?: string|null }>,
 *   states?: Record<string, 'free'|'busy'|'mine'|'selected'|'closed'>,   missing = 'other' (not in this view)
 *   labels?: Record<string, string>,      second line under the court name (price, time …)
 *   onSelect?: (courtId: string) => void, only 'free' and 'selected' courts are tappable
 *   compact?: boolean,                    no legend, no labels on 'other' courts or minor rooms
 *   className?: string,
 * }} props
 * Courts are placed by `mapId`; a court whose mapId isn't on the map isn't drawn, and map
 * courts nobody claims are drawn as 'other' with the map's own label. Renders nothing for an
 * unknown mapKey (check with hasVenueMap first).
 */
export function VenueMap({ mapKey, courts, states, labels, onSelect, compact = false, className }) {
  const map = hasVenueMap(mapKey) ? VENUE_MAPS[mapKey] : null;
  const canvas = useRef(null);
  const width = useWidth(canvas, mapKey);
  const items = useMemo(() => (map ? courtItems(map, courts, states, labels) : []), [map, courts, states, labels]);
  if (!map) return null;

  const view = map.viewBox;
  const px = width || 320; // before the first measurement: assume a phone
  const k = px / view[2];
  const fs = typeScale(px);
  const texts = courtLabels(items, k, fs, compact);
  const vars = {
    '--bmap-ar': `${view[2]} / ${view[3]}`,
    '--bmap-ratio': (view[2] / view[3]).toFixed(3),
    '--bmap-fs-name': `${fs.name}px`,
    '--bmap-fs-sub': `${fs.sub}px`,
    '--bmap-fs-small': `${fs.small}px`,
    '--bmap-fs-place': `${fs.place}px`,
  };

  return (
    <figure className={cx('bmap', compact && 'bmap--compact', className)} style={vars} aria-label={`${map.title}, kenttäkartta`}>
      <div ref={canvas} className="bmap-canvas">
        <Plan map={map} />
        {map.place && (
          <span className="bmap-place" style={place(view, ...map.place.box)} aria-hidden="true">
            <span className="bmap-place-name">{map.place.label}</span>
            {map.place.tag && <span className="bmap-place-tag">{map.place.tag}</span>}
          </span>
        )}
        {planLabels(map, compact).map((label) => <PlanLabel key={label.key} label={label} view={view} k={k} fs={fs} />)}
        {items.map((item) => <Court key={item.key} item={item} label={texts.get(item.key)} view={view} onSelect={onSelect} />)}
      </div>
      {!compact && <Legend items={items} />}
    </figure>
  );
}
