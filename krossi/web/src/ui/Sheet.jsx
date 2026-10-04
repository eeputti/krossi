// Sheet.jsx — bottom sheet on phones, centered dialog on desktop. Plus useConfirm().
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton, Button } from './primitives.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const EXIT_MS = 240;

let openCount = 0;
function lockScroll() {
  if (openCount++ === 0) {
    const y = window.scrollY;
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
    window.scrollTo(0, y);
  }
}

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
  const drag = useRef(null);
  const restoreFocus = useRef(null);

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
    if (!open || !dismissible) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissible, onClose]);

  // drag-to-dismiss (only from the grabber/header so inner scrolling keeps working)
  const onPointerDown = (e) => {
    if (!dismissible || window.innerWidth >= 900) return;
    drag.current = { y0: e.clientY, t0: performance.now(), dy: 0 };
    panel.current?.setPointerCapture?.(e.pointerId);
    panel.current?.classList.add('is-dragging');
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dy = Math.max(0, e.clientY - drag.current.y0);
    drag.current.dy = dy;
    panel.current.style.transform = `translateY(${dy}px)`;
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    const { dy, t0 } = drag.current;
    const velocity = dy / Math.max(1, performance.now() - t0);
    drag.current = null;
    panel.current?.classList.remove('is-dragging');
    panel.current.style.transform = '';
    if (dy > 110 || velocity > 0.7) onClose?.();
  };

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
        <div className="sheet-grab-zone" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <span className="sheet-grabber" aria-hidden="true" />
          {(title || subtitle) && (
            <div className="sheet-header">
              <div className="sheet-heading">
                {title && <h2 id={headerId} className="sheet-title">{title}</h2>}
                {subtitle && <p className="sheet-subtitle">{subtitle}</p>}
              </div>
              {dismissible && <IconButton icon="close" label="Sulje" variant={tone === 'dark' ? 'on-dark' : 'soft'} size="sm" onClick={onClose} onPointerDown={(e) => e.stopPropagation()} />}
            </div>
          )}
        </div>
        {!title && !subtitle && dismissible && (
          <IconButton icon="close" label="Sulje" variant={tone === 'dark' ? 'on-dark' : 'soft'} size="sm" className="sheet-close-floating" onClick={onClose} />
        )}
        <div className={cx('sheet-body', bodyClassName)}>{children}</div>
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
