// koutsi-film.jsx — the film at the top of koutsi.krossi.app, in place of the old hero.
//
// 26 seconds on a 120 BPM grid (a beat is 0.5 s, a bar 2 s): scenes change on bar lines and
// things land on beats. The app is drawn, not screenshotted: line-drawn phones and cards in the
// page's own colours, a court of plain lines.
//
//    0– 2  Treeni loppuu. Kehitys jatkuu.       the lime under "Kehitys" becomes a phone
//    2– 4  Kaikki ryhmäsi. Yksi silmäys.        the coach's Koti builds up
//    4– 6  Suunnittele. Vaikka koko kausi kerralla.   the season grid fills in
//    6– 8  Mitä tällä viikolla treenataan?      a theme flies from the grid into the player's phone
//    8–10  Merkitse läsnäolot. Helposti.        the coach ticks, a player taps "En pääse"
//   10–12  the coach types a note and sends it
//   12–14  a circle opens from the send button onto a court; the ball goes back and forth
//   14–16  Palaute menee perille.               the ball lands on the note in the player's phone
//   16–18  Näytä videolla, mitä tarkoitat
//   18–20  Näe, miten kehityt. Viikko viikolta. a timeline climbs to the goal
//   20–23  Suunnittele. Merkitse. Kehity.       a stack that steps down a word at a time
//   23–25  "Kehity." turns into the wordmark: the K stays, the rest rolls to "rossi", the ball bounces
//   25–26  Valmennus ja kehitys. Samassa paikassa.   and it stays
//
// Text rises out of a mask, drawings rise from the bottom edge and sink back. The "Aloita
// treenaaminen" button sits under the film and never moves; once the film has ended, a round
// arrow under it plays it again.
//
// Every style is computed from the time alone in seek(t): no CSS animations, no timers, nothing
// carried from one frame to the next. So ?film=12.5 freezes any moment for checking. Reduced
// motion, crawlers and the prerender (scripts/prerender.mjs) get the last frame.

const { useEffect, useLayoutEffect, useRef, useState } = React;

const KF_END = 28.05; // film seconds (the times in seek)
const KF_PRE = 0.25; // white before the first word, in real seconds
const KF_REST = 16.63; // the coach's ball lies still on Maria's side
const KF_SIGNUP = 'https://koutsi.krossi.app/valmentaja';
const KF_NOTE = 'Hyvä nousu syötössä';
const KF_INK = [18, 18, 18];
const KF_GREY = [214, 214, 214];
const KF_LIME = [207, 228, 20];
const KF_LIME100 = [244, 248, 217];
const KF_WHITE = [255, 255, 255];

// ── time helpers ──────────────────────────────────────────────────────────────────────────
const kfClamp = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const kfP = (t, a, b) => kfClamp((t - a) / (b - a));
const kfLerp = (a, b, k) => a + (b - a) * k;
const kfOut3 = (k) => 1 - Math.pow(1 - k, 3);
const kfOut4 = (k) => 1 - Math.pow(1 - k, 4);
const kfIn2 = (k) => k * k;
const kfInOut3 = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const kfInOut4 = (k) => (k < 0.5 ? 8 * k * k * k * k : 1 - Math.pow(-2 * k + 2, 4) / 2);
const kfMix = (a, b, k) => `rgb(${a.map((v, i) => Math.round(kfLerp(v, b[i], k))).join(',')})`;

// ── pace ──────────────────────────────────────────────────────────────────────────────────
// The film is written in film seconds and played slower than that, and the frame rests where a
// line has landed so it can be read. [up to this film second, real seconds per film second, then
// rest this many real seconds]. Every rest sits on a still frame (nothing half way).
const KF_PACE = [
  [1.93, 1, 0.25], // Treeni loppuu. Kehitys jatkuu. (quick)
  [3.62, 1, 0.8], // Kaikki ryhmäsi. Yksi silmäys.
  [5.6, 1, 0.6], // Suunnittele. the season filled in
  [7.55, 1, 0.7], // one Syöttö glides into the player's week: Mitä tällä viikolla treenataan?
  [10.0, 1, 0.3], // the coach has ticked three present
  [11.6, 1, 0.7], // Tommi: En pääse, and the coach sees it
  [13.22, 1, 0.3], // the note written
  [15.28, 1, 0.2], // Lähetä has opened into the court
  [KF_REST, 1.15, 0.4], // the shot (a little slower than written) has landed on Maria's side
  [18.65, 1, 0.8], // Palaute menee perille.
  [19.8, 1, 0.2], // the video, before play
  [22.57, 1, 1.1], // Näe, miten kehityt. Viikko viikolta.
  [26.35, 1, 0.6], // Suunnittele. Merkitse. Kehity. and the wordmark
  [KF_END, 1, 0], // Valmennus ja kehitys. Samassa paikassa.
];
const KF_KEYS = (() => {
  const keys = [[0, 0]];
  let film = 0, real = 0;
  KF_PACE.forEach(([to, rate, rest]) => {
    real += (to - film) * rate; film = to; keys.push([film, real]);
    if (rest) { real += rest; keys.push([film, real]); }
  });
  return keys;
})();
const KF_LEN = KF_KEYS[KF_KEYS.length - 1][1]; // real seconds
/** real seconds since the start → film seconds */
function kfFilmAt(real) {
  if (real <= 0) return real / KF_PACE[0][1];
  for (let i = 1; i < KF_KEYS.length; i += 1) {
    const [f0, r0] = KF_KEYS[i - 1];
    const [f1, r1] = KF_KEYS[i];
    if (real <= r1) return r1 === r0 ? f1 : kfLerp(f0, f1, (real - r0) / (r1 - r0));
  }
  return KF_END;
}
/** film seconds → real seconds (the start of a rest) */
function kfRealAt(film) {
  if (film <= 0) return film * KF_PACE[0][1];
  for (let i = 1; i < KF_KEYS.length; i += 1) {
    const [f0, r0] = KF_KEYS[i - 1];
    const [f1, r1] = KF_KEYS[i];
    if (film <= f1 && f1 > f0) return kfLerp(r0, r1, (film - f0) / (f1 - f0));
  }
  return KF_LEN;
}

/** a drawing that rises a little from below at a, and at b sinks a little as it fades away (the
 *  next one comes in only once this one is nearly gone): { dy, o } */
function kfRise(t, a, b, dist) {
  const i = kfOut4(kfP(t, a, a + 0.6));
  const o = kfIn2(kfP(t, b, b + 0.28));
  return { dy: (1 - i) * dist + o * dist * 0.35, o: kfP(t, a, a + 0.35) * (1 - kfP(t, b, b + 0.26)) };
}

// ── copy ──────────────────────────────────────────────────────────────────────────────────
// [wide lines, tall lines]; a "*" marks the line with the lime under it
const KF_COPY = {
  groups: [['Kaikki ryhmäsi.', 'Yksi silmäys.'], ['Kaikki ryhmäsi.', 'Yksi silmäys.']],
  plan: [['Suunnittele.', 'Vaikka koko kausi kerralla.'], ['Suunnittele.', 'Vaikka koko kausi', 'kerralla.']],
  theme: [['Mitä tällä viikolla', 'treenataan?'], ['Mitä tällä', 'viikolla', 'treenataan?']],
  attend: [['Merkitse läsnäolot.', '*Helposti.'], ['Merkitse', 'läsnäolot.', '*Helposti.']],
  palaute: [['Palaute', 'menee', '*perille.'], ['Palaute', 'menee', '*perille.']],
  video: [['Näytä videolla,', 'mitä tarkoitat'], ['Näytä videolla,', 'mitä tarkoitat']],
  grow: [['Näe, miten', '*kehityt.', 'Viikko viikolta.'], ['Näe, miten', '*kehityt.', 'Viikko viikolta.']],
};
// [first line in, lines out, gap between lines]
const KF_HEAD_TIME = {
  groups: [2.25, 3.84, 0.25], plan: [4.25, 5.84, 0.25], theme: [6.5, 7.84, 0.25], attend: [8.25, 11.84, 0.25],
  palaute: [17.3, 18.69, 0.3], video: [19.1, 20.69, 0.25], grow: [21.1, 22.69, 0.25],
};

// ── the two layouts, in canvas units ──────────────────────────────────────────────────────
// wide: a computer (16:9). tall: a phone (2:3).
function kfLayout(wide) {
  if (wide) {
    return {
      wide: true, W: 1600, H: 900,
      hook: { size: 150, lh: 165, top: 285, lines: [['Treeni', 'loppuu.'], ['Kehitys', 'jatkuu.']] },
      head: { size: 100, lh: 108, top2: 70, top3: 34 },
      ph: { k: 1, x: 610, y2: 345, y3: 420 },
      pair: { k: 1, a: [400, 345], b: [820, 375] },
      grid: { x: 400, y: 345, w: 800 },
      field: { x: 330, y: 335, w: 940, h: 230, size: 56 },
      court: { cx: 800, cy: 470, theta: 52, P: 2400, sc: 1.14, tall: false, names: { coach: [140, 130], maria: [960, 130] } },
      video: { x: 460, y: 335, w: 680, h: 382 },
      steps: { pts: [[430, 900], [430, 790], [660, 790], [660, 690], [890, 690], [890, 590], [1120, 590], [1120, 490]], goalLeft: false, tag: [1190, 760] },
      stack: { size: 168, gap: 190, cy: 450 },
      logo: { scale: 1.2 },
      end: { size: 124, lh: 132, eyebrow: 262, top: 312, lines: [['Valmennus ja ', '*kehitys.'], ['Samassa paikassa.']], eyebrowSize: 22 },
      dist: 220,
    };
  }
  return {
    wide: false, W: 900, H: 1350,
    hook: { size: 156, lh: 170, top: 335, lines: [['Treeni'], ['loppuu.'], ['Kehitys'], ['jatkuu.']] },
    head: { size: 92, lh: 100, top2: 96, top3: 66 },
    ph: { k: 1.3, x: 203, y2: 350, y3: 470 },
    pair: { k: 1.04, a: [52, 470], b: [452, 500] },
    grid: { x: 50, y: 480, w: 800 },
    field: { x: 50, y: 500, w: 800, h: 300, size: 54 },
    court: { cx: 450, cy: 720, theta: 50, P: 2200, sc: 1.15, tall: true, names: { coach: [140, 130], maria: [980, -60] } }, // Maria just outside the narrow far end
    video: { x: 50, y: 360, w: 800, h: 450 },
    steps: { pts: [[130, 1370], [130, 1230], [330, 1230], [330, 1060], [530, 1060], [530, 890], [730, 890], [730, 720]], goalLeft: true, tag: [560, 1180] },
    stack: { size: 124, gap: 150, cy: 675 },
    logo: { scale: 1.2 },
    end: { size: 112, lh: 120, eyebrow: 420, top: 470, lines: [['Valmennus ja'], ['*kehitys.'], ['Samassa'], ['paikassa.']], eyebrowSize: 30 },
    dist: 300,
  };
}

const kfLines = (L, key) => KF_COPY[key][L.wide ? 0 : 1];

// ── the court, drawn in perspective (court units: 1100 long, 508 wide) ────────────────────
function kfProject(c) {
  const th = (c.theta * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  return (len, wid) => {
    const px = c.tall ? wid - 254 : len - 550;
    const py = c.tall ? 550 - len : wid - 254;
    const X = px * c.sc, Y = py * c.sc;
    const f = c.P / (c.P - Y * sin);
    return { x: c.cx + X * f, y: c.cy + Y * cos * f, f };
  };
}
const KF_COURT_LINES = [
  [[0, 0], [1100, 0]], [[1100, 0], [1100, 508]], [[1100, 508], [0, 508]], [[0, 508], [0, 0]],
  [[0, 63], [1100, 63]], [[0, 445], [1100, 445]],
  [[254, 63], [254, 445]], [[846, 63], [846, 445]], [[254, 254], [846, 254]],
  [[0, 254], [16, 254]], [[1084, 254], [1100, 254]],
];
// when each line starts drawing, after 14.45: the net (last, index 11) first, then the outline,
// then the inside
const KF_LINE_AT = [0.12, 0.12, 0.12, 0.12, 0.22, 0.22, 0.32, 0.32, 0.38, 0.42, 0.42, 0];

// The note as one clear shot: the coach (len 0 end) hits it high over the net, it bounces on
// Maria's side and rolls to a stop near her name (the names sit by the far sideline, the ball
// travels nearer the near one, so the note riding on it never covers them).
// [time, len, wid, height; a bounce's own arc height (default 230)]
const KF_RALLY = [
  [15.3, 70, 420, 40], [16.25, 870, 380, 0, 270], [16.48, 950, 385, 0, 60], [KF_REST, 990, 388, 0, 16],
];
function kfBall(t) {
  const R = KF_RALLY;
  if (t <= R[0][0]) return { len: R[0][1], wid: R[0][2], h: R[0][3] };
  for (let i = 0; i < R.length - 1; i += 1) {
    const [t0, l0, w0, h0] = R[i];
    const [t1, l1, w1, h1, arc = 230] = R[i + 1];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      // a hit flies in an arc down to the bounce; after a bounce the ball rises to the next hit
      const h = h1 === 0 ? h0 * (1 - u) + arc * 4 * u * (1 - u) : h1 * u * (2 - u);
      return { len: kfLerp(l0, l1, u), wid: kfLerp(w0, w1, u), h };
    }
  }
  const last = R[R.length - 1];
  return { len: last[1], wid: last[2], h: last[3] };
}

// ── style writing (only what changed) ─────────────────────────────────────────────────────
function kfCss(el, styles) {
  if (!el) return;
  const prev = el.__kf || (el.__kf = {});
  for (const k in styles) {
    const v = styles[k];
    if (prev[k] !== v) { el.style[k] = v; prev[k] = v; }
  }
}
const kfShow = (el, o) => kfCss(el, { opacity: String(Math.round(kfClamp(o) * 1000) / 1000), visibility: o <= 0.001 ? 'hidden' : 'visible' });
const kfMove = (el, x, y, s = 1, extra = '') => kfCss(el, { transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(4)})${extra}` });

/** a line that rises out of its mask over [a, a+d] and leaves upwards at b, fading as it goes */
function kfMask(el, t, a, b = Infinity, d = 0.5) {
  if (!el) return;
  const i = kfOut4(kfP(t, a, a + d));
  const o = kfIn2(kfP(t, b, b + 0.32));
  kfCss(el, {
    transform: `translateY(${((1 - i) * 115 - o * 115).toFixed(1)}%)`,
    opacity: String(Math.round(kfP(t, a, a + d * 0.5) * (1 - kfP(t, b + 0.04, b + 0.3)) * 1000) / 1000),
  });
}
const kfWipe = (el, k) => kfCss(el, { transform: `scaleX(${kfClamp(k).toFixed(3)})` });

/** a finger tap at time at: comes down, presses, lifts */
function kfTap(el, t, at) {
  if (!el) return;
  const down = kfOut3(kfP(t, at - 0.2, at - 0.04));
  const up = kfP(t, at + 0.04, at + 0.26);
  const press = t > at - 0.04 && t < at + 0.12 ? 0.84 : 1;
  kfShow(el, 0.3 * down * (1 - up));
  kfCss(el, { transform: `translate(-50%, -50%) scale(${(kfLerp(1.3, 1, down) * press).toFixed(3)})` });
}

// ── drawings ──────────────────────────────────────────────────────────────────────────────
function KfBallSvg({ size, id }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ display: 'block' }}>
      <defs>
        <radialGradient id={`kf-g-${id}`} cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#E4F25A" /><stop offset=".7" stopColor="#CFE414" /><stop offset="1" stopColor="#B9CC0E" /></radialGradient>
        <clipPath id={`kf-c-${id}`}><circle cx="50" cy="50" r="46" /></clipPath>
      </defs>
      <circle cx="50" cy="50" r="46" fill={`url(#kf-g-${id})`} />
      <g clipPath={`url(#kf-c-${id})`} fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round">
        <path d="M10 30c18-6 40-4 56 8s22 22 28 32" /><path d="M30 80c14 7 34 6 50-6" />
      </g>
    </svg>
  );
}

function KfPhone({ r, children, className = '' }) {
  return (
    <div className={`kf-ph ${className}`} ref={r}>
      <div className="kf-ph-isl" />
      <div className="kf-scr">{children}</div>
      <div className="kf-bar"><i /><i /><b /><i /><i /></div>
    </div>
  );
}

function KfDays({ on, dots = [] }) {
  return (
    <div className="kf-days">
      {['MA', 'TI', 'KE', 'TO', 'PE', 'LA', 'SU'].map((d, i) => (
        <span key={d} className={i === on ? 'on' : ''}>{d}{dots[i] === 1 ? <i /> : dots[i] === 2 ? <i className="o" /> : null}</span>
      ))}
    </div>
  );
}

function KfHeader({ week, hi, on, dots, r }) {
  return (
    <div className="kf-hdr" ref={r}>
      <div className="kf-wk">{week}</div>
      <div className="kf-hi">{hi}</div>
      <KfDays on={on} dots={dots} />
    </div>
  );
}

/** one headline line: a mask and the line inside it (with the lime under it if marked) */
function KfHeadLine({ text, top, size, W, r, hlRef, className = '' }) {
  const hl = text.startsWith('*');
  return (
    <div className={`kf-line ${className}`} style={{ top, width: W, fontSize: size }}>
      <span className="kf-mask"><span className="kf-word" ref={r}>{hl && <span className="kf-word-hl" ref={hlRef} />}{hl ? text.slice(1) : text}</span></span>
    </div>
  );
}

const KF_GRID = [
  ['Juniorit', ['Syöttö', 1], ['Syöttö', 1], ['Pelit', 0]],
  ['Aikuiset', ['Verkko', 1], ['Rysty', 0], ['Rysty', 1]],
  ['Kilpa', ['Liike', 0], ['Paluu', 1], ['Paluu', 1]],
  ['Mini', ['Pallo', 1], ['Pallo', 0], ['', 0]],
];
const KF_MILES = [['Vko 41', 'Treeni: syöttö'], ['Vko 42', 'Valmentajalta: hyvä nousu'], ['Vko 43', 'Ottelu: voitto 6–4 6–3']];

// ── the film ──────────────────────────────────────────────────────────────────────────────
function KoutsiFilm() {
  const stage = useRef(null);
  const canvas = useRef(null);
  const els = useRef({});
  const meas = useRef({});
  const clock = useRef(null);
  const [wide, setWide] = useState(true);
  const [state, setState] = useState('wait'); // wait | play | end | fixed
  const [run, setRun] = useState(0);
  const L = kfLayout(wide);
  const r = (key) => (el) => { if (el) els.current[key] = el; };

  // the starting time, in real seconds: a frozen moment (?film=12.5, in film seconds), the end
  // (reduced motion, crawlers), or the start
  if (clock.current == null) {
    const params = new URLSearchParams(window.location.search);
    const fixed = params.get('film');
    const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (fixed != null) clock.current = fixed === 'end' ? KF_LEN : kfRealAt(Math.max(-KF_PRE, Math.min(KF_END, parseFloat(fixed) || 0)));
    else clock.current = still || navigator.webdriver ? KF_LEN : -KF_PRE;
  }

  // layout from the room the page gives the film, canvas scale from the stage's width (the stage is
  // also kept short enough that the button under it stays in sight; see .kf-stage in koutsi.html)
  useLayoutEffect(() => {
    const el = stage.current;
    const box = el && el.parentElement;
    if (!el || !box) return undefined;
    const fit = () => {
      const room = box.clientWidth - 32;
      const nextWide = room >= 700;
      if (nextWide !== wide) { setWide(nextWide); return; }
      if (canvas.current) canvas.current.style.transform = `scale(${el.clientWidth / L.W})`;
    };
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    if (ro) { ro.observe(box); ro.observe(el); } else window.addEventListener('resize', fit);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', fit); };
  }, [wide]);

  // where things landed (the match cuts read these), then the first frame before it is painted
  useLayoutEffect(() => {
    const e = els.current;
    const within = (el, root) => {
      let x = 0, y = 0, n = el;
      while (n && n !== root && n !== canvas.current) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
      return { x, y, w: el.offsetWidth, h: el.offsetHeight };
    };
    const m = meas.current;
    if (e.hookHlWord) m.hook = within(e.hookHlWord, canvas.current);
    if (e.cell00) m.cell = within(e.cell00, e.grid);
    if (e.themeCard) m.theme = within(e.themeCard, e.ph4);
    if (e.noteCard) m.note = within(e.noteCard, e.ph8);
    if (e.send) m.send = within(e.send, e.field);
    if (e.rollA && e.rollB) m.roll = [e.rollA.offsetWidth, e.rollB.offsetWidth];
    if (e.logoSubIn) m.sub = e.logoSubIn.offsetWidth;
    seek(kfFilmAt(clock.current));
  }, [wide]);

  // the clock
  useEffect(() => {
    window.__kfLive = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get('film') != null) { setState('fixed'); seek(kfFilmAt(clock.current)); return undefined; }
    if (clock.current >= KF_LEN) { setState('end'); seek(KF_END); return undefined; }
    setState('play');
    let raf = 0, last = null, stopped = false;
    const frame = (now) => {
      if (stopped) return;
      if (!document.hidden) {
        // real time even on a slow phone; only a long stall (a hidden tab is paused above) is cut short
        if (last != null) clock.current += Math.min(0.25, (now - last) / 1000);
        last = now;
      } else {
        last = null;
      }
      seek(kfFilmAt(Math.min(clock.current, KF_LEN)));
      if (clock.current >= KF_LEN) { setState('end'); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [wide, run]);

  const replay = () => { clock.current = -KF_PRE; setRun((n) => n + 1); };

  // ── seek: every style of the frame at time t ──────────────────────────────────────────
  function seek(t) {
    const e = els.current;
    const m = meas.current;
    const { W, H } = L;
    const k = L.ph.k;
    const phW = 380 * k, phH = 780 * k;

    // headlines of the drawn scenes
    Object.keys(KF_HEAD_TIME).forEach((key) => {
      const [a, b, gap] = KF_HEAD_TIME[key];
      const lines = kfLines(L, key);
      lines.forEach((_, i) => kfMask(e[`${key}${i}`], t, a + i * gap, b + i * 0.04));
      kfShow(e[`head-${key}`], t > a - 0.1 && t < b + 0.6 ? 1 : 0);
      // the lime comes under its line once the line is up
      const star = lines.findIndex((s) => s.startsWith('*'));
      if (star >= 0) { const at = a + star * gap + 0.32; kfWipe(e[`${key}-hl`], kfOut3(kfP(t, at, at + 0.36))); }
    });

    // ── 0–2 the hook ──
    let wi = 0;
    L.hook.lines.forEach((words, li) => words.forEach((_, j) => {
      kfMask(e[`hook${li}-${j}`], t, wi * 0.25, 1.95 + wi * 0.04, 0.45); // quick, one word after another
      wi += 1;
    }));
    kfShow(e.hookLines, t < 2.5 ? 1 : 0);
    kfCss(e.hookLines, { zIndex: '2' }); // the words over the lime that grows under "Kehitys"

    // the lime under "Kehitys" grows into the coach's phone
    const ph2 = { x: L.ph.x, y: L.ph.y2 };
    if (m.hook && e.hookHl) {
      const h = m.hook;
      const from = { x: h.x - h.h * 0.06, y: h.y + h.h * 0.2, w: h.w + h.h * 0.12, h: h.h * 0.72 };
      const mk = kfInOut3(kfP(t, 2.0, 2.5));
      const wipe = kfOut3(kfP(t, 0.72, 0.98));
      kfCss(e.hookHl, {
        width: `${kfLerp(from.w * (mk > 0 ? 1 : wipe), phW, mk).toFixed(1)}px`,
        height: `${kfLerp(from.h, phH, mk).toFixed(1)}px`,
        borderRadius: `${kfLerp(0, 62 * k, mk).toFixed(1)}px`,
        background: kfMix(KF_LIME, KF_WHITE, kfP(t, 2.2, 2.5)),
        boxShadow: `inset 0 0 0 ${(4 * k * kfP(t, 2.2, 2.45)).toFixed(2)}px #121212`,
        transform: `translate(${kfLerp(from.x, ph2.x, mk).toFixed(1)}px, ${kfLerp(from.y, ph2.y, mk).toFixed(1)}px)`,
        zIndex: t < 2.0 ? '1' : '6',
      });
      kfShow(e.hookHl, t < 0.72 ? 0 : 1 - kfP(t, 2.5, 2.56));
    }

    // ── 2–4 the coach's Koti ──
    const out2 = kfIn2(kfP(t, 3.84, 4.14));
    kfMove(e.ph2, ph2.x, ph2.y + out2 * L.dist * 0.35, k);
    kfShow(e.ph2, t < 2.47 ? 0 : 1 - kfP(t, 3.84, 4.1));
    [e.k2hdr, e.k2sec, e.k2c0, e.k2c1, e.k2c2].forEach((el, i) => {
      const a = [2.5, 2.6, 2.75, 3.0, 3.25][i];
      kfShow(el, kfP(t, a, a + 0.2));
      kfCss(el, { transform: `translateY(${((1 - kfOut3(kfP(t, a, a + 0.35))) * 26).toFixed(1)}px)` });
    });

    // ── 4–6 the season grid; then one "Syöttö" lifts off and the grid fades away under it ──
    kfMove(e.grid, L.grid.x, L.grid.y + (1 - kfOut3(kfP(t, 4.05, 4.65))) * L.dist);
    kfShow(e.grid, kfP(t, 4.05, 4.4) * (1 - kfP(t, 5.72, 6.05)));
    KF_GRID.forEach((row, ri) => row.slice(1).forEach(([, lime], ci) => {
      const el = e[`cell${ri}${ci}`];
      if (!el || !lime) return;
      const at = 4.75 + ci * 0.25 + ri * 0.06;
      const f = kfOut3(kfP(t, at, at + 0.18));
      kfCss(el, { background: kfMix([241, 241, 241], KF_LIME, f), transform: `scale(${kfLerp(0.94, 1, f).toFixed(3)})` });
      if (ri === 0 && ci === 0) kfShow(el, t < 5.62 ? 1 : 0); // this one lifts off to the player
    }));

    // ── 5.6–7.8 that "Syöttö" glides into the player's week: the theme of the week ──
    const r4 = kfRise(t, 6.15, 7.84, 50);
    const ph4 = { x: L.ph.x, y: (L.wide ? L.ph.y2 : L.ph.y3) + r4.dy };
    kfMove(e.ph4, ph4.x, ph4.y, k);
    kfShow(e.ph4, r4.o);
    if (m.cell && m.theme && e.fly) {
      const lift = kfOut3(kfP(t, 5.62, 5.92)) * (1 - kfInOut3(kfP(t, 6.3, 6.6)));
      const f = kfInOut3(kfP(t, 5.92, 6.6));
      const from = { x: L.grid.x + m.cell.x, y: L.grid.y + m.cell.y, w: m.cell.w, h: m.cell.h };
      const to = { x: ph4.x + m.theme.x * k, y: ph4.y + m.theme.y * k, w: m.theme.w * k, h: m.theme.h * k };
      kfCss(e.fly, {
        width: `${kfLerp(from.w, to.w, f).toFixed(1)}px`, height: `${kfLerp(from.h, to.h, f).toFixed(1)}px`,
        borderRadius: `${kfLerp(from.h / 2, 24 * k, f).toFixed(1)}px`,
        background: kfMix(KF_LIME, KF_LIME100, kfP(t, 6.4, 6.65)),
        boxShadow: `0 ${(16 * lift).toFixed(1)}px ${(36 * lift).toFixed(1)}px rgba(18,18,18,${(0.16 * lift).toFixed(3)})`,
        transformOrigin: '50% 50%',
        transform: `translate(${kfLerp(from.x, to.x, f).toFixed(1)}px, ${kfLerp(from.y, to.y, f).toFixed(1)}px) scale(${kfLerp(1, 1.12, lift).toFixed(4)})`,
      });
      kfShow(e.flyText, 1 - kfP(t, 6.42, 6.56));
      kfShow(e.fly, t >= 5.62 && t < 6.75 ? 1 : 0);
    }
    kfShow(e.themeCard, kfP(t, 6.5, 6.68));

    // ── 8–11.8 attendance: the coach ticks who came, then Tommi says himself he can't make it ──
    const P = L.pair;
    const r5a = kfRise(t, 8.05, 11.84, L.dist);
    const slide = kfInOut3(kfP(t, 10.0, 10.6)); // the coach's phone makes room for Tommi's
    kfMove(e.ph5a, kfLerp((W - 380 * P.k) / 2, P.a[0], slide), P.a[1] + r5a.dy, P.k);
    kfShow(e.ph5a, r5a.o);
    const r5b = kfRise(t, 10.2, 11.86, L.dist);
    kfMove(e.ph5b, P.b[0], P.b[1] + r5b.dy, P.k, ' rotate(4deg)');
    kfShow(e.ph5b, r5b.o);
    let present = 0;
    [0, 1, 2].forEach((i) => {
      const at = 8.95 + i * 0.4;
      kfTap(e[`tapc${i}`], t, at);
      kfCss(e[`chk${i}`], { transform: `scale(${kfOut3(kfP(t, at, at + 0.2)).toFixed(3)})` });
      if (t >= at) present += 1;
    });
    if (e.attCount && e.attCount.__n !== present) { e.attCount.textContent = `Läsnä ${present}/4`; e.attCount.__n = present; }
    kfTap(e.tap5, t, 10.95);
    kfCss(e.enpaase, { background: kfMix(KF_WHITE, KF_INK, kfP(t, 10.95, 11.08)), color: kfMix(KF_INK, KF_WHITE, kfP(t, 10.95, 11.08)) });
    const told = kfOut3(kfP(t, 11.15, 11.4));
    kfCss(e.tommiRow, { background: kfMix(KF_WHITE, KF_LIME100, told) });
    kfShow(e.tommiSays, told);
    kfCss(e.tommiX, { transform: `scale(${told.toFixed(3)})` });

    // ── 12–13.6 the note ──
    const fIn = kfOut3(kfP(t, 12.12, 12.6));
    kfMove(e.field, L.field.x, L.field.y + (1 - fIn) * 40);
    kfShow(e.field, t < 14.6 ? kfP(t, 12.12, 12.4) : 0);
    kfShow(e.fieldEyebrow, t < 14.6 ? kfP(t, 12.2, 12.5) : 0);
    kfMove(e.fieldEyebrow, L.field.x, L.field.y - 52 + (1 - fIn) * 40);
    const n = Math.round(kfP(t, 12.5, 13.2) * KF_NOTE.length);
    if (e.typed && e.typed.__n !== n) { e.typed.textContent = KF_NOTE.slice(0, n); e.typed.__n = n; }
    kfShow(e.caret, t < 12.45 ? 0 : t < 13.25 ? 1 : (t * 2) % 1 < 0.5 ? 1 : 0);
    kfTap(e.tap6, t, 13.5);
    kfCss(e.send, { transform: `scale(${t > 13.46 && t < 13.62 ? 0.9 : 1})` });
    kfShow(e.sendIcon, 1 - kfP(t, 13.62, 13.76));

    // ── 13.8–16.75 Lähetä grows into the court; the lines draw in; a calm rally ──
    // the court starts as the button itself (same lime circle, same size), then opens out
    const sendC = m.send ? { x: L.field.x + m.send.x + m.send.w / 2, y: L.field.y + m.send.y + m.send.h / 2 } : { x: W / 2, y: H / 2 };
    const sendR = m.send ? m.send.w / 2 : 48;
    const reach = Math.hypot(Math.max(sendC.x, W - sendC.x), Math.max(sendC.y, H - sendC.y));
    const open = kfInOut3(kfP(t, 13.76, 14.6));
    kfCss(e.court, {
      clipPath: open >= 1 ? 'none' : `circle(${kfLerp(sendR, reach, open).toFixed(1)}px at ${sendC.x.toFixed(1)}px ${sendC.y.toFixed(1)}px)`,
      background: kfMix(KF_LIME, KF_LIME100, kfP(t, 14.0, 14.55)),
    });
    kfShow(e.court, t >= 13.76 && t < 17.1 ? 1 - kfP(t, 16.73, 17.07) : 0);
    const zoom = kfLerp(1, 1.03, kfInOut3(kfP(t, 14.4, 16.8)));
    kfCss(e.courtLines, { transform: `scale(${zoom.toFixed(4)})` });
    KF_LINE_AT.forEach((at, i) => {
      const el = e[`cl${i}`];
      if (!el) return;
      const d = kfInOut3(kfP(t, 14.45 + at, 14.9 + at));
      kfCss(el, { strokeDashoffset: (el.__len * (1 - d)).toFixed(1), opacity: d > 0.001 ? '1' : '0' });
    });
    const proj = kfProject(L.court);
    // who is at which end: the coach where the ball starts, Maria where it lands
    [['sideCoach', L.court.names.coach], ['sideMaria', L.court.names.maria]].forEach(([key, [len, wid]]) => {
      const p = proj(len, wid);
      const x = L.court.cx + (p.x - L.court.cx) * zoom, y = L.court.cy + (p.y - L.court.cy) * zoom;
      kfCss(e[key], { transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)` });
      kfShow(e[key], kfP(t, 14.9, 15.2));
    });
    kfCss(e.sideMaria, { background: kfMix(KF_WHITE, KF_LIME, kfOut3(kfP(t, 16.25, 16.45))) }); // the ball has arrived
    const onCourt = (tt) => {
      const b = kfBall(tt);
      const g0 = proj(b.len, b.wid);
      const cx = L.court.cx, cy = L.court.cy;
      const gx = cx + (g0.x - cx) * zoom, gy = cy + (g0.y - cy) * zoom;
      const s = L.court.sc * g0.f * zoom;
      return { x: gx, y: gy - b.h * s * 0.9, gx, gy, d: 34 * s * (1 + b.h / 700), s, h: b.h, rot: b.len * 0.7 + b.wid * 0.3 };
    };

    // ── 16.75–18.65 from the player's side into the player's phone: the note has arrived ──
    const r8 = kfRise(t, 16.97, 18.69, 50);
    const ph8 = { x: L.ph.x, y: L.ph.y3 + r8.dy };
    kfMove(e.ph8, ph8.x, ph8.y, k);
    kfShow(e.ph8, r8.o);
    const noteC = m.note ? { x: ph8.x + (m.note.x + m.note.w / 2) * k, y: ph8.y + (m.note.y + m.note.h / 2) * k } : { x: W / 2, y: H / 2 };
    kfShow(e.noteGlow, kfOut3(kfP(t, 17.3, 17.55)));
    const rest = onCourt(KF_REST);
    const ballAt = (tt) => {
      if (tt < 16.8) return onCourt(tt);
      const f = kfInOut3(kfP(tt, 16.8, 17.35));
      return { x: kfLerp(rest.x, noteC.x, f), y: kfLerp(rest.y, noteC.y, f), d: kfLerp(rest.d, 22 * k, f), rot: rest.rot + f * 120 };
    };
    const ballOn = kfP(t, 15.05, 15.25) * (1 - kfP(t, 17.27, 17.37));
    for (let j = 0; j < 4; j += 1) {
      const el = e[`ball${j}`];
      if (!el) continue;
      const tt = t - j * 0.012;
      const b = ballAt(tt);
      const moving = t > 15.3 && t < KF_REST;
      kfCss(el, { width: `${b.d.toFixed(1)}px`, height: `${b.d.toFixed(1)}px`, transform: `translate(${(b.x - b.d / 2).toFixed(1)}px, ${(b.y - b.d / 2).toFixed(1)}px) rotate(${b.rot.toFixed(0)}deg)` });
      kfShow(el, j === 0 ? ballOn : moving ? ballOn * [0, 0.24, 0.12, 0.05][j] : 0);
      if (j === 0) { // the note rides along just above the ball, all the way into Maria's phone
        kfCss(e.msg, { transform: `translate(${b.x.toFixed(1)}px, ${(b.y - b.d / 2 - 14).toFixed(1)}px) translate(-50%, -100%)` });
        kfShow(e.msg, kfP(t, 15.1, 15.3) * (1 - kfP(t, 17.12, 17.3)));
      }
    }
    if (e.shadow) {
      const b = onCourt(Math.min(t, 16.8));
      const d = 36 * b.s;
      kfCss(e.shadow, { width: `${d.toFixed(1)}px`, height: `${(d * 0.5).toFixed(1)}px`, transform: `translate(${(b.gx - d / 2).toFixed(1)}px, ${(b.gy - d / 4).toFixed(1)}px)` });
      kfShow(e.shadow, kfP(t, 15.05, 15.25) * (1 - kfP(t, 16.75, 16.95)) * Math.max(0.12, 0.42 - b.h / 900));
    }

    // ── 18.85–20.75 video ──
    const r9 = kfRise(t, 18.9, 20.69, L.dist);
    kfMove(e.video, L.video.x, L.video.y + r9.dy);
    kfShow(e.video, r9.o);
    kfMove(e.chips, 0, L.video.y + L.video.h + 26 + r9.dy);
    kfShow(e.chips, r9.o * kfP(t, 19.35, 19.55));
    kfTap(e.tap9, t, 20.0);
    kfCss(e.play, { transform: `translate(-50%, -50%) scale(${t > 19.96 && t < 20.12 ? 0.9 : 1})` });
    const prog = kfP(t, 20.0, 20.8) * 0.46;
    kfCss(e.scrubFill, { width: `${(prog * 100).toFixed(2)}%` });
    kfCss(e.scrubKnob, { left: `${(prog * 100).toFixed(2)}%` });
    kfShow(e.vtag, kfOut3(kfP(t, 20.2, 20.45)));
    kfCss(e.vtag, { transform: `translateY(${((1 - kfOut3(kfP(t, 20.2, 20.5))) * 12).toFixed(1)}px)` });

    // ── 20.85–22.65 the timeline climbs ──
    const pts = L.steps.pts;
    const segLen = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
    const total = segLen.reduce((a, b) => a + b, 0);
    const reachAt = [21.35, 21.6, 21.85, 22.1]; // the circles, on the beats
    const stops = [0, segLen[0], segLen[0] + segLen[1] + segLen[2], segLen.slice(0, 5).reduce((a, b) => a + b, 0), total];
    const times = [21.15, ...reachAt];
    let drawn = 0;
    for (let i = 0; i < times.length - 1; i += 1) drawn = kfLerp(drawn, stops[i + 1], kfInOut3(kfP(t, times[i], times[i + 1])));
    if (t >= times[times.length - 1]) drawn = total;
    kfCss(e.stepsPath, { strokeDashoffset: `${(total - drawn).toFixed(1)}` });
    const st = kfRise(t, 20.9, 22.69, L.dist * 0.6);
    kfCss(e.steps, { transform: `translateY(${st.dy.toFixed(1)}px)` });
    kfShow(e.steps, st.o);
    reachAt.forEach((at, i) => {
      kfCss(e[`dot${i}`], { transform: `scale(${kfOut3(kfP(t, at, at + 0.14)).toFixed(3)})` });
      kfShow(e[`mile${i}`], kfOut3(kfP(t, at + 0.04, at + 0.2)));
    });
    kfShow(e.streak, kfOut3(kfP(t, 22.35, 22.55)));

    // ── 22.85–25 Suunnittele. Merkitse. Kehity. (a word every 0.6 s) ──
    const S = L.stack;
    const active = kfInOut3(kfP(t, 23.5, 23.8)) + kfInOut3(kfP(t, 24.1, 24.4));
    [0, 1, 2].forEach((i) => {
      const line = e[`stack${i}`];
      if (!line) return;
      if (i < 2) kfCss(line, { transform: `translateY(${((i - active) * S.gap).toFixed(1)}px)` });
      kfMask(e[`stackw${i}`], t, 22.85 + i * 0.08, i < 2 ? 25.0 : Infinity);
      const on = kfClamp(1 - Math.abs(i - active));
      kfCss(e[`stackw${i}`], { color: i === 2 && t > 25.05 ? kfMix(KF_INK, KF_LIME, kfP(t, 25.15, 25.4)) : kfMix(KF_GREY, KF_INK, on) });
      const wipeIn = kfOut3(kfP(t, 23.15 + i * 0.6, 23.4 + i * 0.6));
      const wipeOut = i < 2 ? kfP(t, 23.5 + i * 0.6, 23.65 + i * 0.6) : kfP(t, 25.05, 25.25);
      kfWipe(e[`stackhl${i}`], wipeIn * (1 - wipeOut));
    });
    kfShow(e.stackLayer, t > 22.75 && t < 27.35 ? 1 : 0);

    // ── 25.05–27.15 "Kehity." becomes the wordmark ──
    if (m.roll) {
      const rk = kfInOut3(kfP(t, 25.05, 25.41));
      kfCss(e.roll, { width: `${kfLerp(m.roll[0], m.roll[1], rk).toFixed(1)}px` });
      kfCss(e.rollIn, { transform: `translateY(${(-rk * 1.06).toFixed(3)}em)` });
      kfShow(e.rollA, 1 - kfP(t, 25.17, 25.35)); // "ehity." leaves as "rossi" comes in (its y would peek over the K)
    }
    const grow = kfInOut3(kfP(t, 25.05, 25.45));
    kfCss(e.stack2, { transform: `translateY(${((2 - active) * S.gap).toFixed(1)}px) scale(${kfLerp(1, L.logo.scale, grow).toFixed(4)})` });
    // the ball drops in after "Krossi" and bounces like the app's wordmark: lands on 25.55 and 26.05
    const bw = kfOut3(kfP(t, 25.3, 25.5));
    kfCss(e.logoBall, { width: `${(bw * 0.4).toFixed(3)}em` });
    let by = 0, rot = 0;
    if (t < 25.55) { by = -1.3 * (1 - kfIn2(kfP(t, 25.35, 25.55))); rot = kfP(t, 25.35, 25.55) * 120; }
    else if (t < 26.05) { const u = kfP(t, 25.55, 26.05); by = -0.42 * 4 * u * (1 - u); rot = 120 + u * 160; }
    else if (t < 26.3) { const u = kfP(t, 26.05, 26.3); by = -0.12 * 4 * u * (1 - u); rot = 280 + u * 50; }
    else rot = 330;
    kfCss(e.logoBallIn, { transform: `translateY(${by.toFixed(3)}em) rotate(${rot.toFixed(0)}deg)` });
    kfShow(e.logoBall, kfP(t, 25.35, 25.41));
    const sub = kfOut3(kfP(t, 25.65, 26.0));
    if (m.sub) kfCss(e.logoSub, { width: `${(sub * m.sub).toFixed(1)}px` });
    kfShow(e.logoSubIn, sub);
    kfCss(e.logoSubIn, { transform: `translateX(${((1 - sub) * 20).toFixed(1)}px)` });
    kfShow(e.stack2, t < 26.9 ? 1 : 1 - kfP(t, 26.9, 27.15));
    kfShow(e.stack0, t < 25.35 ? 1 : 1 - kfP(t, 25.05, 25.35));
    kfShow(e.stack1, t < 25.35 ? 1 : 1 - kfP(t, 25.05, 25.35));

    // ── 26.95–28.05 the page's hero, and it stays ──
    kfShow(e.end, t >= 26.95 ? 1 : 0);
    kfShow(e.endEyebrow, kfOut3(kfP(t, 27.05, 27.35)));
    L.end.lines.forEach((_, i) => kfMask(e[`endl${i}`], t, 27.1 + i * 0.12));
    kfWipe(e.endHl, kfOut3(kfP(t, 27.5, 27.8)));
  }

  const head = (key) => {
    const lines = kfLines(L, key);
    const top = lines.length > 2 ? L.head.top3 : L.head.top2;
    return (
      <div className="kf-layer" ref={r(`head-${key}`)} key={key}>
        {lines.map((text, i) => (
          <KfHeadLine key={text} text={text} top={top + i * L.head.lh} size={L.head.size} W={L.W} r={r(`${key}${i}`)} hlRef={r(`${key}-hl`)} />
        ))}
      </div>
    );
  };
  const proj = kfProject(L.court);
  // a court line that draws itself in (seek moves its dash)
  const courtLine = (p, q, i, width) => {
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    return (
      <line key={i} ref={(el) => { if (el) { el.__len = len; els.current[`cl${i}`] = el; } }} x1={p.x.toFixed(1)} y1={p.y.toFixed(1)} x2={q.x.toFixed(1)} y2={q.y.toFixed(1)}
        strokeWidth={width} strokeDasharray={len.toFixed(1)} strokeDashoffset={len.toFixed(1)} />
    );
  };
  const pathD = L.steps.pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  const pathLen = L.steps.pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - L.steps.pts[i][0], p[1] - L.steps.pts[i][1]), 0);
  const dots = [L.steps.pts[1], L.steps.pts[3], L.steps.pts[5]];
  const goal = L.steps.pts[7];

  return (
    <section className={`kf ${wide ? 'is-wide' : 'is-tall'}`} data-state={state} id="lataa">
      <div className="kf-stage" ref={stage} data-frozen={navigator.webdriver ? '' : undefined} style={{ aspectRatio: `${L.W} / ${L.H}` }}>
        <div className="kf-canvas" ref={canvas} style={{ width: L.W, height: L.H }}>
          <div className="kf-film" aria-hidden="true">
            {/* 0–2 */}
            <div className="kf-hook-hl" ref={r('hookHl')} />
            <div className="kf-layer" ref={r('hookLines')}>
              {L.hook.lines.map((words, li) => (
                <div key={li} className="kf-line" style={{ top: L.hook.top + li * L.hook.lh, width: L.W, fontSize: L.hook.size }}>
                  {words.map((w, j) => (
                      <React.Fragment key={w}>
                        {j > 0 && ' '}
                        <span className="kf-mask"><span className="kf-word" ref={(el) => { if (el) { els.current[`hook${li}-${j}`] = el; if (w === 'Kehitys') els.current.hookHlWord = el; } }}>{w}</span></span>
                      </React.Fragment>
                  ))}
                </div>
              ))}
            </div>

            {/* 2–4 */}
            {head('groups')}
            <KfPhone r={r('ph2')}>
              <KfHeader r={r('k2hdr')} week="VIIKKO 44" hi="Moi, Anna!" on={3} dots={[1, 1, 1, 1, 2, 2, 0]} />
              <div className="kf-sec" ref={r('k2sec')}>Tänään</div>
              {[['16.30', 'Juniorit', [1, 0, 0, 0], 1], ['18.00', 'Aikuiset', [0, 1, 0], 1], ['19.30', 'Kilparyhmä', [0, 0, 0, 0], 0]].map(([time, name, avs, lime], i) => (
                <div key={name} className="kf-gc" ref={r(`k2c${i}`)}>
                  <span className={`kf-dot${lime ? '' : ' g'}`} />
                  <span className="kf-gc-t"><small>{time}</small><strong>{name}</strong></span>
                  <span className="kf-avs">{avs.map((a, j) => <u key={j} className={a ? 'l' : ''} />)}</span>
                </div>
              ))}
            </KfPhone>

            {/* 4–6 */}
            {head('plan')}
            <div className="kf-grid" ref={r('grid')} style={{ width: L.grid.w }}>
              <table>
                <thead><tr><th /><th>Vko 45</th><th>Vko 46</th><th>Vko 47</th></tr></thead>
                <tbody>
                  {KF_GRID.map(([name, ...cells], ri) => (
                    <tr key={name}>
                      <td className="n">{name}</td>
                      {cells.map(([text, lime], ci) => (
                        <td key={ci}><div className="kf-pill" ref={r(`cell${ri}${ci}`)} data-lime={lime || undefined}>{text}</div></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 5.6–7.8 */}
            {head('theme')}
            <KfPhone r={r('ph4')}>
              <KfHeader week="VIIKKO 45" hi="Moi, Maria!" on={0} dots={[0, 1, 0, 1, 0, 0, 0]} />
              <div className="kf-theme" ref={r('themeCard')}>
                <div className="kf-who">VIIKON TEEMA</div><strong>Syöttö</strong><p>Kakkossyötön kierre ja korkeus verkon yli</p>
              </div>
              <div className="kf-gc"><span className="kf-dot" /><span className="kf-gc-t"><small>Ti 18.00</small><strong>Aikuiset</strong></span></div>
            </KfPhone>
            <div className="kf-fly" ref={r('fly')}><span ref={r('flyText')}>Syöttö</span></div>

            {/* 8–11.8 */}
            {head('attend')}
            <KfPhone r={r('ph5a')}>
              <div className="kf-title">Ti 18.00 Aikuiset</div>
              <div className="kf-sec" ref={r('attCount')}>Läsnä 3/4</div>
              {['Laura N.', 'Maria K.', 'Sanna P.'].map((name, i) => (
                <div key={name} className="kf-arow"><u className={i === 1 ? 'l' : ''} /><strong>{name}</strong><span className="kf-mark"><i className="kf-chk" ref={r(`chk${i}`)} /><span className="kf-tap" ref={r(`tapc${i}`)} /></span></div>
              ))}
              <div className="kf-arow" ref={r('tommiRow')}><u /><strong>Tommi H.<small ref={r('tommiSays')}>Ilmoitti itse</small></strong><span className="kf-mark"><i className="kf-x" ref={r('tommiX')} /></span></div>
            </KfPhone>
            <KfPhone r={r('ph5b')}>
              <div className="kf-hdr kf-hdr-sm"><div className="kf-wk">TOMMIN VIIKKO</div><div className="kf-hi">Ti 18.00</div><div className="kf-hdr-sub">Aikuiset, kenttä 3</div></div>
              <div className="kf-btns">
                <span className="kf-btn2">Pääsen</span>
                <span className="kf-btn2" ref={r('enpaase')}>En pääse<span className="kf-tap" ref={r('tap5')} /></span>
              </div>
            </KfPhone>

            {/* 12–13.6 */}
            <div className="kf-eyebrow kf-field-eyebrow" ref={r('fieldEyebrow')}><i />Huomio pelaajalle</div>
            <div className="kf-field" ref={r('field')} style={{ width: L.field.w, height: L.field.h, fontSize: L.field.size }}>
              <span className="kf-typed" ref={r('typed')} /><span className="kf-caret" ref={r('caret')} />
              <span className="kf-send" ref={r('send')}>
                <svg ref={r('sendIcon')} width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#121212" strokeWidth="2.4" strokeLinejoin="round"><path d="M21 3 10 14" /><path d="M21 3 14 21l-4-7-7-4z" /></svg>
                <span className="kf-tap" ref={r('tap6')} />
              </span>
            </div>

            {/* 13.8–18.4 */}
            <div className="kf-court" ref={r('court')}>
              <svg className="kf-court-lines" ref={r('courtLines')} width={L.W} height={L.H} viewBox={`0 0 ${L.W} ${L.H}`} fill="none" stroke="#121212" strokeWidth="5" strokeLinecap="round" style={{ transformOrigin: `${L.court.cx}px ${L.court.cy}px` }}>
                {KF_COURT_LINES.map(([a, b], i) => courtLine(proj(a[0], a[1]), proj(b[0], b[1]), i))}
                {courtLine(proj(550, -40), proj(550, 548), KF_COURT_LINES.length, 10)}
              </svg>
              <div className="kf-shadow" ref={r('shadow')} />
              <span className="kf-chip kf-side" ref={r('sideCoach')} style={{ fontSize: L.wide ? 26 : 34 }}><u />Valmentaja</span>
              <span className="kf-chip kf-side" ref={r('sideMaria')} style={{ fontSize: L.wide ? 26 : 34 }}><u className="l" />Maria</span>
            </div>

            {/* 18.4–20.3 */}
            {head('palaute')}
            <KfPhone r={r('ph8')}>
              <KfHeader week="VIIKKO 44" hi="Moi, Maria!" on={4} dots={[0, 1, 0, 1, 0, 0, 0]} />
              <div className="kf-note" ref={r('noteCard')}>
                <div className="kf-note-glow" ref={r('noteGlow')} />
                <div className="kf-who">VALMENTAJALTA <em>UUSI</em></div>
                <p>Hyvä nousu syötössä, heitto pysyy jo samassa kohdassa</p>
              </div>
            </KfPhone>
            {[0, 1, 2, 3].map((j) => <div key={j} className="kf-ball" ref={r(`ball${j}`)}><KfBallSvg size="100%" id={j} /></div>)}
            <div className="kf-msg" ref={r('msg')} style={{ fontSize: L.wide ? 26 : 36 }}>{KF_NOTE}</div>

            {/* 20.5–22.4 */}
            {head('video')}
            <div className="kf-video" ref={r('video')} style={{ width: L.video.w, height: L.video.h }}>
              <svg width="100%" height="100%" viewBox="0 0 740 416" preserveAspectRatio="none" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="3">
                <path d="M150 360 L250 120 L490 120 L590 360 Z" /><path d="M196 250 L544 250" /><path d="M370 120 L370 250" />
                <path d="M120 300 L620 300" strokeWidth="5" stroke="rgba(255,255,255,.75)" />
              </svg>
              <span className="kf-play" ref={r('play')}><span className="kf-tap" ref={r('tap9')} /></span>
              <span className="kf-scrub"><i ref={r('scrubFill')} /><b ref={r('scrubKnob')} /></span>
              <span className="kf-vtag" ref={r('vtag')}>Katso heiton korkeus</span>
            </div>
            <div className="kf-chips" ref={r('chips')} style={{ width: L.W }}>
              <span className="kf-chip"><u className="l" />Maria K.</span><span className="kf-chip"><u />Aikuiset</span>
            </div>

            {/* 22.5–24.3 */}
            {head('grow')}
            <div className="kf-layer" ref={r('steps')}>
              <svg width={L.W} height={L.H} viewBox={`0 0 ${L.W} ${L.H}`} fill="none" style={{ position: 'absolute', left: 0, top: 0 }}>
                <path ref={r('stepsPath')} d={pathD} stroke="#121212" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={pathLen.toFixed(1)} strokeDashoffset={pathLen.toFixed(1)} />
                {dots.map((p, i) => <circle key={i} ref={r(`dot${i}`)} cx={p[0]} cy={p[1]} r="11" fill="#fff" stroke="#121212" strokeWidth="4" style={{ transformOrigin: `${p[0]}px ${p[1]}px`, transformBox: 'view-box' }} />)}
                <circle ref={r('dot3')} cx={goal[0]} cy={goal[1]} r="20" fill="#CFE414" stroke="#121212" strokeWidth="5" style={{ transformOrigin: `${goal[0]}px ${goal[1]}px`, transformBox: 'view-box' }} />
              </svg>
              {KF_MILES.map(([wk, text], i) => (
                <div key={wk} className="kf-mile" ref={r(`mile${i}`)} style={{ left: dots[i][0] + 24, top: dots[i][1] - 70 }}>
                  <i className="g" /><span><small>{wk}</small>{text}</span>
                </div>
              ))}
              <div className="kf-mile is-goal" ref={r('mile3')} style={L.steps.goalLeft ? { right: L.W - goal[0] + 32, top: goal[1] - 34 } : { left: goal[0] + 34, top: goal[1] - 70 }}>
                <i /><span><small>Tavoite</small>Varmempi kakkossyöttö</span>
              </div>
              <div className="kf-tag" ref={r('streak')} style={{ left: L.steps.tag[0], top: L.steps.tag[1] }}>5 viikon putki</div>
            </div>

            {/* 24.5–29.6 */}
            <div className="kf-layer" ref={r('stackLayer')}>
              {['Suunnittele.', 'Merkitse.', 'Kehity.'].map((w, i) => (
                <div key={w} className="kf-line kf-stack-line" ref={r(`stack${i}`)} style={{ top: L.stack.cy - L.stack.size * 0.55, width: L.W, fontSize: L.stack.size }}>
                  <span className="kf-mask">
                    <span className="kf-word" ref={r(`stackw${i}`)}>
                      <span className="kf-word-hl" ref={r(`stackhl${i}`)} />
                      {i < 2 ? w : (
                        <span className="kf-logo">
                          <span>K</span>
                          <span className="kf-roll" ref={r('roll')}><span className="kf-roll-in" ref={r('rollIn')}><span ref={r('rollA')}>ehity.</span><span ref={r('rollB')}>rossi</span></span></span>
                          <span className="kf-logo-ball" ref={r('logoBall')}><span className="kf-logo-ball-in" ref={r('logoBallIn')}><KfBallSvg size="100%" id="logo" /></span></span>
                          <span className="kf-logo-sub" ref={r('logoSub')}><span ref={r('logoSubIn')}>Koutsi</span></span>
                        </span>
                      )}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* the page's hero: where the film ends, and stays */}
          <div className="kf-end" ref={r('end')}>
            <div className="kf-eyebrow kf-end-eyebrow" ref={r('endEyebrow')} style={{ top: L.end.eyebrow, width: L.W, fontSize: L.end.eyebrowSize }}><i />Tenniksen valmentajille ja pelaajille</div>
            <h1 className="kf-h1" style={{ fontSize: L.end.size }}>
              {L.end.lines.map((parts, i) => (
                <span key={i} className="kf-line" style={{ top: L.end.top + i * L.end.lh, width: L.W }}>
                  <span className="kf-mask">
                    <span className="kf-word" ref={r(`endl${i}`)}>
                      {parts.map((p) => (p.startsWith('*')
                        ? <span key={p} className="kf-hl-word"><span className="kf-word-hl" ref={r('endHl')} />{p.slice(1)}</span>
                        : <React.Fragment key={p}>{p}</React.Fragment>))}
                    </span>
                  </span>
                  {i < L.end.lines.length - 1 && ' '}
                </span>
              ))}
            </h1>
          </div>
        </div>
        {/* in the empty space under the last words, once the film has ended */}
        <button type="button" className="kf-replay" onClick={replay} aria-label="Katso video uudelleen" title="Katso uudelleen" tabIndex={state === 'end' ? 0 : -1}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></svg>
        </button>
      </div>
      <div className="kf-actions">
        <a href={KF_SIGNUP} className="btn-lime btn-lg">Aloita treenaaminen →</a>
      </div>
    </section>
  );
}

Object.assign(window, { KoutsiFilm });
