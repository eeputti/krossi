// StoryPlayer — full-screen story slides like Instagram stories.
//
//   <StoryPlayer slides={[{ id, bg, Component, celebrate }]} ctx={propsForSlides} label="Syyskuu 2026"
//                onClose={fn} blocked={bool} />
//
// Segmented progress bars, auto-advance (DURATION per slide, stops on the last one), tap the
// right/left half to go forward/back, press and hold to pause, arrow keys / space / Esc on
// desktop. `blocked` (e.g. a sheet is open on top) pauses everything. prefers-reduced-motion
// turns auto-advance off.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconButton, confetti, TennisBall } from '../../ui/index.js';
import { LIGHT_BGS } from './slides.jsx';

const DURATION = 5200;
const HOLD_MS = 220;
const cx = (...c) => c.filter(Boolean).join(' ');
const sheetOpen = () => !!document.querySelector('.sheet-root');

export function StoryPlayer({ slides, ctx, label, onClose, blocked = false }) {
  const reduced = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
  const [index, setIndex] = useState(0);
  const [restart, setRestart] = useState(0);
  const [holding, setHolding] = useState(false);
  const [manualPause, setManualPause] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const barsRef = useRef(null);
  const elapsed = useRef(0);
  const holdTimer = useRef(null);
  const held = useRef(false);
  const celebrated = useRef(new Set());

  const count = slides.length;
  const slide = slides[Math.min(index, count - 1)];
  const isLast = index >= count - 1;
  const autoplay = !reduced && count > 1;
  const paused = holding || manualPause || hidden || blocked;

  const go = useCallback((step) => {
    elapsed.current = 0;
    setIndex((i) => Math.max(0, Math.min(count - 1, i + step)));
    setRestart((r) => r + 1);
  }, [count]);

  const paint = useCallback((k) => {
    const bars = barsRef.current;
    if (!bars) return;
    bars.querySelectorAll('.recap-bar-fill').forEach((fill, i) => {
      fill.style.transform = `scaleX(${i < index ? 1 : i > index ? 0 : k})`;
    });
  }, [index]);

  // Paint synchronously on every slide change so a bar never flashes full or empty.
  useLayoutEffect(() => {
    paint(!autoplay || isLast ? 1 : elapsed.current / DURATION);
  }, [paint, autoplay, isLast, restart]);

  useEffect(() => {
    if (!autoplay || isLast || paused) return undefined;
    let raf;
    let last = performance.now();
    const tick = (t) => {
      // Any sheet on top (paywall, "Pelasitteko?", create game) holds the story.
      if (sheetOpen()) { last = t; raf = requestAnimationFrame(tick); return; }
      elapsed.current += Math.min(100, t - last);
      last = t;
      const k = Math.min(1, elapsed.current / DURATION);
      paint(k);
      if (k >= 1) { go(1); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoplay, isLast, paused, paint, go, restart]);

  // Confetti once per celebrating slide (new badges).
  useEffect(() => {
    if (!slide?.celebrate || celebrated.current.has(slide.id)) return undefined;
    celebrated.current.add(slide.id);
    const t = setTimeout(() => confetti({ count: 110 }), 520);
    return () => clearTimeout(t);
  }, [slide]);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (blocked) return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || sheetOpen()) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === ' ' && !(e.target instanceof HTMLElement && e.target.closest('button:not(.recap-tap), a, input, textarea'))) {
        e.preventDefault();
        setManualPause((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [blocked, go, onClose]);

  useEffect(() => () => clearTimeout(holdTimer.current), []);

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    held.current = false;
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => { held.current = true; setHolding(true); }, HOLD_MS);
  };
  const endHold = () => {
    clearTimeout(holdTimer.current);
    if (held.current) setHolding(false);
  };
  const tap = (step) => () => {
    if (held.current) { held.current = false; return; }
    setManualPause(false);
    go(step);
  };
  const zone = (step, labelText) => (
    <button
      type="button"
      className={cx('recap-tap', step < 0 ? 'recap-tap-prev' : 'recap-tap-next')}
      aria-label={labelText}
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      onPointerCancel={endHold}
      onContextMenu={(e) => e.preventDefault()}
      onClick={tap(step)}
    />
  );

  const light = LIGHT_BGS.has(slide.bg);
  const { Component } = slide;
  return (
    <div className={cx('recap', `recap-bg-${slide.bg}`)} role="region" aria-roledescription="tarina" aria-label={`Kooste: ${label}`}>
      <div className="recap-backdrop" aria-hidden="true" />
      <IconButton icon="chevron-left" label="Edellinen" variant="on-dark" size="lg" className="recap-arrow" onClick={() => go(-1)} disabled={index === 0} />
      <div className={cx('recap-story', light && 'is-light', holding && 'is-holding')}>
        <div className="recap-top">
          {count > 1 && (
            <div className="recap-bars" ref={barsRef}>
              {slides.map((s) => <span key={s.id} className="recap-bar" aria-hidden="true"><span className="recap-bar-fill" /></span>)}
            </div>
          )}
          <div className="recap-head">
            <span className="recap-brand"><TennisBall size={16} className="recap-brand-ball" />Krossi · {label}</span>
            {paused && !holding && !blocked && (
              <button type="button" className="recap-paused" onClick={() => setManualPause(false)} aria-label="Jatka toistoa">
                <span className="recap-paused-icon" aria-hidden="true" />Tauko
              </button>
            )}
            <IconButton icon="close" label="Sulje kooste" className="recap-close" onClick={onClose} />
          </div>
        </div>
        {count > 1 && zone(-1, 'Edellinen dia')}
        {count > 1 && zone(1, 'Seuraava dia')}
        <div key={`${slide.id}-${index}`} className="recap-slide">
          <Component {...ctx} />
        </div>
        <span className="sr-only" aria-live="polite">Dia {index + 1} / {count}</span>
      </div>
      <IconButton icon="chevron-right" label="Seuraava" variant="on-dark" size="lg" className="recap-arrow" onClick={() => go(1)} disabled={isLast} />
    </div>
  );
}
