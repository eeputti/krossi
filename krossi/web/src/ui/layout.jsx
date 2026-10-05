// layout.jsx — page scaffolding: TopBar, Page, PageHeader, Disclosure.
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { goBack } from '../app/router.js';

const cx = (...c) => c.filter(Boolean).join(' ');

/**
 * TopBar — sticky translucent bar for pushed pages.
 *   title, back: true | fallback path string (default '/pelaa/koti'), onBack: custom handler,
 *   actions: node(s) on the right, tone: 'default' | 'dark' | 'transparent' (over a hero, turns solid on scroll)
 */
export function TopBar({ title, back = true, onBack, actions, tone = 'default', className }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const handleBack = () => (onBack ? onBack() : goBack(typeof back === 'string' ? back : '/pelaa/koti'));
  return (
    <header className={cx('topbar', `topbar-${tone}`, scrolled && 'is-scrolled', className)}>
      <div className="topbar-inner">
        {back ? (
          <button type="button" className="topbar-back" onClick={handleBack} aria-label="Takaisin">
            <Icon name="chevron-left" size={24} strokeWidth={2.4} />
          </button>
        ) : <span className="topbar-spacer" />}
        <div className="topbar-title truncate">{title}</div>
        <div className="topbar-actions">{actions}</div>
      </div>
    </header>
  );
}

/** Page — content column with the standard gutters and bottom padding above the tab bar. width: 'normal' | 'wide' | 'narrow' */
export function Page({ width = 'normal', className, children }) {
  return <main className={cx('page', `page-${width}`, className)}>{children}</main>;
}

/** PageHeader — large title for tab roots. `actions` render on the right; `eyebrow` above the title. */
export function PageHeader({ title, subtitle, eyebrow, actions, className }) {
  return (
    <div className={cx('page-header', className)}>
      <div className="page-header-text">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  );
}

/**
 * Disclosure — collapsible "Lisätiedot" section with a smooth height animation.
 *   title, summary (shown next to the title when collapsed, e.g. "Pinta, taso, hinta…"),
 *   defaultOpen, open/onToggle (controlled), icon
 */
export function Disclosure({ title, summary, icon = 'sliders', defaultOpen = false, open: openProp, onToggle, className, children }) {
  const [inner, setInner] = useState(defaultOpen);
  const open = openProp ?? inner;
  const body = useRef(null);
  const [height, setHeight] = useState(open ? 'auto' : 0);
  const id = useId();
  useEffect(() => {
    const el = body.current;
    if (!el) return undefined;
    if (open) {
      setHeight(el.scrollHeight);
      const t = setTimeout(() => setHeight('auto'), 320);
      return () => clearTimeout(t);
    }
    setHeight(el.scrollHeight);
    const raf = requestAnimationFrame(() => setHeight(0));
    return () => cancelAnimationFrame(raf);
  }, [open]);
  const toggle = () => { const next = !open; setInner(next); onToggle?.(next); };
  return (
    <div className={cx('disclosure', open && 'is-open', className)}>
      <button type="button" className="disclosure-head" aria-expanded={open} aria-controls={id} onClick={toggle}>
        <span className="disclosure-icon"><Icon name={icon} size={18} /></span>
        <span className="disclosure-title">{title}</span>
        {!open && summary && <span className="disclosure-summary truncate">{summary}</span>}
        <Icon name="chevron-down" size={18} className="disclosure-chevron" />
      </button>
      <div id={id} ref={body} className="disclosure-body" style={{ height }} aria-hidden={!open} inert={open ? undefined : ''}>
        <div className="disclosure-content">{children}</div>
      </div>
    </div>
  );
}
