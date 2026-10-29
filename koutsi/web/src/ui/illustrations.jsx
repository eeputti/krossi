// illustrations.jsx — empty-state and hero illustrations for the Krossi web app.
//
//   <Illustration name="court" />                 168 px wide (height follows the 5:4 viewBox)
//   <Illustration name="chat" size={120} className="inbox-empty-art" />
//
// Every piece is inline SVG on the same 200×160 canvas: one object, drawn flat and geometric
// on a light grey disc. Solid near-black shapes, white or grey paper, the lime tennis ball as
// the only accent; no outlines around fills, no sparkles or confetti, and no idle motion.
// Colours come from the --ill-* custom properties in styles/illustrations.css, which flip on
// dark surfaces (.on-dark) so the same art works on the paywall sheet and the dark heroes.
// The SVG is decorative: the surrounding EmptyState carries the actual message, so it is
// always aria-hidden.

const INK = 'var(--ill-ink)';          // solid shapes
const ON_INK = 'var(--ill-on-ink)';    // lines drawn on top of an INK shape
const PAPER = 'var(--ill-paper)';      // envelopes, calendar sheet, map panels
const PAPER_2 = 'var(--ill-paper-2)';  // the shaded side of a folded paper
const MID = 'var(--ill-mid)';          // quiet details (calendar cells, podium places)
const STAGE = 'var(--ill-stage)';      // the disc every piece sits on
const LIME = 'var(--lime)';
const ON_LIME = 'var(--ink)';          // lime stays lime on dark too, so its details stay dark

const VIEW_W = 200;
const VIEW_H = 160;

const round = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

function Stage() {
  return <circle cx="100" cy="80" r="60" fill={STAGE} />;
}

// Tennis ball: lime disc and the two classic seams, tilted so it never looks like a plain dot.
function Ball({ x, y, r, tilt = -28 }) {
  const sx = round(r * 0.62);
  const sy = round(r * 0.78);
  const q = round(r * 0.12);
  const seams = `M${round(x - sx)} ${round(y - sy)}Q${round(x - q)} ${y} ${round(x - sx)} ${round(y + sy)}`
    + `M${round(x + sx)} ${round(y - sy)}Q${round(x + q)} ${y} ${round(x + sx)} ${round(y + sy)}`;
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={LIME} />
      <path d={seams} stroke={ON_LIME} strokeWidth={round(Math.max(1.5, r * 0.09))} transform={`rotate(${tilt} ${x} ${y})`} />
    </g>
  );
}

// Head and shoulders, centred on (x, y) inside a 26-px avatar disc.
function Person({ x, y, fill }) {
  return (
    <g fill={fill} stroke="none">
      <circle cx={x} cy={y - 8} r="8" />
      <path d={`M${x - 13} ${y + 17}a13 12 0 0 1 26 0z`} />
    </g>
  );
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

const RACKET_STRINGS = ellipseChords(100, 56, 18, 24, [-10, -5, 0, 5, 10], [-15, -7.5, 0, 7.5, 15]);

// ---------------------------------------------------------------------------------------------
// The illustrations
// ---------------------------------------------------------------------------------------------

// A court seen from above, turned a little, with a ball waiting outside the right sideline.
function Court() {
  return (
    <>
      <g transform="rotate(-12 100 80)">
        <rect x="66" y="22" width="68" height="116" rx="4" fill={INK} />
        <g stroke={ON_INK} strokeWidth="2">
          <rect x="72" y="28" width="56" height="104" />
          <path d="M72 52h56M72 108h56M100 52v56" />
        </g>
        <path d="M66 80h68" stroke={ON_INK} strokeWidth="3.5" />
      </g>
      <Ball x={150} y={62} r={8} />
    </>
  );
}

function BallArt() {
  return <Ball x={100} y={80} r={30} />;
}

function Chat() {
  return (
    <>
      <path d="M60 38h52a14 14 0 0 1 14 14v14a14 14 0 0 1-14 14H72l-14 10 2-10a14 14 0 0 1-14-14V52a14 14 0 0 1 14-14z" fill={INK} />
      <path d="M62 54h44M62 66h26" stroke={ON_INK} strokeWidth="4" />
      <path d="M98 88h44a14 14 0 0 1 14 14v6a14 14 0 0 1-14 14l4 10-16-10H98a14 14 0 0 1-14-14v-6a14 14 0 0 1 14-14z" fill={LIME} />
      <g fill={ON_LIME}>
        <circle cx="108" cy="105" r="3.5" />
        <circle cx="120" cy="105" r="3.5" />
        <circle cx="132" cy="105" r="3.5" />
      </g>
    </>
  );
}

// Two avatars side by side: a player and a partner.
function Players() {
  return (
    <>
      <circle cx="79" cy="80" r="25" fill={INK} />
      <Person x={79} y={80} fill={ON_INK} />
      <circle cx="121" cy="80" r="28.5" fill={STAGE} />
      <circle cx="121" cy="80" r="25" fill={LIME} />
      <Person x={121} y={80} fill={ON_LIME} />
    </>
  );
}

const CALENDAR_CELLS = [73, 91, 109, 127].flatMap((x) => [76, 92, 108].map((y) => [x, y]));

function Calendar() {
  return (
    <>
      <rect x="60" y="40" width="80" height="80" rx="8" fill={PAPER} />
      <path d="M60 62V48a8 8 0 0 1 8-8h64a8 8 0 0 1 8 8v14z" fill={INK} />
      <rect x="77" y="32" width="6" height="16" rx="3" fill={INK} />
      <rect x="117" y="32" width="6" height="16" rx="3" fill={INK} />
      {CALENDAR_CELLS.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x - 6} y={y - 5} width="12" height="10" rx="2.5" fill={x === 109 && y === 92 ? LIME : MID} />
      ))}
    </>
  );
}

function Trophy() {
  return (
    <>
      <path d="M72 46h-6a9 9 0 0 0 0 18h7M128 46h6a9 9 0 0 1 0 18h-7" stroke={INK} strokeWidth="5" />
      <path d="M72 40h56v12c0 19-12.5 31-28 31S72 71 72 52z" fill={INK} />
      <rect x="95" y="82" width="10" height="17" fill={INK} />
      <rect x="78" y="98" width="44" height="13" rx="3" fill={INK} />
      <Ball x={100} y={31} r={10} tilt={-40} />
    </>
  );
}

// A podium: first place in black with the ball on top, second and third in grey.
function League() {
  return (
    <>
      <rect x="52" y="84" width="31" height="36" rx="2" fill={MID} />
      <rect x="84.5" y="64" width="31" height="56" rx="2" fill={INK} />
      <rect x="117" y="96" width="31" height="24" rx="2" fill={MID} />
      <Ball x={100} y={51} r={10} tilt={20} />
    </>
  );
}

function Search() {
  return (
    <>
      <path d="M111 91l20 20" stroke={INK} strokeWidth="11" />
      <circle cx="92" cy="72" r="25" fill={PAPER} stroke={INK} strokeWidth="7" />
      <Ball x={92} y={72} r={10} />
    </>
  );
}

function Lock() {
  return (
    <>
      <path d="M80 74V58a20 20 0 0 1 40 0v16" stroke={INK} strokeWidth="8" />
      <rect x="64" y="70" width="72" height="54" rx="10" fill={INK} />
      <circle cx="100" cy="92" r="6" fill={LIME} />
      <rect x="97.5" y="94" width="5" height="14" rx="2.5" fill={LIME} />
    </>
  );
}

function Mail() {
  return (
    <>
      <rect x="56" y="50" width="88" height="62" rx="8" fill={PAPER} />
      <path d="M62 106l26-19M138 106l-26-19" stroke={MID} strokeWidth="2" />
      <path d="M61 56l39 28 39-28" stroke={INK} strokeWidth="2.5" />
      <Ball x={100} y={84} r={8} tilt={0} />
    </>
  );
}

// "Done": the lime check disc inside a quiet ring.
function Celebrate() {
  return (
    <>
      <circle cx="100" cy="80" r="44" stroke={MID} strokeWidth="2" />
      <circle cx="100" cy="80" r="30" fill={LIME} />
      <path d="M86 80.5l9.5 9.5L115 70.5" stroke={ON_LIME} strokeWidth="6" />
    </>
  );
}

function MapArt() {
  return (
    <>
      <path d="M58 54l26-7v68l-26 7z" fill={PAPER} />
      <path d="M84 47l32 7v68l-32-7z" fill={PAPER_2} />
      <path d="M116 54l26-7v68l-26 7z" fill={PAPER} />
      <path d="M66 106c10-6 18 0 26-4s16-10 26-8" stroke={MID} strokeWidth="2.5" strokeDasharray="1 6" />
      <path d="M100 101c-2 0-17-15-17-27a17 17 0 0 1 34 0c0 12-15 27-17 27z" fill={INK} />
      <circle cx="100" cy="74" r="6.5" fill={LIME} />
    </>
  );
}

function RacketArt() {
  return (
    <>
      <g transform="rotate(-35 100 80)">
        <path d={RACKET_STRINGS} stroke={INK} strokeWidth="1.25" opacity=".45" />
        <ellipse cx="100" cy="56" rx="21" ry="27" stroke={INK} strokeWidth="6" />
        <path d="M93 82l5 10M107 82l-5 10" stroke={INK} strokeWidth="4" />
        <rect x="96" y="91" width="8" height="38" rx="4" fill={INK} />
      </g>
      <Ball x={142} y={50} r={9} />
    </>
  );
}

// Start a conversation: a paper plane on its way.
function Wave() {
  return (
    <>
      <path d="M96 92l56-54-32 82z" fill={LIME} />
      <path d="M48 78l104-40-56 54z" fill={INK} />
      <path d="M96 92l-4 26 16-14z" fill={INK} />
    </>
  );
}

// Laskutus: a tennis ball minted as a euro coin, flying in past a stack of coins.
function MoneyArt() {
  const cx = 118;
  const cy = 70;
  const r = 28;
  const e = 12; // the € sign's radius
  const a = round(e * 0.707);
  return (
    <>
      <rect x="48" y="98" width="44" height="11" rx="5.5" fill={INK} />
      <rect x="53" y="87" width="44" height="11" rx="5.5" fill={INK} />
      <rect x="48" y="76" width="44" height="11" rx="5.5" fill={INK} />
      <path d="M57 81.5h26M62 92.5h26M57 103.5h26" stroke={ON_INK} strokeWidth="2" />
      <path d="M62 50h16M56 60h14M66 40h10" stroke={INK} strokeWidth="4" />
      <circle cx={cx} cy={cy} r={r} fill={LIME} />
      <path d={`M${round(cx + 3 + a)} ${round(cy - a)}A${e} ${e} 0 1 0 ${round(cx + 3 + a)} ${round(cy + a)}`} stroke={ON_LIME} strokeWidth="4.5" />
      <path d={`M${cx - 13} ${cy - 4}h15M${cx - 13} ${cy + 4}h15`} stroke={ON_LIME} strokeWidth="3.5" />
    </>
  );
}

const ART = {
  court: Court,
  money: MoneyArt,
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
      <g fill="none" stroke="none" strokeLinecap="round" strokeLinejoin="round">
        <Stage />
        <Art />
      </g>
    </svg>
  );
}

// What each piece is meant for — shown only in the QA gallery below.
const USAGE = {
  court: 'Ei vielä pelejä',
  money: 'Laskutus',
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
  wave: 'Aloita keskustelu',
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
