// SiteShell.jsx — the booking site krossi.app/varaa: a customer comes to book a court and does only
// that, so none of the app's menus (no tab bar, no side nav, no demo banner or tour). The page draws
// its own bar (screens/booking/SiteBar.jsx). Once the court is booked, "Etsi pelikaveri" moves on into
// the app (Peliseura), where AppShell takes over in the same page load — the demo keeps its state.
import { useEffect, useLayoutEffect } from 'react';
import { useRoute } from './router.js';
import { NotFoundScreen, SCREENS } from './screens.js';

const SITE_TITLE = 'Varaa kenttä — Krossi';

export function SiteShell() {
  const route = useRoute();
  useEffect(() => {
    const before = document.title;
    document.title = SITE_TITLE;
    // Into the app: krossi-varaa.html's own title is the site's, so the app gets a plain one.
    return () => { document.title = before === SITE_TITLE ? 'Krossi' : before; };
  }, []);
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [route.key]);
  const Screen = SCREENS[route.name] || NotFoundScreen;
  return (
    <div className="site">
      <Screen params={route.params} query={route.query} route={route.route} />
    </div>
  );
}
