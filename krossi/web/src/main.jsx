// main.jsx — production entry (krossi.app/pelaa): real Supabase backend.
import { installBackend } from './api/index.js';
import { backend } from './api/supabase/index.js';
import { mountApp } from './app/App.jsx';

installBackend(backend);
mountApp();
