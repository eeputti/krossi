// Sheet.jsx — bottom sheet on phones, centered dialog on desktop. Plus useConfirm().
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton, Button } from './primitives.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const EXIT_MS = 240;

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

const DRAG_CLOSE_PX = 110;
const DRAG_CLOSE_VELOCITY = 0.7; // px/ms
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Sheet
 *   open, onClose
 *   title, subtitle         header (omit both for a header-less sheet, e.g. custom hero)
 *   footer                  sticky action area at the bottom (buttons)
 *   size: 'sm' | 'md' | 'lg' | 'full'   (desktop width; 'full' = full height on phones)
 *   dismissible             default true: backdrop tap, Esc and drag-down close it
 *   tone: 'default' | 'dark'
 *   onClosed                called after the exit animation finished
 */
export function Sheet({ open, onClose, title, subtitle, footer, size = 'md', dismissible = true, tone = 'default', className, bodyClassName, onClosed, children, labelledBy }) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
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

  useEffect(() => {
    if (open) { setMounted(true); setClosing(false); return undefined; }
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
    const t = setTimeout(() => panel.current?.focus({ preventScroll: true }), 30);
    return () => { clearTimeout(t); unlockScroll(); restoreFocus.current?.focus?.({ preventScroll: true }); };
  }, [mounted]);

  useEffect(() => {
    if (!open) return undefined;
    const token = {};
    sheetStack.push(token);
    const onKey = (e) => {
      if (sheetStack[sheetStack.length - 1] !== token) return;
      if (e.key === 'Escape' && dismissibleRef.current) { e.preventDefault(); onCloseRef.current?.(); return; }
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
    };
  }, [open]);

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
      if (dy > DRAG_CLOSE_PX || velocity > DRAG_CLOSE_VELOCITY) {
        // Leave it where the finger let go: the exit animation continues from there. If the
        // owner refuses to close (e.g. busy), snap back instead of staying half-open.
        onCloseRef.current?.();
        setTimeout(() => { if (sheet.isConnected && !sheet.closest('.is-closing')) setY(0); }, 320);
      } else {
        setY(0);
      }
    };
    const onStart = (e) => {
      if (window.innerWidth >= 900 || e.touches.length !== 1) { g = null; return; }
      const fromHandle = grabZone.current?.contains(e.target);
      g = { y0: e.touches[0].clientY, t0: performance.now(), dy: 0, active: false, fromHandle, atTop: (body.current?.scrollTop || 0) <= 0 };
    };
    const onMove = (e) => {
      if (!g) return;
      const y = e.touches[0].clientY;
      const delta = y - g.y0;
      if (!g.active) {
        const canPull = g.fromHandle || (g.atTop && (body.current?.scrollTop || 0) <= 0);
        if (!canPull || delta < -4) { g = null; return; } // a normal scroll
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
  }, [mounted, dismissible]);

  if (!mounted) return null;
  const headerId = labelledBy || (title ? 'sheet-title' : undefined);
  return createPortal(
    <div className={cx('sheet-root', closing && 'is-closing')} role="presentation">
      <div className="sheet-backdrop" onClick={dismissible ? onClose : undefined} aria-hidden="true" />
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
              {dismissible && <IconButton icon="close" label="Sulje" variant={tone === 'dark' ? 'on-dark' : 'soft'} size="sm" onClick={onClose} />}
            </div>
          )}
        </div>
        {!title && !subtitle && dismissible && (
          <IconButton icon="close" label="Sulje" variant={tone === 'dark' ? 'on-dark' : 'soft'} size="sm" className="sheet-close-floating" onClick={onClose} />
        )}
        <div ref={body} className={cx('sheet-body', bodyClassName)}>{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ── confirm dialog ─────────────────────────────────────────────────────────

const ConfirmContext = createContext(null);

/** Wrap the app once. */
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolver = useRef(null);
  const confirm = useCallback((opts) => new Promise((resolve) => {
    resolver.current = resolve;
    setState({ ...opts, open: true });
  }), []);
  const finish = (value) => {
    resolver.current?.(value);
    resolver.current = null;
    setState((s) => (s ? { ...s, open: false } : s));
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <Sheet
          open={state.open}
          onClose={() => finish(false)}
          onClosed={() => setState(null)}
          size="sm"
          title={state.title}
          subtitle={state.message}
          footer={(
            <div className="sheet-actions">
              <Button variant="soft" size="lg" onClick={() => finish(false)}>{state.cancelLabel || 'Peruuta'}</Button>
              <Button variant={state.danger ? 'danger' : 'dark'} size="lg" onClick={() => finish(true)}>{state.confirmLabel || 'Vahvista'}</Button>
            </div>
          )}
        />
      )}
    </ConfirmContext.Provider>
  );
}

/** const confirm = useConfirm(); if (await confirm({ title, message, confirmLabel, cancelLabel, danger })) … */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}
