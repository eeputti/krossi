// Sheet.jsx — bottom sheet on phones, centered dialog on desktop. Plus useConfirm().
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton, Button } from './primitives.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const EXIT_MS = 240;
const OPEN_GUARD_MS = 350;

let openCount = 0;
let lockedAt = null; // page the scroll position belongs to
function lockScroll() {
  if (openCount++ === 0) {
    const y = window.scrollY;
    lockedAt = window.location.href;
    document.body.dataset.scrollY = String(y);
    document.body.classList.add('sheet-open');
    document.body.style.top = `-${y}px`;
  }
}
function unlockScroll() {
  if (--openCount === 0) {
    const y = Number(document.body.dataset.scrollY || 0);
    document.body.classList.remove('sheet-open');
    document.body.style.top = '';
    delete document.body.dataset.scrollY;
    // A route change closed the sheet: the new page owns its own scroll position.
    if (window.location.href === lockedAt) window.scrollTo(0, y);
    lockedAt = null;
  }
}

// Open sheets, oldest first: Escape and focus belong to the top-most one only.
const sheetStack = [];
/** True while any Sheet is open (used by things that would otherwise pop a sheet on top). */
export const isAnySheetOpen = () => sheetStack.length > 0;

// ── back button / swipe-back closes the top sheet ──────────────────────────
// Each open sheet owns one history entry (same address, state.sheetGuard). Back pops it, and the
// popstate below closes the sheet instead of changing the page under it — or, on the first page
// of the app, instead of leaving the app with a half-written note. A sheet closed by its own
// buttons takes its entry back with history.back(); a sheet opening in the same moment (one sheet
// leading to the next) takes the entry over instead. navigate() replaces a guard entry rather than
// pushing on top of it (router.js), so Back from the new page lands on the page under the sheet.
const guards = []; // { id, tryClose() } of open sheets, oldest first
let released = null; // { id, timer }: the entry of a sheet that just closed, for a sheet opening right after
let ignorePops = 0;
let guardSeq = 0;
const currentGuard = () => window.history.state?.sheetGuard;
function claimGuard(entry) {
  const st = window.history.state || {};
  if (released && currentGuard() === released.id) {
    clearTimeout(released.timer);
    window.history.replaceState({ ...st, sheetGuard: entry.id }, '', window.location.href);
  } else {
    window.history.pushState({ ...st, sheetGuard: entry.id }, '', window.location.href);
  }
  released = null;
  guards.push(entry);
}
function releaseGuard(entry) {
  const i = guards.indexOf(entry);
  if (i < 0) return; // already handled by Back
  guards.splice(i, 1);
  if (currentGuard() !== entry.id) return; // a navigation took the entry over
  const id = entry.id;
  const timer = setTimeout(() => {
    if (released?.id === id) released = null;
    if (currentGuard() !== id) return;
    ignorePops += 1;
    setTimeout(() => { ignorePops = Math.max(0, ignorePops - 1); }, 600);
    window.history.back();
  }, 0);
  released = { id, timer };
}
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) { ignorePops -= 1; return; }
    const top = guards[guards.length - 1];
    if (!top || currentGuard() === top.id) return;
    guards.pop();
    // The sheet says no (busy, or the person keeps what they wrote): it stays, with its entry back.
    // Wait a moment first: a "Hylätäänkö?" dialog that just closed takes its own entry away, and
    // an entry left behind by a sheet no longer open is taken over instead of stacking on it (a
    // leftover entry made the next Back do nothing).
    Promise.resolve(top.tryClose()).then((closed) => {
      if (closed) return;
      setTimeout(() => {
        const cur = currentGuard();
        const stale = cur && !guards.some((g) => g.id === cur);
        const st = { ...(window.history.state || {}), sheetGuard: top.id };
        if (stale) window.history.replaceState(st, '', window.location.href);
        else if (cur !== top.id) window.history.pushState(st, '', window.location.href);
        guards.push(top);
      }, 80);
    });
  });
}

/** Keeps a sheet above the on-screen keyboard: the root follows the visual viewport. */
function useKeyboardInset(rootRef, active) {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = rootRef.current;
    if (!active || !vv || !root) return undefined;
    const update = () => {
      const bottom = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const keyboard = bottom > 80;
      root.style.top = keyboard ? `${Math.round(vv.offsetTop)}px` : '';
      root.style.bottom = keyboard ? `${bottom}px` : '';
      root.classList.toggle('has-keyboard', keyboard);
      const el = document.activeElement;
      if (keyboard && el && root.contains(el) && typeof el.scrollIntoView === 'function') {
        requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
      }
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, [rootRef, active]);
}

const DRAG_CLOSE_PX = 110;
const DRAG_CLOSE_VELOCITY = 0.7; // px/ms
const DRAG_FLICK_MIN_PX = 40; // a flick closes only after a real pull, not a jittery tap
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Sheet
 *   open, onClose
 *   title, subtitle         header (omit both for a header-less sheet, e.g. custom hero)
 *   footer                  sticky action area at the bottom (buttons)
 *   size: 'sm' | 'md' | 'lg' | 'full'   (desktop width; 'full' = full height on phones)
 *   dismissible             default true: backdrop tap, Esc, ✕, Back and drag-down close it
 *   confirmClose            true (or { title, message }) while something typed would be lost: closing by
 *                           those gestures asks "Hylätäänkö?" first. The form's own Peruuta still closes.
 *   onBack                  a step back inside the sheet (a drill → its list): return true when it took the
 *                           step, and the phone's Back stops there instead of closing the sheet
 *   tone: 'default' | 'dark'
 *   onClosed                called after the exit animation finished
 */
export function Sheet({ open, onClose, title, subtitle, footer, size = 'md', dismissible = true, confirmClose = false, onBack, tone = 'default', className, bodyClassName, onClosed, children, labelledBy }) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  // a quick double tap on what opened the sheet must not land on its backdrop (closing it at once)
  // or on a row of it while it slides up
  const [opening, setOpening] = useState(false);
  const openedAt = useRef(0);
  const root = useRef(null);
  const panel = useRef(null);
  const grabZone = useRef(null);
  const body = useRef(null);
  const restoreFocus = useRef(null);
  // Read through refs so the keyboard effect below runs once per open: callers pass inline
  // onClose arrows, and re-subscribing on every render would re-push this sheet to the top of
  // the stack above a sheet opened after it (e.g. a confirm dialog).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;
  const confirm = useContext(ConfirmContext);
  const confirmCloseRef = useRef(confirmClose);
  confirmCloseRef.current = confirmClose;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  // Every way out except the form's own buttons: backdrop, ✕, Esc, drag, Back. Resolves whether it closed.
  const requestClose = useCallback(async () => {
    if (!dismissibleRef.current) return false;
    const ask = confirmCloseRef.current;
    if (ask && confirm) {
      const ok = await confirm({
        title: ask.title || 'Hylätäänkö kirjoittamasi?',
        message: ask.message || 'Teksti ei ole vielä tallessa.',
        confirmLabel: 'Hylkää', cancelLabel: 'Jatka kirjoittamista', danger: true,
      });
      if (!ok) return false;
    }
    onCloseRef.current?.();
    return true;
  }, [confirm]);
  useKeyboardInset(root, mounted && !closing);

  useEffect(() => {
    if (open) {
      setMounted(true); setClosing(false); setOpening(true);
      openedAt.current = performance.now();
      const t = setTimeout(() => setOpening(false), OPEN_GUARD_MS);
      return () => clearTimeout(t);
    }
    if (!mounted) return undefined;
    setClosing(true);
    const t = setTimeout(() => { setMounted(false); setClosing(false); onClosed?.(); }, EXIT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!mounted) return undefined;
    lockScroll();
    restoreFocus.current = document.activeElement;
    // A field with autoFocus already holds focus: leave it there (taking it pops the keyboard down again).
    const t = setTimeout(() => { if (!panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true }); }, 30);
    return () => { clearTimeout(t); unlockScroll(); restoreFocus.current?.focus?.({ preventScroll: true }); };
  }, [mounted]);

  useEffect(() => {
    if (!open) return undefined;
    const token = {};
    sheetStack.push(token);
    // Back first takes a step inside the sheet when it has one (onBack returns true), and only then closes it.
    const guard = { id: `s${Date.now().toString(36)}-${(guardSeq += 1)}`, tryClose: () => (onBackRef.current?.() === true ? false : requestClose()) };
    claimGuard(guard);
    const onKey = (e) => {
      if (sheetStack[sheetStack.length - 1] !== token) return;
      if (e.key === 'Escape' && dismissibleRef.current) { e.preventDefault(); requestClose(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      // Keep keyboard focus inside the dialog (aria-modal). Collapsed (inert) sections can't take focus.
      const items = [...panel.current.querySelectorAll(FOCUSABLE)]
        .filter((el) => (el.offsetParent !== null || el === document.activeElement) && !el.closest('[inert]'));
      if (items.length === 0) { e.preventDefault(); panel.current.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = panel.current.contains(active);
      // The panel itself holds focus right after opening: it is the start of the cycle, so the
      // first Shift+Tab wraps to the last item instead of leaving for the page behind.
      if (e.shiftKey && (active === first || active === panel.current || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = sheetStack.indexOf(token);
      if (i >= 0) sheetStack.splice(i, 1);
      releaseGuard(guard);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag-to-dismiss on phones, like native sheets: pull down by the grabber/header, or by the
  // content once it is scrolled to the top. Touch events (not pointer capture) so the content's
  // own scrolling keeps working and nothing is left half-dragged.
  useEffect(() => {
    if (!mounted || !dismissible) return undefined;
    const sheet = panel.current;
    const zones = [grabZone.current, body.current].filter(Boolean);
    let g = null; // active gesture
    const setY = (y) => { sheet.style.transform = y ? `translateY(${y}px)` : ''; };
    const end = () => {
      if (!g) return;
      const { active, dy, t0 } = g;
      g = null;
      if (!active) return;
      sheet.classList.remove('is-dragging');
      const velocity = dy / Math.max(1, performance.now() - t0);
      if (dy > DRAG_CLOSE_PX || (dy > DRAG_FLICK_MIN_PX && velocity > DRAG_CLOSE_VELOCITY)) {
        // Leave it where the finger let go: the exit animation continues from there. If the
        // owner refuses to close (e.g. busy, or "Jatka kirjoittamista"), snap back.
        requestClose();
        setTimeout(() => { if (sheet.isConnected && !sheet.closest('.is-closing')) setY(0); }, 320);
      } else {
        setY(0);
      }
    };
    const onStart = (e) => {
      if (window.innerWidth >= 900 || e.touches.length !== 1) { g = null; return; }
      const fromHandle = grabZone.current?.contains(e.target);
      g = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, t0: performance.now(), dy: 0, active: false, fromHandle, atTop: (body.current?.scrollTop || 0) <= 0 };
    };
    const onMove = (e) => {
      if (!g) return;
      const y = e.touches[0].clientY;
      const delta = y - g.y0;
      if (!g.active) {
        const canPull = g.fromHandle || (g.atTop && (body.current?.scrollTop || 0) <= 0);
        if (!canPull || delta < -4) { g = null; return; } // a normal scroll
        // a sideways swipe (the session slides, a strip of chips) is never a pull
        if (Math.abs(e.touches[0].clientX - g.x0) > Math.abs(delta)) { g = null; return; }
        if (delta < 6) return;                             // not decided yet
        g.active = true;
        g.y0 = y;
        g.t0 = performance.now();
        sheet.classList.add('is-dragging');
      }
      if (e.cancelable) e.preventDefault();
      g.dy = Math.max(0, y - g.y0);
      setY(g.dy);
    };
    for (const z of zones) {
      z.addEventListener('touchstart', onStart, { passive: true });
      z.addEventListener('touchmove', onMove, { passive: false });
      z.addEventListener('touchend', end);
      z.addEventListener('touchcancel', end);
    }
    return () => {
      for (const z of zones) {
        z.removeEventListener('touchstart', onStart);
        z.removeEventListener('touchmove', onMove);
        z.removeEventListener('touchend', end);
        z.removeEventListener('touchcancel', end);
      }
      sheet.classList.remove('is-dragging');
    };
  }, [mounted, dismissible, requestClose]);

  if (!mounted) return null;
  const headerId = labelledBy || (title ? 'sheet-title' : undefined);
  return createPortal(
    <div ref={root} className={cx('sheet-root', closing && 'is-closing', opening && 'is-opening')} role="presentation">
      <div className="sheet-backdrop" onClick={dismissible ? () => { if (performance.now() - openedAt.current > OPEN_GUARD_MS) requestClose(); } : undefined} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headerId}
        tabIndex={-1}
        className={cx('sheet', `sheet-${size}`, `sheet-tone-${tone}`, tone === 'dark' && 'on-dark', className)}
      >
        <div ref={grabZone} className="sheet-grab-zone">
          <span className="sheet-grabber" aria-hidden="true" />
          {(title || subtitle) && (
            <div className="sheet-header">
              <div className="sheet-heading">
                {title && <h2 id={headerId} className="sheet-title">{title}</h2>}
                {subtitle && <p className="sheet-subtitle">{subtitle}</p>}
              </div>
              {dismissible && <IconButton icon="close" label="Sulje" variant={tone === 'dark' ? 'on-dark' : 'soft'} size="sm" onClick={requestClose} />}
            </div>
          )}
        </div>
        {!title && !subtitle && dismissible && (
          <IconButton icon="close" label="Sulje" variant={tone === 'dark' ? 'on-dark' : 'soft'} size="sm" className="sheet-close-floating" onClick={requestClose} />
        )}
        <div ref={body} className={cx('sheet-body', bodyClassName)}>{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ── confirm dialog ─────────────────────────────────────────────────────────
// A queue, not a single slot: two confirm() calls can land before either is answered (two
// quick delete taps), and a single-slot dialog would orphan the first promise forever.
// Every confirm() resolves, one dialog at a time.

const ConfirmContext = createContext(null);

/** Wrap the app once. */
export function ConfirmProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const current = queue[0] || null;
  const confirm = useCallback((opts) => new Promise((resolve) => {
    setQueue((q) => [...q, { ...opts, resolve }]);
  }), []);
  useEffect(() => { if (current) { setOpen(true); setTyped(''); } }, [current]);
  const finish = (value) => {
    if (!current || !open) return;
    current.resolve(value);
    setOpen(false);
  };
  const needsTyping = Boolean(current?.typeToConfirm);
  const canConfirm = !needsTyping || typed.trim().toLowerCase() === String(current.typeToConfirm).trim().toLowerCase();
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {current && (
        <Sheet
          open={open}
          onClose={() => finish(false)}
          onClosed={() => setQueue((q) => q.slice(1))}
          size="sm"
          title={current.title}
          subtitle={current.message || current.body}
          footer={current.secondaryLabel ? (
            <div className="sheet-actions sheet-actions-stack">
              <Button variant={current.danger ? 'danger' : 'dark'} size="lg" block disabled={!canConfirm} onClick={() => canConfirm && finish(true)}>{current.confirmLabel || 'Vahvista'}</Button>
              <Button variant="outline" size="lg" block onClick={() => finish(current.secondaryValue ?? 'secondary')}>{current.secondaryLabel}</Button>
              <Button variant="ghost" size="md" block onClick={() => finish(false)}>{current.cancelLabel || 'Peruuta'}</Button>
            </div>
          ) : (
            <div className="sheet-actions">
              <Button variant="soft" size="lg" onClick={() => finish(false)}>{current.cancelLabel || 'Peruuta'}</Button>
              <Button variant={current.danger ? 'danger' : 'dark'} size="lg" disabled={!canConfirm} onClick={() => canConfirm && finish(true)}>{current.confirmLabel || 'Vahvista'}</Button>
            </div>
          )}
        >
          {needsTyping && (
            <div className="confirm-type">
              <label className="field-label" htmlFor="confirm-type-input">Kirjoita vahvistukseksi <b>{current.typeToConfirm}</b></label>
              <input id="confirm-type-input" className="input input-md" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
          )}
        </Sheet>
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * const confirm = useConfirm();
 * if (await confirm({ title, message, confirmLabel, cancelLabel, danger, typeToConfirm })) …
 * Three-way choice: pass secondaryLabel (+ secondaryValue); resolves true | secondaryValue | false.
 */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}
