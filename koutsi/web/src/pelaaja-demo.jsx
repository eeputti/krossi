// pelaaja-demo.jsx — the player demo (demo.koutsi.krossi.app/pelaaja): same app, in-memory data.
import { installBackend } from './api/index.js';
import { backend, configureDemo } from './api/demo/index.js';
import { mountApp } from './app/mount.jsx';
import { APP_NAME } from './lib/constants.js';
import { PlayerRoot } from './player/PlayerRoot.jsx';
import { CANON, HOME, ROUTES } from './player/routes.js';

configureDemo({ role: 'player' });
installBackend(backend, { demo: true });
mountApp({ canon: CANON, home: HOME, routes: ROUTES, appName: APP_NAME.player, Root: PlayerRoot });
