// demo.jsx — demo entry (krossi.app/demo and, until real courts open, the booking site krossi.app/varaa):
// same app on an in-memory backend, with the outdoor courts' booking world (see api/demo/bookingSeed.js).
import { installBackend } from './api/index.js';
import { backend } from './api/demo/index.js';
import { configureDemoWorld } from './api/demo/store.js';
import { mountApp } from './app/App.jsx';

configureDemoWorld({ courts: 'outdoor' });
installBackend(backend, { demo: true });
mountApp({ demo: true });
