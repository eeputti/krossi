// illustrations.jsx — empty-state and hero illustrations for the Krossi web app.
//
//   <Illustration name="court" />                 168 px wide (height follows the 5:4 viewBox)
//   <Illustration name="chat" size={120} className="inbox-empty-art" />
//
// Every piece is inline SVG on the same 200×160 canvas: a sand backdrop blob, flat shapes in
// the Krossi palette, green-800 outlines at 2.25 (details 2, strings 1.5) with round caps, and a
// soft ground shadow. Each one has a single idle animation, driven by an `ill-*` class from
// styles/illustrations.css (switched off under prefers-reduced-motion). The SVG is decorative:
// the surrounding EmptyState carries the actual message, so it is always aria-hidden.
//
// Animated groups never carry a `transform` attribute themselves — a CSS transform would
// replace it — so positioning transforms always live on an inner element.

const INK = 'var(--green-800)';
const INK_SOFT = 'var(--green-700)';
const LIME = 'var(--lime)';
const CLAY = 'var(--clay)';
const SAND = 'var(--sand)';
const WHITE = '#fff';

const VIEW_W = 200;
const VIEW_H = 160;

const round = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

// Soft, slightly lopsided blob behind every illustration — the common "stage".
function Backdrop() {
  return <path d="M100 20c35 0 66 21 66 56s-25 62-66 62-68-25-68-59 33-59 68-59z" fill={SAND} stroke="none" />;
}

function Shadow({ x = 100, y, rx, ry = 4, className }) {
  return <ellipse className={className} cx={x} cy={y} rx={rx} ry={ry} fill={INK} fillOpacity=".1" stroke="none" />;
}

// Tennis ball: lime disc and the two classic seams, tilted so the ball never looks static.
function Ball({ x, y, r, tilt = -28, className }) {
  const sx = round(r * 0.62);
  const sy = round(r * 0.78);
  const q = round(r * 0.12);
  const seams = `M${round(x - sx)} ${round(y - sy)}Q${round(x - q)} ${y} ${round(x - sx)} ${round(y + sy)}`
    + `M${round(x + sx)} ${round(y - sy)}Q${round(x + q)} ${y} ${round(x + sx)} ${round(y + sy)}`;
  return (
    <g className={className}>
      <circle cx={x} cy={y} r={r} fill={LIME} />
      <path d={seams} strokeWidth="2" transform={`rotate(${tilt} ${x} ${y})`} />
    </g>
  );
}

// Four-point sparkle with concave sides.
function Sparkle({ x, y, r = 7, className }) {
  const k = round(r * 0.22);
  const d = `M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}`
    + `Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}z`;
  return <path className={className} d={d} fill={LIME} strokeWidth="2" />;
}

// Confetti strip. The wrapper <g> takes the CSS animation; the rect keeps its own rotation.
function Confetti({ x, y, angle, fill = CLAY }) {
  return (
    <g>
      <rect x={x - 4.5} y={y - 2} width="9" height="4" rx="1.5" fill={fill} stroke="none" transform={`rotate(${angle} ${x} ${y})`} />
    </g>
  );
}

function Dot({ x, y, r = 3, fill = CLAY, className }) {
  return <circle className={className} cx={x} cy={y} r={r} fill={fill} stroke="none" />;
}

// Chords of an ellipse, used for racket strings so the head needs no clipPath (and no ids).
function ellipseChords(cx, cy, rx, ry, xs, ys) {
  const parts = [];
  for (const dx of xs) {
    const h = ry * Math.sqrt(1 - (dx / rx) ** 2);
    parts.push(`M${round(cx + dx)} ${round(cy - h)}V${round(cy + h)}`);
  }
  for (const dy of ys) {
    const w = rx * Math.sqrt(1 - (dy / ry) ** 2);
    parts.push(`M${round(cx - w)} ${round(cy + dy)}H${round(cx + w)}`);
  }
  return parts.join('');
}

const RACKET_STRINGS = ellipseChords(0, -36, 14.5, 19.5, [-7.5, 0, 7.5], [-11, -3.5, 4, 11.5]);

// Racket drawn upright with its origin where the throat meets the grip; place it with
// `transform`. Frame and grip colours vary so two rackets side by side read as a pair.
function Racket({ transform, frame = CLAY, grip = INK }) {
  return (
    <g transform={transform}>
      <path d="M-9-15L-3.5 0h7L9-15z" fill={frame} />
      <rect x="-4.5" y="0" width="9" height="34" rx="3" fill={grip} />
      <rect x="-6" y="32" width="12" height="6" rx="3" fill={frame} />
      <ellipse cx="0" cy="-36" rx="19" ry="24" fill={frame} />
      <ellipse cx="0" cy="-36" rx="14.5" ry="19.5" fill={WHITE} strokeWidth="2" />
      <path d={RACKET_STRINGS} strokeWidth="1.5" opacity=".4" />
    </g>
  );
}

// ---------------------------------------------------------------------------------------------
// The illustrations
// ---------------------------------------------------------------------------------------------

// Court in perspective: far baseline y 50, near baseline y 128, net at the projected midpoint
// (y ≈ 77). Singles sidelines and service lines follow the same projection.
function Court() {
  return (
    <>
      <path d="M62 50h76l36 78H26z" fill={CLAY} />
      <path d="M71.5 50L44.5 128M128.5 50l27 78M68 60.4h64M54.5 99.2h91M100 60.4v38.8" stroke={WHITE} strokeWidth="2" />
      <path d="M48 64h104v13H48z" fill={INK} opacity=".14" stroke="none" />
      <path d="M56 65v12M64 65v12M72 65v12M80 65v12M88 65v12M96 65v12M104 65v12M112 65v12M120 65v12M128 65v12M136 65v12M144 65v12M48 71h104" strokeWidth="1.5" opacity=".35" />
      <path d="M48 77V62M152 77V62" />
      <rect x="46" y="61.5" width="108" height="4.5" rx="2.25" fill={WHITE} strokeWidth="2" />
      <Shadow x={122} y={96} rx={8} ry={2.2} />
      <Ball className="ill-hop" x={122} y={88} r={8} />
      <Sparkle x={44} y={38} r={6} />
      <Dot x={160} y={36} />
    </>
  );
}

function BallArt() {
  return (
    <>
      <Shadow className="ill-squash" y={125} rx={24} ry={4.5} />
      <Ball className="ill-bounce" x={100} y={74} r={24} />
      <Sparkle x={50} y={46} r={7} />
      <Dot x={152} y={50} fill={LIME} r={4} />
      <Dot x={146} y={98} r={3} />
    </>
  );
}

function Chat() {
  return (
    <>
      <Shadow y={138} rx={52} ry={4} />
      <path d="M50 30h56a16 16 0 0 1 16 16v20a16 16 0 0 1-16 16H58l-16 13 3-13.8A16 16 0 0 1 34 66V46a16 16 0 0 1 16-16z" fill={LIME} />
      <path d="M52 50h46M52 62h28" strokeWidth="2.5" />
      <path d="M96 70h54a16 16 0 0 1 16 16v12A16 16 0 0 1 155 113.2l3 13.8-16-13H96a16 16 0 0 1-16-16V86a16 16 0 0 1 16-16z" fill={WHITE} />
      <g className="ill-typing" fill={INK} stroke="none">
        <circle cx="107" cy="92" r="4.5" />
        <circle cx="123" cy="92" r="4.5" />
        <circle cx="139" cy="92" r="4.5" />
      </g>
      <Sparkle x={156} y={40} r={6} />
      <Dot x={38} y={118} />
    </>
  );
}

function Players() {
  return (
    <>
      <Shadow y={132} rx={40} />
      <Racket transform="translate(100 102) rotate(-36) translate(0 -12)" frame={CLAY} grip={INK} />
      <Racket transform="translate(100 102) rotate(36) translate(0 -12)" frame={INK_SOFT} grip={LIME} />
      <Ball className="ill-bob" x={100} y={36} r={10} />
      <Dot x={48} y={104} />
      <Sparkle x={156} y={96} r={6} />
    </>
  );
}

const CALENDAR_CELLS = [64, 82, 100, 118, 136].flatMap((x) => [76, 94, 112].map((y) => [x, y]))
  .filter(([x, y]) => !(x === 118 && y === 94));

function Calendar() {
  return (
    <>
      <Shadow y={136} rx={52} />
      <g transform="rotate(-3 100 82)">
        <rect x="46" y="34" width="108" height="96" rx="12" fill={WHITE} />
        <path d="M46 58V46a12 12 0 0 1 12-12h84a12 12 0 0 1 12 12v12z" fill={INK} />
        <path d="M62 46h28" stroke={LIME} strokeWidth="3" />
        <rect x="72" y="26" width="8" height="16" rx="4" fill={WHITE} />
        <rect x="120" y="26" width="8" height="16" rx="4" fill={WHITE} />
        <g fill={SAND} stroke="none">
          {CALENDAR_CELLS.map(([x, y]) => <rect key={`${x}-${y}`} x={x - 6} y={y - 5} width="12" height="10" rx="3" />)}
        </g>
        <circle className="ill-ping" cx="118" cy="94" r="12" stroke={CLAY} strokeWidth="2" />
        <Ball x={118} y={94} r={9} />
      </g>
      <Sparkle x={166} y={46} r={6} />
    </>
  );
}

function Trophy() {
  return (
    <>
      <Shadow y={119} rx={34} />
      <Ball x={100} y={34} r={13} tilt={-40} />
      <path d="M70 46h-7a10 10 0 0 0 0 20h9M130 46h7a10 10 0 0 1 0 20h-9" strokeWidth="2.5" />
      <path d="M70 38h60v14c0 22-14 36-30 36S70 74 70 52z" fill={CLAY} />
      <path d="M80 50c0 9 3 17 9 22" stroke={WHITE} strokeWidth="2.5" opacity=".7" />
      <rect x="94" y="87" width="12" height="15" fill={CLAY} />
      <rect x="78" y="102" width="44" height="14" rx="4" fill={INK} />
      <path d="M92 109h16" stroke={LIME} strokeWidth="2.5" />
      <g className="ill-twinkle">
        <Sparkle x={52} y={34} r={7} />
        <Sparkle x={150} y={28} r={6} />
        <Sparkle x={152} y={82} r={5} />
      </g>
    </>
  );
}

function League() {
  return (
    <>
      <Shadow y={130} rx={62} />
      <rect x="46" y="84" width="36" height="44" rx="3" fill={WHITE} />
      <rect x="118" y="98" width="36" height="30" rx="3" fill={CLAY} />
      <rect x="82" y="64" width="36" height="64" rx="3" fill={LIME} />
      <path d="M96 77.5l5-3.5v16M59 98a5 5 0 0 1 10 0c0 4-5 6-10 10h10M131 107h10l-5 5.5a4.5 4.5 0 1 1-5 5" strokeWidth="2.5" />
      <path d="M100 64V30" />
      <path className="ill-flag" d="M100 31l22 7-22 7z" fill={CLAY} />
      <Ball x={136} y={91} r={7} tilt={20} />
      <Sparkle x={58} y={58} r={6} />
      <Dot x={160} y={64} fill={LIME} r={3.5} />
    </>
  );
}

function Search() {
  return (
    <>
      <Shadow y={136} rx={56} />
      <rect x="36" y="64" width="128" height="68" rx="10" fill={CLAY} />
      <path d="M50 64v54h114M64 64v40h100M64 84h40M104 64v40" stroke={WHITE} strokeWidth="2" />
      <g className="ill-scan">
        <g transform="translate(138 92) rotate(-45)">
          <rect x="-5.5" y="0" width="11" height="30" rx="5.5" fill={INK} />
        </g>
        <circle cx="118" cy="72" r="20" fill={WHITE} opacity=".7" stroke="none" />
        <path d="M118 46a26 26 0 1 1 0 52 26 26 0 0 1 0-52zm0 6a20 20 0 1 0 0 40 20 20 0 0 0 0-40z" fill={LIME} fillRule="evenodd" />
        <path d="M106 64a14 14 0 0 1 10-7" stroke={WHITE} strokeWidth="2.5" />
      </g>
      <Sparkle x={52} y={42} r={7} />
      <Dot x={156} y={40} fill={LIME} r={3.5} />
    </>
  );
}

function Lock() {
  return (
    <>
      <Shadow y={136} rx={42} />
      <g className="ill-jiggle">
        <path d="M78 74V54a22 22 0 0 1 44 0v20" strokeWidth="11" />
        <path d="M78 74V54a22 22 0 0 1 44 0v20" stroke={WHITE} strokeWidth="6.5" />
        <rect x="62" y="70" width="76" height="60" rx="14" fill={INK_SOFT} />
        <Ball x={100} y={100} r={14} tilt={0} />
        <path d="M100 93.5a3.5 3.5 0 0 1 1.8 6.5l1.2 6.5h-6l1.2-6.5a3.5 3.5 0 0 1 1.8-6.5z" fill={INK} stroke="none" />
      </g>
      <Sparkle x={54} y={48} r={7} />
      <Sparkle x={150} y={36} r={5} />
      <Dot x={154} y={86} fill={LIME} r={3.5} />
    </>
  );
}

function Mail() {
  return (
    <>
      <Shadow y={136} rx={52} />
      <g className="ill-float">
        <rect x="44" y="50" width="112" height="74" rx="9" fill={WHITE} />
        <path d="M48 120l36-28M152 120l-36-28" strokeWidth="2" opacity=".35" />
        <path d="M47 55l53 37 53-37" />
        <Ball x={100} y={90} r={12} />
      </g>
      <Sparkle x={160} y={40} r={7} />
      <Dot x={40} y={40} fill={LIME} r={3.5} />
      <Dot x={34} y={104} />
    </>
  );
}

function Celebrate() {
  return (
    <>
      <Shadow y={132} rx={24} />
      <path d="M100 52v-9M120.6 59.5l5.8-6.9M79.4 59.5l-5.8-6.9M130.9 75.7l8.7-2.3M69.1 75.7l-8.7-2.3" />
      <Ball x={100} y={84} r={22} />
      <g className="ill-confetti">
        <Confetti x={80} y={33} angle={30} />
        <Dot x={124} y={32} r={3.5} fill={LIME} />
        <Confetti x={152} y={56} angle={-20} fill={LIME} />
        <path d="M140 100c4-5 8 1 12-4s8 1 12-4" stroke={CLAY} strokeWidth="2.5" />
        <Dot x={146} y={120} r={3} fill={INK} />
        <path d="M36 98c4-5 8 1 12-4s8 1 12-4" stroke={LIME} strokeWidth="2.5" />
        <Confetti x={54} y={118} angle={-35} />
        <Dot x={48} y={60} r={3} />
        <Sparkle x={160} y={32} r={6} />
        <Sparkle x={42} y={36} r={5} />
      </g>
    </>
  );
}

function MapArt() {
  return (
    <>
      <Shadow y={136} rx={60} />
      <path d="M36 50l40-8 48 8 40-8v76l-40 8-48-8-40 8z" fill={WHITE} />
      <path d="M44 100c10-6 20-2 28-8M132 68c8 4 16 0 24-6M134 106h18" stroke={SAND} strokeWidth="5" />
      <rect x="84" y="56" width="32" height="54" rx="3" fill={CLAY} stroke="none" />
      <path d="M89 56v54M111 56v54M89 69h22M89 97h22M100 69v28" stroke={WHITE} strokeWidth="1.5" />
      <path d="M84 83h32" stroke={WHITE} strokeWidth="2.5" />
      <path d="M76 42v76M124 50v76" />
      <Shadow className="ill-bob-shadow" y={84} rx={7} ry={2.5} />
      <g className="ill-bob">
        <path d="M100 82c-1 0-18-17-18-30a18 18 0 0 1 36 0c0 13-17 30-18 30z" fill={INK} />
        <Ball x={100} y={52} r={9} />
      </g>
      <Sparkle x={162} y={30} r={6} />
    </>
  );
}

// The swing pivots on the butt of the grip (61, 134); the trail arcs share that centre.
function RacketArt() {
  return (
    <>
      <Shadow x={92} y={138} rx={40} />
      <path d="M38.3 44.7A92 92 0 0 1 70.2 42.5M37.1 61.7A76 76 0 0 1 65.9 58.2M38.1 78.4A60 60 0 0 1 60.6 74" strokeWidth="2.5" opacity=".35" />
      <g className="ill-swing">
        <Racket transform="translate(84 104) rotate(38)" frame={CLAY} grip={INK} />
      </g>
      <path d="M132 62l10-7M137 72l10-7" strokeWidth="2.5" opacity=".35" />
      <Ball x={152} y={46} r={10} />
      <Dot x={160} y={84} fill={LIME} r={3.5} />
      <Sparkle x={150} y={112} r={6} />
    </>
  );
}

function Wave() {
  return (
    <>
      <Shadow y={138} rx={30} />
      <path d="M54 36c-6 6-9 14-9 22M62 46c-3 3-5 7-5 12M146 36c6 6 9 14 9 22M138 46c3 3 5 7 5 12" strokeWidth="2.5" opacity=".35" />
      <g className="ill-hand">
        <rect x="-7" y="-27" width="14" height="33" rx="7" fill={WHITE} transform="translate(79 96) rotate(-50)" />
        <rect x="73" y="38" width="13" height="42" rx="6.5" fill={WHITE} transform="rotate(-4 79.5 80)" />
        <rect x="86.7" y="30" width="13" height="50" rx="6.5" fill={WHITE} transform="rotate(-2 93 80)" />
        <rect x="100.4" y="34" width="13" height="46" rx="6.5" fill={WHITE} transform="rotate(4 107 80)" />
        <rect x="114" y="44" width="13" height="36" rx="6.5" fill={WHITE} transform="rotate(7 120.5 80)" />
        <path d="M72 66v28c0 14 12 24 28 24s28.5-10 28.5-24V66" fill={WHITE} />
        <rect x="80" y="114" width="40" height="18" rx="5" fill={LIME} />
        <path d="M84 123h32" stroke={CLAY} strokeWidth="3" />
      </g>
      <Sparkle x={160} y={84} r={6} />
      <Dot x={44} y={90} />
    </>
  );
}

const ART = {
  court: Court,
  ball: BallArt,
  chat: Chat,
  players: Players,
  calendar: Calendar,
  trophy: Trophy,
  league: League,
  search: Search,
  lock: Lock,
  mail: Mail,
  celebrate: Celebrate,
  map: MapArt,
  racket: RacketArt,
  wave: Wave,
};

export const ILLUSTRATION_NAMES = Object.freeze(Object.keys(ART));

/**
 * Decorative illustration for empty states, heroes and sheets.
 * @param {{ name: string, size?: number, className?: string }} props
 *   name       one of ILLUSTRATION_NAMES; an unknown name falls back to 'ball' so an empty
 *              state never renders a hole (and warns in development builds).
 *   size       rendered width in px (default 168); height keeps the 5:4 canvas ratio.
 *   className  extra classes for the <svg> (e.g. sizing or margins from the screen's CSS).
 */
export function Illustration({ name, size = 168, className }) {
  let key = name;
  if (!ART[key]) {
    if (process.env.NODE_ENV !== 'production') console.warn(`Illustration: tuntematon nimi "${name}"`);
    key = 'ball';
  }
  const Art = ART[key];
  const classes = ['ill', `ill--${key}`, className].filter(Boolean).join(' ');
  return (
    <svg
      className={classes}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width={size}
      height={Math.round((size * VIEW_H) / VIEW_W)}
      aria-hidden="true"
    >
      <g fill="none" stroke={INK} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
        <Backdrop />
        <Art />
      </g>
    </svg>
  );
}

// What each piece is meant for — shown only in the QA gallery below.
const USAGE = {
  court: 'Ei vielä pelejä',
  ball: 'Lataus / yleinen',
  chat: 'Ei viestejä',
  players: 'Ei pelaajia',
  calendar: 'Ei tulevia pelejä',
  trophy: 'Merkit / tulokset tyhjät',
  league: 'Ei liigoja',
  search: 'Ei hakutuloksia suodattimilla',
  lock: 'Maksumuuri',
  mail: 'Kutsut / pyynnöt',
  celebrate: 'Onnistui!',
  map: 'Kartta tyhjä',
  racket: 'Luo peli',
  wave: 'Tervetuloa / onboarding',
};

/** Every illustration in a labelled grid — for visual QA only, not used by the app's screens. */
export function IllustrationGallery({ size = 168 }) {
  return (
    <div className="ill-gallery">
      {ILLUSTRATION_NAMES.map((name) => (
        <figure key={name} className="ill-gallery-item">
          <Illustration name={name} size={size} />
          <figcaption className="ill-gallery-label">
            <code>{name}</code>
            <span>{USAGE[name]}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
