// pelaaja.jsx — production entry for the player (koutsi.krossi.app/pelaaja, opt-in).
import { installBackend } from './api/index.js';
import { backend } from './api/supabase/index.js';
import { mountApp } from './app/mount.jsx';
import { APP_NAME } from './lib/constants.js';
import { PlayerRoot } from './player/PlayerRoot.jsx';
import { CANON, HOME, ROUTES } from './player/routes.js';

installBackend(backend);
mountApp({ canon: CANON, home: HOME, routes: ROUTES, appName: APP_NAME.player, Root: PlayerRoot });
