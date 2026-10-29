// pelaaja-demo.jsx — the player demo (demo.koutsi.krossi.app/pelaaja): same app, in-memory data.
import { installBackend } from './api/index.js';
import { backend, configureDemo } from './api/demo/index.js';
import { mountApp } from './app/mount.jsx';
import { APP_NAME } from './lib/constants.js';
import { PlayerRoot } from './player/PlayerRoot.jsx';
import { capturePendingCheckIn } from './player/checkin.js';
import { CANON, HOME, ROUTES } from './player/routes.js';
import { invoiceTokenFromPath, mountInvoicePage } from './shared/billing/PublicInvoice.jsx';

configureDemo({ role: 'player' });
installBackend(backend, { demo: true });
const invoiceToken = invoiceTokenFromPath(window.location.pathname);
if (invoiceToken) {
  mountInvoicePage(invoiceToken);
} else {
  capturePendingCheckIn(); // the after-session e-mail's ?fiilis= / ?toive=, before sign-in can redirect
  mountApp({ canon: CANON, home: HOME, routes: ROUTES, appName: APP_NAME.player, Root: PlayerRoot });
}
