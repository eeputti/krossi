// Notifications.jsx — the bell: the other half of the email notifications, for whoever turned
// email off. Items open what they are about (the old bell was a dead list).
import { useCallback, useEffect, useReducer, useState } from 'react';
import { api } from '../api/index.js';
import { navigate } from '../app/router.js';
import { EmptyState, IconButton, Sheet, useToast } from '../ui/index.js';
import { koutsiFmtEventDate } from '../domain/timeline.js';

const cx = (...c) => c.filter(Boolean).join(' ');

// Most stored notifications point at the app's root ('/pelaaja'); a tap then opens where the thing
// actually is, by its kind — not Koti, where a tap seemed to do nothing.
// The database triggers write 'diary', 'homework', 'video' and 'announcement'; older rows and the
// demo seed say 'diary_added', 'homework_added', 'video_added'/'video_shared'. Both mean the same.
const KIND_ALIASES = { diary: 'diary_added', homework: 'homework_added', video: 'video_added', video_shared: 'video_added' };
export const notificationKind = (kind) => KIND_ALIASES[kind] || kind;
const PLAYER_PLACE = {
  training_added: '/pelaaja/treenit',
  training_cancelled: '/pelaaja/treenit',
  homework_added: '/pelaaja/treenit',
  diary_added: '/pelaaja/kehitys?nayta=valmentajalta',
  video_added: '/pelaaja/harjoitteet',
  announcement: '/pelaaja/koti',
};

/** Maps a stored link_path ('/pelaaja', '/valmentaja', …) to a canonical in-app path. A
 *  "Treenit ohi! Miten meni?" keeps its ?fiilis= (and ?toive=) so the player app opens the pop-up. */
export function targetOf(linkPath, home, kind = null) {
  if (!linkPath) return null;
  const [raw, query = ''] = String(linkPath).split('?');
  const path = raw.replace(/\/+$/, '');
  const from = new URLSearchParams(query);
  const keep = new URLSearchParams();
  ['fiilis', 'toive'].forEach((key) => { if (from.get(key)) keep.set(key, from.get(key)); });
  const suffix = keep.toString() ? `?${keep}` : '';
  if (path === '/pelaaja' && !suffix && PLAYER_PLACE[notificationKind(kind)]) return PLAYER_PLACE[notificationKind(kind)];
  if (path === '/pelaaja' || path === '/valmentaja') return home + suffix;
  return path.startsWith('/pelaaja/') || path.startsWith('/valmentaja/') ? path + suffix : null;
}

// One list per signed-in user, shared by every place that shows it (the Koti bell, the Lisää badge
// and drawer row, the player's "Uusi" marks): reading them in one place clears them everywhere.
const stores = new Map(); // uid → { items, listeners, unsubscribe }
function emitStore(store) { store.listeners.forEach((l) => l()); }
function loadStore(uid, store) {
  return api.notifications.list(uid).then((items) => { store.items = items; emitStore(store); }).catch(() => {});
}
function joinStore(uid, listener) {
  let store = stores.get(uid);
  if (!store) {
    store = { items: [], listeners: new Set(), unsubscribe: null };
    stores.set(uid, store);
    loadStore(uid, store);
    const unsubscribe = api.notifications.subscribe(uid, () => loadStore(uid, store)) || null;
    // The notifications table is not in the realtime feed, so the bell would stay as it was at
    // start-up: read it again when the app comes back to the front and once a minute while open.
    const refresh = () => { if (document.visibilityState === 'visible') loadStore(uid, store); };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 60000);
    store.unsubscribe = () => {
      unsubscribe?.();
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      clearInterval(timer);
    };
  }
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
    if (store.listeners.size === 0) { store.unsubscribe?.(); stores.delete(uid); }
  };
}

/** The signed-in user's notifications: the list, how many are unread, and "mark all read". */
export function useNotifications(uid) {
  const toast = useToast();
  const [, rerender] = useReducer((x) => x + 1, 0);
  useEffect(() => (uid ? joinStore(uid, rerender) : undefined), [uid]);
  const items = (uid && stores.get(uid)?.items) || [];
  const unread = items.filter((n) => !n.read).length;
  const markRead = useCallback(async () => {
    const store = uid ? stores.get(uid) : null;
    if (!store || !store.items.some((n) => !n.read)) return;
    store.items = store.items.map((n) => ({ ...n, read: true }));
    emitStore(store);
    try { await api.notifications.markRead(uid); } catch (err) { toast(err); loadStore(uid, store); }
  }, [uid, toast]);
  return { items, unread, markRead };
}

/** The list itself; an item opens what it is about. */
export function NotificationsSheet({ open, onClose, items, home }) {
  return (
    <Sheet open={open} onClose={onClose} title="Ilmoitukset" size="md">
      {items.length === 0 ? (
        <EmptyState compact art="mail" title="Ei vielä ilmoituksia" text="Täällä näkyvät uudet huomiot, kotiläksyt ja treenimuutokset." />
      ) : (
        <ul className="k-notifs">
          {items.map((n) => {
            const to = targetOf(n.linkPath, home, n.kind);
            const body = (
              <>
                <span className={cx('k-notif-dot', !n.read && 'is-new')} aria-hidden="true" />
                <span className="k-notif-text">
                  <span className="k-notif-title">{n.title}</span>
                  {n.body && <span className="k-notif-body">{n.body}</span>}
                  <span className="k-notif-date">{koutsiFmtEventDate(n.createdAt)}</span>
                </span>
              </>
            );
            return (
              <li key={n.id}>
                {to ? (
                  <button type="button" className="k-notif is-link" onClick={() => { onClose(); navigate(to); }}>{body}</button>
                ) : <div className="k-notif">{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

export function NotificationsButton({ uid, home, variant = 'soft' }) {
  const { items, unread, markRead } = useNotifications(uid);
  const [open, setOpen] = useState(false);
  const openSheet = () => { setOpen(true); markRead(); };
  return (
    <>
      <IconButton icon="bell" label={unread ? `Ilmoitukset (${unread} uutta)` : 'Ilmoitukset'} variant={variant} badge={unread || undefined} onClick={openSheet} />
      <NotificationsSheet open={open} onClose={() => setOpen(false)} items={items} home={home} />
    </>
  );
}
