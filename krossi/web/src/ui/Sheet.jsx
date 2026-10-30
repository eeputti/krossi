// Sheet.jsx — bottom sheet on phones, centered dialog on desktop. Plus useConfirm().
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton, Button } from './primitives.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const EXIT_MS = 240;

// ── the page under an open sheet ───────────────────────────────────────────
// It just stops scrolling (overflow: hidden on html) and stays where it is. The old lock
// pinned the body with position: fixed; with the keyboard up an iPhone then lost track of where
// things were, and the taps after the keyboard landed beside what they were meant for.
let openCount = 0;
let lockedAt = null; // page the scroll position belongs to
let lockedY = 0;
const isTypingField = (el) => Boolean(el) && (el.tagName === 'TEXTAREA' || el.isContentEditable
  || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|file|color|image|hidden)$/.test(el.type)));
const keyboardUp = () => {
  const vv = window.visualViewport;
  return Boolean(vv) && window.innerHeight - vv.height > 120;
};
// When the keyboard goes down an iPhone doesn't always move the page all the way back, and then a
// tap hits a spot beside what is drawn under the finger. Put the page back where it was locked.
let settleTimer = 0;
function settleAfterKeyboard() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    // (not after a route change: the new page has its own place)
    if (!openCount || window.location.href !== lockedAt || keyboardUp() || isTypingField(document.activeElement)) return;
    const vv = window.visualViewport;
    if (Math.abs(window.scrollY - lockedY) > 1 || (vv && Math.abs(vv.offsetTop) > 1)) window.scrollTo(0, lockedY);
  }, 150);
}
function lockScroll() {
  if (openCount++ === 0) {
    lockedY = window.scrollY;
    lockedAt = window.location.href;
    document.body.dataset.scrollY = String(lockedY); // router.js keeps the page's place with it
    document.documentElement.classList.add('sheet-lock');
    document.body.classList.add('sheet-open', 'sheet-lock');
    window.visualViewport?.addEventListener('resize', settleAfterKeyboard);
    document.addEventListener('focusout', settleAfterKeyboard);
  }
}
function unlockScroll() {
  if (--openCount === 0) {
    clearTimeout(settleTimer);
    window.visualViewport?.removeEventListener('resize', settleAfterKeyboard);
    document.removeEventListener('focusout', settleAfterKeyboard);
    if (document.body.scrollTop) document.body.scrollTop = 0; // never leave the body itself scrolled
    document.documentElement.classList.remove('sheet-lock');
    document.body.classList.remove('sheet-open', 'sheet-lock');
    delete document.body.dataset.scrollY;
    // The keyboard may have moved the page; a route change gives the new page its own position.
    if (window.location.href === lockedAt && Math.abs(window.scrollY - lockedY) > 1) window.scrollTo(0, lockedY);
    lockedAt = null;
  }
}

// ── a sheet on top of a sheet ──────────────────────────────────────────────
// The one underneath is hidden while a bigger one is open on top of it (a small question on top
// keeps it showing): the phone draws one sheet instead of two, and nothing of the lower one can
// catch a tap. It hides once the upper one has slid up and shows again as soon as that starts closing
// (CSS, phones only: on a computer the dialogs stay as they were).
const openRoots = []; // { el, small }, oldest first
function syncCovered() {
  openRoots.forEach((r, i) => r.el.classList.toggle('is-covered', openRoots.slice(i + 1).some((u) => !u.small)));
}

/**
 * Typing in a sheet on a phone: while the keyboard is up the sheet sits right above it — the root
 * covers just the part of the screen the keyboard leaves (the iPhone may pan the page to show the
 * field, so the root follows what is actually visible) and the field is scrolled into view inside
 * the sheet. When the keyboard goes down the root is put back at once, and the page under it is
 * returned to its place (settleAfterKeyboard), so the next tap lands where it is aimed.
 */
function useKeyboardRoom(rootRef, bodyRef, active) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return undefined;
    let raf = 0;
    const reset = () => {
      const root = rootRef.current;
      if (root && root.classList.contains('has-keyboard')) {
        root.style.top = '';
        root.style.bottom = '';
        root.classList.remove('has-keyboard');
      }
    };
    const update = () => {
      const root = rootRef.current;
      const body = bodyRef.current;
      if (!root || !body) return;
      const field = document.activeElement;
      if (!keyboardUp() || !body.contains(field) || !isTypingField(field)) { cancelAnimationFrame(raf); reset(); return; }
      root.style.top = `${Math.round(vv.offsetTop)}px`;
      root.style.bottom = `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`;
      root.classList.add('has-keyboard');
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const f = field.getBoundingClientRect();
        const box = body.getBoundingClientRect();
        const room = box.bottom - 12;
        const top = box.top + 8;
        if (f.bottom > room) body.scrollTop += Math.min(f.bottom - room, Math.max(0, f.top - top));
        else if (f.top < top) body.scrollTop -= top - f.top;
      });
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    // focus leaving a field: look again a moment later, when the next field (if any) has it
    let later = 0;
    const onFocusOut = () => { clearTimeout(later); later = setTimeout(update, 60); };
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(later);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', onFocusOut);
      reset();
    };
  }, [rootRef, bodyRef, active]);
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

  useKeyboardRoom(root, body, mounted && !closing);

  useEffect(() => {
    if (!open || !mounted || !root.current) return undefined;
    const entry = { el: root.current, small: size === 'sm' };
    openRoots.push(entry);
    syncCovered();
    return () => {
      const i = openRoots.indexOf(entry);
      if (i >= 0) openRoots.splice(i, 1);
      entry.el.classList.remove('is-covered');
      syncCovered();
    };
  }, [open, mounted]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Drag-to-dismiss on phones, like native sheets: pull down by the grabber and the header only. The
  // content has no touch listeners at all, so it scrolls at the phone's own speed and a tap in it is
  // never taken for the start of a pull.
  useEffect(() => {
    if (!mounted || !dismissible) return undefined;
    const sheet = panel.current;
    const zones = [grabZone.current].filter(Boolean);
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
      g = { y0: e.touches[0].clientY, t0: performance.now(), dy: 0, active: false };
    };
    const onMove = (e) => {
      if (!g) return;
      const y = e.touches[0].clientY;
      const delta = y - g.y0;
      if (!g.active) {
        if (delta < -4) { g = null; return; } // a push up is not a pull
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
    <div ref={root} className={cx('sheet-root', closing && 'is-closing')} role="presentation">
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
