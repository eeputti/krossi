// valmentaja-demo.jsx — the coach demo (demo.koutsi.krossi.app/valmentaja): same app, in-memory data.
import { installBackend } from './api/index.js';
import { backend, configureDemo } from './api/demo/index.js';
import { mountApp } from './app/mount.jsx';
import { APP_NAME } from './lib/constants.js';
import { CoachRoot } from './coach/CoachRoot.jsx';
import { CANON, HOME, ROUTES } from './coach/routes.js';

configureDemo({ role: 'coach' });
installBackend(backend, { demo: true });
mountApp({ canon: CANON, home: HOME, routes: ROUTES, appName: APP_NAME.coach, Root: CoachRoot });
