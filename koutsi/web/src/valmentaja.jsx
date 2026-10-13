// valmentaja.jsx — production entry for the coach (koutsi.krossi.app/valmentaja, opt-in).
import { installBackend } from './api/index.js';
import { backend } from './api/supabase/index.js';
import { mountApp } from './app/mount.jsx';
import { APP_NAME } from './lib/constants.js';
import { CoachRoot } from './coach/CoachRoot.jsx';
import { CANON, HOME, ROUTES } from './coach/routes.js';

installBackend(backend);
mountApp({ canon: CANON, home: HOME, routes: ROUTES, appName: APP_NAME.coach, Root: CoachRoot });
