// DemoTour — the guided tour of krossi.app/demo: a welcome card, then ten steps that each open a
// page of the app and light up one thing on it (the rest dims), with a card that says what it is.
//
// The tour drives the real app: each step navigates (replace, so Back after the tour still leaves
// the demo where it came from), waits for its target to render and settle, scrolls it into view and
// moves the lit-up hole there. The hole glides between targets on the same page and opens from the
// centre on a new one. The page underneath can't be tapped while the tour is open — the card's
// buttons (or ← → Esc) move it. Steps live in tourSteps.js, open/closed in tourState.js.
//
// Opens by itself on the first visit (not inside the landing page's phone frame, nor after coming in
// from the booking site krossi.app/varaa — "Etsi pelikaveri" must open the game, not a tour);
// ?opastus=1 opens it anyway and ?opastus=0 never. Profiili → Näytä opastus opens it again.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useIsDesktop } from '../../app/hooks.js';
import { navigate, useRoute } from '../../app/router.js';
import { Button, Icon, IconButton, ListRow, TennisBall, confetti } from '../../ui/index.js';
import { STEPS, TOUR_TOPICS } from './tourSteps.js';
import { cameFromSite, closeTour, inFrame, setTourStep, startTour, tourSeen, useTourStep } from './tourState.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const PAD = 6; // space between the target and the edge of the hole
const MARGIN = 16; // the card keeps this far from the screen edges
const GAP = 14; // between the hole and the card
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findTargets(target) {
  const els = [];
  for (const t of [].concat(target || [])) {
    const sel = typeof t === 'string' ? t : t.sel;
    const max = typeof t === 'string' ? 1 : t.max || 1;
    els.push(...[...document.querySelectorAll(sel)].filter((el) => el.getClientRects().length > 0).slice(0, max));
  }
  return els;
}

function unionRect(els) {
  if (!els.length) return null;
  let top = Infinity; let left = Infinity; let right = -Infinity; let bottom = -Infinity;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    top = Math.min(top, r.top); left = Math.min(left, r.left);
    right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
  }
  if (right - left < 1 || bottom - top < 1) return null;
  return { top, left, width: right - left, height: bottom - top };
}

const sameRect = (a, b) => a && b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5
  && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

/** Sticky top bar / tab bar and their contents never move when the page scrolls. */
function isPinned(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const pos = getComputedStyle(n).position;
    if (pos === 'fixed' || pos === 'sticky') return true;
  }
  return false;
}

/** The part of the screen not covered by the demo banner, a sticky top bar or the tab bar. */
function safeArea() {
  const vh = window.innerHeight;
  const bars = [...document.querySelectorAll('.demo-banner, .topbar')].map((el) => el.getBoundingClientRect().bottom);
  const tabbar = document.querySelector('.tabbar')?.getBoundingClientRect();
  return { top: Math.max(0, ...bars), bottom: tabbar ? vh - tabbar.top : 0, vh };
}

/** Wait until the target exists and stops moving (pages load and slide in), or give up. */
async function settledTargets(target, alive, timeout = 5000) {
  const end = Date.now() + timeout;
  let last = null; let still = 0;
  while (alive() && Date.now() < end) {
    const els = findTargets(target);
    const r = unionRect(els);
    if (r && sameRect(r, last)) {
      still += 1;
      if (still >= 4) return els;
    } else {
      still = 0;
    }
    last = r;
    await sleep(60);
  }
  return null;
}

/** Scroll so the target and the card both fit; leave pinned targets (top bar, tab bar) alone. */
function bringIntoView(els, cardH) {
  if (!els.length || els.some(isPinned)) return;
  const r = unionRect(els);
  if (!r) return;
  const safe = safeArea();
  const bandTop = safe.top + 12;
  const bandBottom = safe.vh - safe.bottom - 12;
  const visible = r.top >= bandTop && r.top + r.height <= bandBottom;
  const roomForCard = r.top - bandTop >= cardH + GAP || bandBottom - (r.top + r.height) >= cardH + GAP;
  if (visible && roomForCard) return;
  window.scrollTo({ top: Math.max(0, window.scrollY + r.top - bandTop - PAD), behavior: 'smooth' });
}

/** Where the card goes: below / above the hole, beside it on the desktop side nav, or floating. */
function placeCard(hole, vp, cardH, desktop) {
  const w = Math.min(desktop ? 380 : 440, vp.w - MARGIN * 2);
  const clampX = (x) => Math.max(MARGIN, Math.min(vp.w - w - MARGIN, x));
  const clampY = (y) => Math.max(MARGIN, Math.min(vp.h - cardH - MARGIN, y));
  if (!hole) return { side: 'center', w, top: clampY((vp.h - cardH) / 2), left: (vp.w - w) / 2 };
  const cx = hole.left + hole.width / 2;
  const cy = hole.top + hole.height / 2;
  const right = vp.w - (hole.left + hole.width) - GAP - MARGIN;
  if (desktop && hole.left < 280 && hole.width < 300 && right >= w) {
    const top = clampY(cy - cardH / 2);
    return { side: 'right', w, top, left: hole.left + hole.width + GAP, arrow: Math.max(22, Math.min(cardH - 22, cy - top)) };
  }
  const below = vp.h - (hole.top + hole.height) - GAP - MARGIN;
  const above = hole.top - GAP - MARGIN;
  const left = clampX(cx - w / 2);
  const arrow = Math.max(22, Math.min(w - 22, cx - left));
  if (below >= cardH) return { side: 'bottom', w, top: hole.top + hole.height + GAP, left, arrow };
  if (above >= cardH) return { side: 'top', w, top: hole.top - GAP - cardH, left, arrow };
  return { side: 'float', w, top: below >= above ? vp.h - cardH - MARGIN : MARGIN, left };
}

export function DemoTour() {
  const step = useTourStep();
  useEffect(() => {
    const ask = new URLSearchParams(window.location.search).get('opastus');
    if (inFrame() || ask === '0' || (ask !== '1' && (tourSeen() || cameFromSite()))) return undefined;
    const timer = setTimeout(startTour, 900);
    return () => clearTimeout(timer);
  }, []);
  if (step == null) return null;
  return <TourLayer step={step} />;
}

function TourLayer({ step }) {
  const desktop = useIsDesktop();
  const route = useRoute();
  const here = useRef('');
  here.current = `${route.path}${route.search || ''}`;
  const def = step > 0 ? STEPS[step - 1] : null;
  const last = step === STEPS.length;

  const [hole, setHole] = useState(null); // lit-up area in viewport px; null = all dim
  const [ready, setReady] = useState(true); // the card shows once the step's page is there
  const [gliding, setGliding] = useState(false); // hole and card animate only right after a step change
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [cardH, setCardH] = useState(240);
  const [nudge, setNudge] = useState(0);
  const cardRef = useRef(null);
  const primaryRef = useRef(null);

  const glide = useCallback(() => {
    setGliding(true);
    const timer = setTimeout(() => setGliding(false), 700);
    return () => clearTimeout(timer);
  }, []);

  // Enter a step: open its page, wait for the target to settle, scroll it into view.
  useEffect(() => {
    if (!def) { setHole(null); setReady(true); return glide(); }
    let alive = true;
    const isAlive = () => alive;
    const stopGlide = glide();
    (async () => {
      const path = typeof def.path === 'function' ? await def.path().catch(() => null) : def.path;
      if (!alive) return;
      const moving = Boolean(path) && path !== here.current;
      if (moving) {
        setReady(false);
        navigate(path, { replace: true });
      }
      const els = await settledTargets(def.target, isAlive);
      if (!alive) return;
      if (els) bringIntoView(els, cardRef.current?.offsetHeight || 240);
      setReady(true);
    })();
    return () => { alive = false; stopGlide(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Follow the target every frame (scrolling, slide-in animations, late layout).
  useEffect(() => {
    let raf = 0;
    let prev; // undefined until the first frame: a new step always replaces the last step's hole
    let wasEmpty = true;
    const tick = () => {
      const r = def ? unionRect(findTargets(def.target)) : null;
      let next = null;
      if (r) {
        // Never over the demo banner: it stays on top of everything.
        const banner = document.querySelector('.demo-banner')?.getBoundingClientRect().bottom || 0;
        const top = Math.max(r.top - PAD, banner + 4);
        const bottom = Math.min(r.top + r.height + PAD, window.innerHeight - 4);
        next = { top, left: r.left - PAD, width: r.width + PAD * 2, height: Math.max(bottom - top, 0) };
      }
      if (prev === undefined || (next ? !sameRect(next, prev) : prev !== null)) {
        if (next && wasEmpty) glide();
        wasEmpty = !next;
        prev = next;
        setHole(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [def, glide]);

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return undefined;
    const measure = () => setCardH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [step]);

  const next = useCallback(() => {
    if (step >= STEPS.length) {
      closeTour();
      confetti({ count: 120 });
      return;
    }
    setTourStep(step + 1);
  }, [step]);
  const prev = useCallback(() => { if (step > 1) setTourStep(step - 1); }, [step]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') closeTour();
      else if (e.key === 'ArrowRight' && step > 0) next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, next, prev]);

  useEffect(() => {
    if (ready) primaryRef.current?.focus({ preventScroll: true });
  }, [ready, step]);

  const place = placeCard(def ? hole : null, vp, cardH, desktop);
  const holeStyle = hole
    ? { top: hole.top, left: hole.left, width: hole.width, height: hole.height, borderRadius: Math.min(def?.radius ?? 16, hole.height / 2, hole.width / 2) + PAD }
    // Closed: a 2 px filled dot (a zero-size box paints no shadow, so nothing would dim).
    : { top: vp.h / 2 - 1, left: vp.w / 2 - 1, width: 2, height: 2, borderRadius: 999 };
  const text = def && (typeof def.text === 'function' ? def.text({ desktop }) : def.text);

  return (
    <div className={cx('tour', gliding && 'is-gliding', !def && 'is-welcome')}>
      <div className="tour-block" onClick={() => setNudge((n) => n + 1)} aria-hidden="true" />
      <div className={cx('tour-hole', !hole && 'is-closed')} style={holeStyle} aria-hidden="true" />
      {def && hole && (
        <div className="tour-ring" style={holeStyle} aria-hidden="true">
          <span key={step} className="tour-ping" />
        </div>
      )}

      {def ? (
        <div
          ref={cardRef}
          className={cx('tour-card', `is-${place.side}`, !ready && 'is-hidden')}
          style={{ top: place.top, left: place.left, width: place.w, '--arrow': place.arrow != null ? `${place.arrow}px` : undefined }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          aria-describedby="tour-text"
        >
          {place.arrow != null && <span className="tour-arrow" aria-hidden="true" />}
          <div key={`n${nudge}`} className={cx('tour-card-inner', nudge > 0 && 'is-nudged')}>
            <div className="tour-card-head">
              <span className="tour-icon" aria-hidden="true"><Icon name={def.icon} size={17} strokeWidth={2.2} /></span>
              <span className="tour-area">{def.area}</span>
              <span className="tour-count t-num" aria-label={`Askel ${step}/${STEPS.length}`}>{step}<span>/{STEPS.length}</span></span>
              <IconButton icon="close" label="Lopeta opastus" size="sm" className="tour-close" onClick={closeTour} />
            </div>
            <div key={step} className="tour-card-body" aria-live="polite">
              <h2 id="tour-title" className="tour-title">{def.title}</h2>
              <p id="tour-text" className="tour-text">{text}</p>
            </div>
            <div className="tour-progress" aria-hidden="true">
              {STEPS.map((s, i) => <span key={s.id} className={cx('tour-pip', i < step - 1 && 'is-done', i === step - 1 && 'is-now')} />)}
            </div>
            <div className="tour-actions">
              {step > 1 ? <Button variant="ghost" size="sm" icon="arrow-left" onClick={prev}>Takaisin</Button> : <span />}
              <Button ref={primaryRef} variant={last ? 'lime' : 'dark'} iconRight={last ? 'check' : 'arrow-right'} onClick={next}>
                {last ? 'Valmis' : 'Seuraava'}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div
          ref={cardRef}
          className="tour-card tour-welcome on-dark is-center"
          style={{ top: place.top, left: place.left, width: place.w }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          aria-describedby="tour-text"
        >
          <div key={`n${nudge}`} className={cx('tour-card-inner', nudge > 0 && 'is-nudged')}>
            <div className="tour-welcome-ball" aria-hidden="true"><TennisBall size={54} /></div>
            <div className="tour-welcome-eyebrow">Opastus · {STEPS.length} askelta</div>
            <h2 id="tour-title" className="tour-welcome-title">Tervetuloa Krossiin</h2>
            <p id="tour-text" className="tour-welcome-text">
              Krossissa varaat kentän ja löydät peliseuraa. Näytämme askel kerrallaan, missä mikäkin on – myös
              henkilökunnan näkymän ja laskutuksen.
            </p>
            <ul className="tour-topics">
              {TOUR_TOPICS.map((t, i) => <li key={t} style={{ '--i': i }}>{t}</li>)}
            </ul>
            <div className="tour-welcome-actions">
              <Button ref={primaryRef} variant="lime" size="lg" block iconRight="arrow-right" onClick={() => setTourStep(1)}>Aloita opastus</Button>
              <button type="button" className="tour-welcome-skip" onClick={closeTour}>Tutustun itse</button>
            </div>
            <p className="tour-welcome-note">Noin minuutti. Opastuksen saa myöhemmin Profiilista.</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Profiili → "Näytä opastus" (demo only). */
export function TourRestartRow() {
  return (
    <div className="list-group tour-restart" data-tour="tour-restart">
      <ListRow icon="play" title="Näytä opastus" subtitle={`Käy läpi, miten Krossi toimii – ${STEPS.length} askelta`} onClick={startTour} />
    </div>
  );
}
