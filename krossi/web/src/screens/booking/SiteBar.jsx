// SiteBar — the top of the booking site (krossi.app/varaa) in place of the app's TopBar: the Krossi
// wordmark (to the krossi.app front page) and the page's own icon buttons. No back arrow, no menus.
import { TennisBall } from '../../ui/index.js';

export function SiteBar({ actions }) {
  return (
    <header className="site-bar">
      <div className="site-bar-inner">
        <a href="/" className="site-logo" aria-label="Krossi — etusivu">
          <TennisBall size={22} />
          <span>Krossi</span>
        </a>
        <div className="site-bar-actions">{actions}</div>
      </div>
    </header>
  );
}
