// demo.jsx — demo entry (krossi.app/demo): same app on an in-memory backend.
import { installBackend } from './api/index.js';
import { backend } from './api/demo/index.js';
import { mountApp } from './app/App.jsx';

installBackend(backend, { demo: true });
mountApp({ demo: true });
