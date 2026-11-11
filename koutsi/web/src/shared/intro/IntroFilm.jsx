// IntroFilm.jsx — the short film a new coach or player sees the first time Koutsi opens: one
// scene per place in the app (what is where), then "Aloitetaan" with the first steps.
//
// It plays like a story: progress bars on top, each scene runs by itself, a tap on the picture
// moves on, holding it pauses, ← and → step, and "Ohita" jumps straight to the first steps.
// The pictures are drawn (scenes.jsx), in the same flat look as the koutsi.krossi.app film: a
// phone with the real tab bar on a phone, a window with the side nav on a computer, and the
// place the scene talks about lit up.
//
// Time runs in one requestAnimationFrame loop that writes the active bar's width straight to
// the DOM (no re-render per frame) and stops while paused, held or in a hidden tab. The drawings
// animate with CSS, paused by the same flag. Under reduced motion base.css cuts every animation to
// 1 ms, so things still appear and go at their moments, just without moving.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Icon, IconButton, Sheet } from '../../ui/index.js';
import { Device } from './scenes.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const HOLD_MS = 220;

/** Scale a drawing of base size w×h to fit its box (a little over 1 at most). */
function useFit(ref, w, h) {
  const [k, setK] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setK(Math.min(r.width / w, r.height / h, 1.12));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, w, h]);
  return k;
}

/** Whether the page is visible (a hidden tab pauses the film). */
function usePageVisible() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/**
 * IntroFilm
 *   open, onClose      closing (✕, Esc, Back, the finale's own buttons) is the caller's onClose
 *   scenes             [{ id, lit, tap?, eyebrow, title, text, ms, screen, overlay? }]
 *   role               'coach' | 'player' (which nav the drawing has)
 *   desktop            draw the computer's side nav instead of the phone's tab bar
 *   me                 { name } for the drawing's avatar
 *   finale             the last card (first steps), rendered after the scenes
 *   onEvent(name)      'ohita' | 'loppuun' (usage counts, optional)
 *   start              the scene to open on (0 = the first; ?esittely=3 opens the third)
 */
export function IntroFilm({ open, onClose, scenes, role, desktop, me, finale, onEvent, start = 0 }) {
  const [index, setIndex] = useState(() => Math.min(Math.max(0, start), scenes.length));
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const visible = usePageVisible();
  const atFinale = index >= scenes.length;
  const scene = atFinale ? null : scenes[index];
  const running = open && !atFinale && !paused && !held && visible;

  // a new opening starts from the top
  useEffect(() => {
    if (open) { setIndex(Math.min(Math.max(0, start), scenes.length)); setPaused(false); setHeld(false); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // stepping also lets a paused film run again (a paused new scene would be an empty picture)
  const next = useCallback(() => {
    if (index + 1 === scenes.length) onEvent?.('loppuun');
    setPaused(false);
    setIndex(Math.min(index + 1, scenes.length));
  }, [index, scenes.length, onEvent]);
  const back = useCallback(() => { setPaused(false); setIndex(Math.max(0, index - 1)); }, [index]);
  const skip = () => { onEvent?.('ohita'); setIndex(scenes.length); };

  // the clock of the scene on screen; the bars after it are empty again (← from a half-run scene)
  const bars = useRef(null);
  const bar = useRef(null);
  const elapsed = useRef(0);
  const nextRef = useRef(next);
  nextRef.current = next;
  useLayoutEffect(() => {
    elapsed.current = 0;
    bars.current?.querySelectorAll('.ki-bar-fill').forEach((el, i) => { el.style.transform = i < index ? 'none' : 'scaleX(0)'; });
  }, [index, open]);
  useEffect(() => {
    if (!running || !scene) return undefined;
    let last = performance.now();
    let raf = 0;
    const tick = (now) => {
      elapsed.current += Math.min(now - last, 100); // a stalled frame doesn't jump the film
      last = now;
      const p = Math.min(1, elapsed.current / scene.ms);
      if (bar.current) bar.current.style.transform = `scaleX(${p})`;
      if (p >= 1) { nextRef.current(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, scene]);

  // ← → step through the scenes
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === 'ArrowRight' && !atFinale) { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); back(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, atFinale, index, next, back]);

  // a tap on the picture moves on; holding it pauses until let go
  const holdTimer = useRef(0);
  const holding = useRef(false);
  const press = (e) => {
    if (e.button != null && e.button !== 0) return;
    holding.current = false;
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => { holding.current = true; setHeld(true); }, HOLD_MS);
  };
  const release = (tapped) => {
    clearTimeout(holdTimer.current);
    if (holding.current) { holding.current = false; setHeld(false); return; }
    if (tapped) next();
  };
  useEffect(() => () => clearTimeout(holdTimer.current), []);

  const artBox = useRef(null);
  const base = desktop ? { w: 660, h: 420 } : { w: 330, h: 500 };
  const k = useFit(artBox, base.w, base.h);
  const stopped = paused || held || !visible;

  return (
    <Sheet open={open} onClose={onClose} size="full" className={cx('k-intro', desktop ? 'k-intro-desktop' : 'k-intro-phone')} labelledBy="k-intro-title">
      <div className="ki-top">
        <div ref={bars} className="ki-bars" aria-hidden="true">
          {scenes.map((s, i) => (
            <span key={s.id} className="ki-bar">
              <span ref={i === index ? bar : null} className="ki-bar-fill" />
            </span>
          ))}
        </div>
        <div className="ki-top-row">
          <span className="ki-count">{atFinale ? 'Valmista' : `${index + 1}/${scenes.length}`}</span>
          {!atFinale && (
            <>
              <IconButton icon={paused ? 'play' : 'pause'} label={paused ? 'Jatka esittelyä' : 'Pysäytä esittely'} variant="soft" size="sm" onClick={() => setPaused((p) => !p)} />
              <button type="button" className="ki-skip" onClick={skip}>Ohita</button>
            </>
          )}
          {atFinale && <IconButton icon="close" label="Sulje" variant="soft" size="sm" onClick={onClose} />}
        </div>
      </div>

      {atFinale ? (
        <div className="ki-finale">{finale}</div>
      ) : (
        <div className="ki-stage">
          <div key={`t-${index}`} className="ki-copy" aria-live="polite">
            {scene.eyebrow && <div className="ki-eyebrow">{scene.eyebrow}</div>}
            <h2 id="k-intro-title" className="ki-title">{scene.title}</h2>
            <p className="ki-text">{scene.text}</p>
          </div>
          <div
            ref={artBox}
            className="ki-art"
            aria-hidden="true"
            onPointerDown={press}
            onPointerUp={() => release(true)}
            onPointerCancel={() => release(false)}
            onPointerLeave={() => { if (holding.current) release(false); else clearTimeout(holdTimer.current); }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className={cx('ki-art-fit', stopped && 'is-paused')} style={{ width: base.w, height: base.h, transform: `translate(-50%, -50%) scale(${k})`, opacity: k ? 1 : 0 }}>
              <Device key={`a-${index}`} desktop={desktop} role={role} me={me} lit={scene.lit} tap={scene.tap} overlay={scene.overlay}>
                {scene.screen}
              </Device>
            </div>
          </div>
          <div className="ki-nav">
            <IconButton icon="arrow-left" label="Edellinen" variant="soft" onClick={back} disabled={index === 0} className={cx('ki-back', index === 0 && 'is-hidden')} />
            <Button variant="dark" size="lg" iconRight="arrow-right" onClick={next} className="ki-next">
              {index === scenes.length - 1 ? 'Aloitetaan' : 'Seuraava'}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** The finale's numbered first steps; a done step gets a tick. */
export function IntroSteps({ steps }) {
  return (
    <ol className="ki-steps">
      {steps.map((s, i) => (
        <li key={s.title} className={cx('ki-step', s.done && 'is-done')} style={{ '--i': i }}>
          <span className="ki-step-num">{s.done ? <Icon name="check" size={16} strokeWidth={2.6} /> : i + 1}</span>
          <span className="ki-step-copy"><strong>{s.title}</strong><span>{s.text}</span></span>
        </li>
      ))}
    </ol>
  );
}

/** ?esittely opens the film (?esittely=3 on its third scene): returns [asked, start index]. */
export function introAskedInUrl() {
  if (typeof window === 'undefined') return [false, 0];
  const q = new URLSearchParams(window.location.search);
  if (!q.has('esittely')) return [false, 0];
  const n = parseInt(q.get('esittely'), 10);
  return [true, Number.isFinite(n) && n > 0 ? n - 1 : 0];
}

// "Katso esittely" (Profiili) opens the film again: the app shell listens for this.
const REPLAY_EVENT = 'koutsi:esittely';
export function replayIntro() {
  window.dispatchEvent(new Event(REPLAY_EVENT));
}
export function useIntroReplay(onReplay) {
  const ref = useRef(onReplay);
  ref.current = onReplay;
  useEffect(() => {
    const on = () => ref.current();
    window.addEventListener(REPLAY_EVENT, on);
    return () => window.removeEventListener(REPLAY_EVENT, on);
  }, []);
}
