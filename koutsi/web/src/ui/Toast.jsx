// Toast.jsx — transient notifications. const toast = useToast(); toast('Tallennettu!')
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';

const ToastContext = createContext(null);
const ICONS = { success: 'check-circle', error: 'alert', info: 'info' };

/** Wrap the app once. */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);
  const dismiss = useCallback((id) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 220);
  }, []);
  /**
   * toast(message, { tone: 'success' | 'error' | 'info', icon, duration, action: { label, onClick } })
   * Errors may be passed directly: toast(err) shows err.userMessage with tone 'error'.
   */
  const toast = useCallback((message, opts = {}) => {
    const isError = message && typeof message === 'object';
    const text = isError ? (message.userMessage || 'Jokin meni pieleen. Yritä uudelleen.') : message;
    const tone = opts.tone || (isError ? 'error' : 'success');
    const id = ++seq.current;
    setToasts((list) => [...list.slice(-2), { id, text, tone, icon: opts.icon || ICONS[tone], action: opts.action }]);
    setTimeout(() => dismiss(id), opts.duration || (tone === 'error' ? 4600 : 2800));
    return id;
  }, [dismiss]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
        <div className="toast-host" aria-live="polite" aria-atomic="false">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.tone}${t.leaving ? ' is-leaving' : ''}`} role={t.tone === 'error' ? 'alert' : 'status'}>
              <Icon name={t.icon} size={18} className="toast-icon" />
              <span className="toast-text">{t.text}</span>
              {t.action && (
                <button type="button" className="toast-action" onClick={() => { t.action.onClick(); dismiss(t.id); }}>{t.action.label}</button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
