// mount.jsx — providers + error boundary + router setup, shared by the four entry files.
import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfirmProvider, ErrorState, ToastProvider } from '../ui/index.js';
import { configureRouter } from './router.js';
import { SessionProvider } from './session.jsx';

/** Last line of defence: a render error shows a friendly page instead of a blank screen. */
class AppErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('Koutsi kaatui', error, info?.componentStack);
    try { window.koutsiUsage?.error('Sivu kaatui', error?.message || String(error)); } catch { /* analytics only */ }
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="gate-error">
        <ErrorState
          title="Hups, jokin meni rikki"
          error={{ userMessage: 'Sivu kaatui odottamattomasti. Lataa sivu uudelleen — tietosi ovat tallessa.' }}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }
}

/**
 * mountApp({ canon, home, routes, appName, Root })
 * The opt-in switch (?uusi=1) is handled by the worker; the parameter is dropped from the
 * address bar here so a shared link doesn't carry it along.
 */
export function mountApp({ canon, home, routes, appName, Root }) {
  const url = new URL(window.location.href);
  if (url.searchParams.has('uusi')) {
    url.searchParams.delete('uusi');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
  const prefix = /^\/demo(\/|$)/.test(window.location.pathname) ? '/demo' : '';
  configureRouter({ canon, home, routes, prefix });
  createRoot(document.getElementById('root')).render(
    <AppErrorBoundary>
      <ToastProvider>
        <ConfirmProvider>
          <SessionProvider appName={appName}>
            <Root />
          </SessionProvider>
        </ConfirmProvider>
      </ToastProvider>
    </AppErrorBoundary>,
  );
}
