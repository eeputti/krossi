// AppShell.jsx — navigation chrome (tab bar on phones / side nav on desktop), route rendering,
// overlay routes and transitions. Shared by the coach and the player app; each passes its own
// tabs, screens and side-nav extras.

import { useLayoutEffect } from 'react';
import { isDemo } from '../api/index.js';
import { Avatar, Icon, ICON_NAMES } from '../ui/index.js';
import { useIsDesktop } from './hooks.js';
import { Link, canonBase, matchRoute, navigationType, savedScroll, useRoute, homePath } from './router.js';

const cx = (...c) => c.filter(Boolean).join(' ');

// The active tab shows the filled twin of its icon (outline = not active), when there is one.
const tabIcon = (name, isActive) => (isActive && ICON_NAMES.includes(`${name}-fill`) ? `${name}-fill` : name);

// `center` ({ label, icon, onClick }) puts one big round action in the middle of the bar, between
// the two halves of the tabs (the coach's "Merkitse").
// A tab with `onClick` is a button (the coach's "Lisää" drawer); `ids` lists the pages it stands for.
function TabBar({ tabs, active, badges, center }) {
  const item = (t) => {
    const on = active === t.id || (t.ids || []).includes(active);
    const inner = (
      <>
        <span className="tabbar-icon">
          <Icon name={tabIcon(t.icon, on)} size={23} strokeWidth={1.9} />
          {badges?.[t.id] > 0 && <span className="tabbar-badge">{badges[t.id] > 9 ? '9+' : badges[t.id]}</span>}
        </span>
        <span className="tabbar-label">{t.label}</span>
      </>
    );
    return t.onClick ? (
      <button key={t.id} type="button" className={cx('tabbar-item', on && 'is-active')} onClick={t.onClick} aria-haspopup="dialog">{inner}</button>
    ) : (
      <Link key={t.id} to={t.path} className={cx('tabbar-item', on && 'is-active')} aria-current={on ? 'page' : undefined}>{inner}</Link>
    );
  };
  const half = Math.ceil(tabs.length / 2);
  return (
    <nav className={cx('tabbar', center && 'has-center')} aria-label="Päävalikko" style={{ gridTemplateColumns: `repeat(${tabs.length + (center ? 1 : 0)}, 1fr)` }}>
      {center ? (
        <>
          {tabs.slice(0, half).map(item)}
          <button type="button" className="tabbar-center" onClick={center.onClick}>
            <span className="tabbar-center-btn"><Icon name={center.icon || 'plus'} size={28} strokeWidth={2.5} /></span>
            <span className="tabbar-label">{center.label}</span>
          </button>
          {tabs.slice(half).map(item)}
        </>
      ) : tabs.map(item)}
    </nav>
  );
}

function SideNav({ tabs, active, page, badges, cta, extraLinks, me, roleLabel }) {
  // A page that has its own side-nav link (Harjoitepankki, Ylläpito) lights that link, not the tab.
  const extraOn = (extraLinks || []).find((l) => (l.pages || []).includes(page));
  const tabOn = extraOn ? null : active;
  return (
    <aside className="sidenav on-dark court-lines">
      <Link to={homePath()} className="sidenav-logo k-logo" aria-label="Krossi Koutsi — etusivu">
        <span>Krossi</span><span className="k-logo-sub">Koutsi</span>
      </Link>
      {roleLabel && <span className="k-role-pill">{roleLabel}</span>}
      {cta}
      <nav className="sidenav-links" aria-label="Päävalikko">
        {/* a phone-only tab (a drawer button without an address) never belongs here, even for the
            one render where a resize has reached one useIsDesktop() but not the other */}
        {tabs.filter((t) => t.path).map((t) => (
          <Link key={t.id} to={t.path} className={cx('sidenav-link', tabOn === t.id && 'is-active')} aria-current={tabOn === t.id ? 'page' : undefined}>
            <Icon name={tabIcon(t.icon, tabOn === t.id)} size={20} />
            <span>{t.label}</span>
            {badges?.[t.id] > 0 && <span className="sidenav-badge">{badges[t.id] > 9 ? '9+' : badges[t.id]}</span>}
          </Link>
        ))}
        {(extraLinks || []).map((l) => (l.onClick ? (
          <button key={l.key || l.label} type="button" className="sidenav-link sidenav-link-sub" onClick={l.onClick} aria-haspopup="dialog">
            <Icon name={l.icon} size={20} /><span>{l.label}</span>
          </button>
        ) : (
          <Link key={l.to} to={l.to} className={cx('sidenav-link', 'sidenav-link-sub', extraOn === l && 'is-active-sub')} aria-current={extraOn === l ? 'page' : undefined}>
            <Icon name={l.icon} size={20} /><span>{l.label}</span>
          </Link>
        )))}
      </nav>
      {me && (
        <Link to={me.to} className="sidenav-me">
          <Avatar person={me.person} size={38} ring />
          <span className="sidenav-me-text">
            <span className="sidenav-me-name truncate">{me.person?.name}</span>
            <span className="sidenav-me-sub truncate">{me.sub}</span>
          </span>
          <Icon name="chevron-right" size={18} />
        </Link>
      )}
    </aside>
  );
}

function DemoBanner({ signupUrl }) {
  return (
    <div className="top-banner" role="note">
      <Icon name="info" size={15} />
      <span>Demo — mikään ei tallennu</span>
      <a href={signupUrl} className="top-banner-cta">Ota käyttöön <Icon name="arrow-right" size={14} /></a>
    </div>
  );
}

// While the renewed Koutsi is an opt-in beta, every screen says which Koutsi this is and the
// way back is one tap: ?uusi=0 is handled by the worker, so this is a full page load.
function BetaBanner() {
  return (
    <div className="top-banner top-banner-beta" role="note">
      <span className="top-banner-tag">Beta</span>
      <span>Koutsilla uusi ilme!</span>
      <a href={`${canonBase()}?uusi=0`} className="top-banner-cta">Palaa vanhaan <Icon name="arrow-right" size={14} /></a>
    </div>
  );
}

function renderScreen(screens, NotFound, match, query) {
  const Screen = (match && screens[match.name]) || NotFound;
  return <Screen params={match?.params || {}} query={query || {}} route={match?.route} />;
}

/**
 * AppShell
 *   tabs: [{ id, label, icon, path }]   screens: { routeName: Component }   NotFound: Component
 *   badges: { tabId: count }   cta: node (side nav)   extraLinks: [{ to, label, icon, pages: [route names] } | { key, label, icon, onClick }]
 *   center: { label, icon, onClick } — the phone tab bar's big middle button
 *   me: { person, sub, to }   roleLabel   banner: node shown above the page (acting mode etc.)
 *   signupUrl: where the demo banner points   beta: show the "Koutsilla uusi ilme!" bar instead
 */
export function AppShell({ tabs, screens, NotFound, badges, cta, center, extraLinks, me, roleLabel, banner, signupUrl, beta = false }) {
  const route = useRoute();
  const isDesktop = useIsDesktop();
  const type = route.route?.type;

  // Overlay routes (Sheets) render on top of the page they were opened from.
  const overlay = type === 'overlay';
  const tabRoot = (tabId) => tabs.find((t) => t.id === tabId)?.path || homePath();
  const bgPath = overlay ? (route.state.bg || tabRoot(route.route.tab)) : null;
  const [bgPathname, bgSearch] = (bgPath || '').split('?');
  const bgMatch = overlay ? matchRoute(bgPathname) : null;
  const pageMatch = overlay ? bgMatch : (route.route ? { name: route.name, params: route.params, route: route.route } : null);
  const pageQuery = overlay ? Object.fromEntries(new URLSearchParams(bgSearch || '')) : route.query;
  const pageKey = overlay ? bgPath : route.path;
  const pageType = pageMatch?.route?.type;
  const activeTab = route.state.tab || (overlay ? bgMatch?.route?.tab : route.route?.tab) || null;
  const hideChrome = !isDesktop && pageType === 'full';

  useLayoutEffect(() => {
    if (overlay) return;
    const kind = navigationType();
    const y = kind === 'pop' ? savedScroll(route.key) : 0;
    window.scrollTo(0, y || 0);
  }, [route.key, overlay]);

  const transition = navigationType() === 'push' && pageType !== 'tab' ? 'route-enter' : 'route-fade';
  return (
    <div className={cx('shell', (beta || isDemo) && 'has-top-banner', hideChrome && 'no-chrome')}>
      {beta ? <BetaBanner /> : isDemo && <DemoBanner signupUrl={signupUrl} />}
      {isDesktop && <SideNav tabs={tabs} active={activeTab} page={pageMatch?.name} badges={badges} cta={cta} extraLinks={extraLinks} me={me} roleLabel={roleLabel} />}
      <div className="shell-main">
        {banner}
        <div key={pageKey} className={cx('shell-page', pageMatch?.name && `shell-page-${pageMatch.name}`, transition)}>
          {renderScreen(screens, NotFound, pageMatch, pageQuery)}
        </div>
      </div>
      {overlay && renderScreen(screens, NotFound, { name: route.name, params: route.params, route: route.route }, route.query)}
      {!isDesktop && !hideChrome && <TabBar tabs={tabs} active={activeTab} badges={badges} center={center} />}
    </div>
  );
}
