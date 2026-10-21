// Notifications.jsx — the bell: the other half of the email notifications, for whoever turned
// email off. Items open what they are about (the old bell was a dead list).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { navigate } from '../app/router.js';
import { EmptyState, IconButton, Sheet, useToast } from '../ui/index.js';
import { koutsiFmtEventDate } from '../domain/timeline.js';

const cx = (...c) => c.filter(Boolean).join(' ');

/** Maps a stored link_path ('/pelaaja', '/valmentaja', …) to a canonical in-app path. A
 *  "Treenit ohi! Miten meni?" keeps its ?fiilis= (and ?toive=) so the player app opens the pop-up. */
export function targetOf(linkPath, home) {
  if (!linkPath) return null;
  const [raw, query = ''] = String(linkPath).split('?');
  const path = raw.replace(/\/+$/, '');
  const from = new URLSearchParams(query);
  const keep = new URLSearchParams();
  ['fiilis', 'toive'].forEach((key) => { if (from.get(key)) keep.set(key, from.get(key)); });
  const suffix = keep.toString() ? `?${keep}` : '';
  if (path === '/pelaaja' || path === '/valmentaja') return home + suffix;
  return path.startsWith('/pelaaja/') || path.startsWith('/valmentaja/') ? path + suffix : null;
}

export function NotificationsButton({ uid, home, variant = 'soft' }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api.notifications.list(uid).then(setItems).catch(() => {}), [uid]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => api.notifications.subscribe(uid, load), [uid, load]);
  const unread = items.filter((n) => !n.read).length;
  const openSheet = async () => {
    setOpen(true);
    if (unread > 0) {
      try {
        await api.notifications.markRead(uid);
        setItems((list) => list.map((n) => ({ ...n, read: true })));
      } catch (err) { toast(err); }
    }
  };
  return (
    <>
      <IconButton icon="bell" label={unread ? `Ilmoitukset (${unread} uutta)` : 'Ilmoitukset'} variant={variant} badge={unread || undefined} onClick={openSheet} />
      <Sheet open={open} onClose={() => setOpen(false)} title="Ilmoitukset" size="md">
        {items.length === 0 ? (
          <EmptyState compact art="mail" title="Ei vielä ilmoituksia" text="Täällä näkyvät uudet huomiot, kotiläksyt ja treenimuutokset." />
        ) : (
          <ul className="k-notifs">
            {items.map((n) => {
              const to = targetOf(n.linkPath, home);
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
                    <button type="button" className="k-notif is-link" onClick={() => { setOpen(false); navigate(to); }}>{body}</button>
                  ) : <div className="k-notif">{body}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
    </>
  );
}
