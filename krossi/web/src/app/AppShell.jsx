// AppShell.jsx — navigation chrome (tab bar / side nav), route rendering, transitions.
import { useEffect, useLayoutEffect, useState } from 'react';
import { api, isDemo } from '../api/index.js';
import { Avatar, Button, Icon } from '../ui/index.js';
import { useIsDesktop } from './hooks.js';
import { Link, navigate, navigationType, savedScroll, useRoute } from './router.js';
import { matchRoute, TABS, tabRoot } from './routes.js';
import { SCREENS, NotFoundScreen } from './screens.js';
import { useSession } from './session.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

/** Number of unread conversations + pending play requests, kept fresh via realtime. */
function useUnread(routeName) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const refresh = () => api.messages.unreadCount().then((n) => alive && setCount(n)).catch(() => {});
    refresh();
    const unsubscribe = api.messages.subscribeInbox(refresh);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { alive = false; unsubscribe?.(); window.removeEventListener('focus', onFocus); };
  }, []);
  useEffect(() => {
    if (routeName === 'inbox' || routeName === 'chat') return undefined;
    const t = setTimeout(() => api.messages.unreadCount().then(setCount).catch(() => {}), 400);
    return () => clearTimeout(t);
  }, [routeName]);
  return count;
}

export function openCreateGame(query = '') {
  navigate(`/pelaa/uusi-peli${query}`, { overlay: true });
}

function TabBar({ active, unread }) {
  return (
    <nav className="tabbar" aria-label="Päävalikko">
      {TABS.map((t) => (
        <Link key={t.id} to={t.path} className={cx('tabbar-item', active === t.id && 'is-active')} aria-current={active === t.id ? 'page' : undefined}>
          <span className="tabbar-icon">
            <Icon name={t.icon} size={23} strokeWidth={active === t.id ? 2.3 : 1.9} />
            {t.id === 'viestit' && unread > 0 && <span className="tabbar-badge">{unread > 9 ? '9+' : unread}</span>}
          </span>
          <span className="tabbar-label">{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function SideNav({ active, unread }) {
  const { profile, isAdmin } = useSession();
  return (
    <aside className="sidenav on-dark court-lines">
      <Link to="/pelaa/koti" className="sidenav-logo" aria-label="Krossi — koti">Krossi</Link>
      <Button variant="lime" size="lg" block icon="plus" className="sidenav-cta" onClick={() => openCreateGame()}>Pelataanko?</Button>
      <nav className="sidenav-links" aria-label="Päävalikko">
        {TABS.map((t) => (
          <Link key={t.id} to={t.path} className={cx('sidenav-link', active === t.id && 'is-active')} aria-current={active === t.id ? 'page' : undefined}>
            <Icon name={t.icon} size={20} />
            <span>{t.label}</span>
            {t.id === 'viestit' && unread > 0 && <span className="sidenav-badge">{unread > 9 ? '9+' : unread}</span>}
          </Link>
        ))}
        <Link to="/pelaa/liigat" className={cx('sidenav-link', 'sidenav-link-sub')}><Icon name="trophy" size={20} /><span>Liigat</span></Link>
        {isAdmin && <Link to="/pelaa/yllapito" className="sidenav-link sidenav-link-sub"><Icon name="shield" size={20} /><span>Ylläpito</span></Link>}
      </nav>
      {profile && (
        <Link to="/pelaa/profiili" className="sidenav-me">
          <Avatar person={profile} size={38} ring />
          <span className="sidenav-me-text">
            <span className="sidenav-me-name truncate">{profile.name}</span>
            <span className="sidenav-me-sub truncate">{profile.city || 'Krossi'}</span>
          </span>
          <Icon name="chevron-right" size={18} />
        </Link>
      )}
    </aside>
  );
}

function DemoBanner() {
  return (
    <div className="demo-banner" role="note">
      <Icon name="sparkles" size={15} />
      <span>Demotila — mikään ei tallennu</span>
      <a href="/pelaa" className="demo-banner-cta">Luo oma tili <Icon name="arrow-right" size={14} /></a>
    </div>
  );
}

function renderScreen(match, extra) {
  const Screen = (match && SCREENS[match.name]) || NotFoundScreen;
  return <Screen params={match?.params || {}} query={extra.query || {}} route={match?.route} />;
}

export function AppShell() {
  const route = useRoute();
  const isDesktop = useIsDesktop();
  const { isAdmin } = useSession();
  const unread = useUnread(route.name);
  const type = route.route?.type;

  // Overlay routes (Sheets) render on top of the page they were opened from.
  const overlay = type === 'overlay';
  const bgPath = overlay ? (route.state.bg || tabRoot(route.route.tab)) : null;
  const [bgPathname, bgSearch] = (bgPath || '').split('?');
  const bgMatch = overlay ? matchRoute(bgPathname) : null;
  const pageMatch = overlay ? bgMatch : (route.route ? { name: route.name, params: route.params, route: route.route } : null);
  const pageQuery = overlay ? Object.fromEntries(new URLSearchParams(bgSearch || '')) : route.query;
  const pageKey = overlay ? bgPath : route.path;
  const pageType = pageMatch?.route?.type;
  const activeTab = (overlay ? bgMatch?.route?.tab : route.route?.tab) || null;
  const hideChrome = !isDesktop && (pageType === 'full');

  useLayoutEffect(() => {
    if (overlay) return;
    const kind = navigationType();
    const y = kind === 'pop' ? savedScroll(route.key) : 0;
    window.scrollTo(0, y || 0);
  }, [route.key, overlay]);

  useEffect(() => {
    if (route.name === 'admin' && isAdmin === false) navigate('/pelaa/koti', { replace: true });
  }, [route.name, isAdmin]);

  const transition = navigationType() === 'push' && pageType !== 'tab' ? 'route-enter' : 'route-fade';
  return (
    <div className={cx('shell', isDemo && 'has-demo-banner', hideChrome && 'no-chrome')}>
      {isDemo && <DemoBanner />}
      {isDesktop && <SideNav active={activeTab} unread={unread} />}
      <div className="shell-main">
        <div key={pageKey} className={cx('shell-page', transition)}>
          {renderScreen(pageMatch, { query: pageQuery })}
        </div>
      </div>
      {overlay && renderScreen({ name: route.name, params: route.params, route: route.route }, { query: route.query })}
      {!isDesktop && !hideChrome && <TabBar active={activeTab} unread={unread} />}
    </div>
  );
}
