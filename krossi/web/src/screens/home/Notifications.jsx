// Notifications.jsx — the bell on Koti and its "Ilmoitukset" sheet. The list itself is built by
// features/notifications.js from Koti's own queries plus the conversations and the games still
// waiting for "Pelasitteko?". The badge counts what came after the bell was last opened (kept per
// player in this browser); every item opens what it is about.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync, useNow } from '../../app/hooks.js';
import { usePaywall } from '../../app/paywall.jsx';
import { navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { buildNotifications, countNew } from '../../features/notifications.js';
import { relativeShort } from '../../lib/format.js';
import { Avatar, EmptyState, Icon, IconButton, Sheet, SkeletonList } from '../../ui/index.js';
import { GAMES_CHANGED } from '../games/gameUtils.js';
import { RESULTS_CHANGED } from '../profile/matchResult.js';
import { askOutcome, askResult } from './PendingOutcomeCheck.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const SEEN_KEY = 'krossi_notifs_seen';
const KIND_ICON = {
  invite: 'mail', request: 'racket', message: 'chat', outcome: 'ball', soon: 'clock', newGame: 'sparkles', share: 'euro', splitPaid: 'check', sold: 'check',
  resultConfirm: 'trophy', resultAnswered: 'check',
};

function readSeen(uid) {
  try {
    return Number(localStorage.getItem(`${SEEN_KEY}:${uid}`)) || 0;
  } catch {
    return 0; // storage blocked: everything counts as new, which is the safe side
  }
}
function writeSeen(uid, at) {
  try {
    localStorage.setItem(`${SEEN_KEY}:${uid}`, String(at));
  } catch {
    // Private mode etc.: the badge simply comes back on the next visit.
  }
}

/** The notification list for Koti: takes Koti's useAsync results so nothing is fetched twice. */
export function useNotificationFeed({ open, mine, invites, requests, areas }) {
  const { user } = useSession();
  const conversations = useAsync(() => api.messages.listConversations(), []);
  const outcomes = useAsync(() => api.games.pendingOutcomes(), []);
  // Court booking: friends' paid parts and sold bookings. A player who never booked gets nothing here.
  const bookings = useAsync(() => api.booking.listMine().catch(() => null), []);
  // Results: others' waiting for my answer, and answers to mine.
  const toConfirm = useAsync(() => api.results.listToConfirm(), []);
  const results = useAsync(() => api.results.listMine(), []);
  const { reload: reloadConversations } = conversations;
  const { reload: reloadOutcomes } = outcomes;
  const { reload: reloadRequests } = requests;
  const { reload: reloadToConfirm } = toConfirm;
  const { reload: reloadResults } = results;

  useEffect(() => {
    const unsubscribe = api.messages.subscribeInbox(() => {
      reloadConversations({ silent: true });
      reloadRequests({ silent: true });
    });
    return () => unsubscribe?.();
  }, [reloadConversations, reloadRequests]);
  useEffect(() => {
    const onChange = () => reloadOutcomes({ silent: true });
    window.addEventListener(GAMES_CHANGED, onChange);
    return () => window.removeEventListener(GAMES_CHANGED, onChange);
  }, [reloadOutcomes]);
  useEffect(() => {
    const onChange = () => { reloadToConfirm({ silent: true }); reloadResults({ silent: true }); };
    window.addEventListener(RESULTS_CHANGED, onChange);
    return () => window.removeEventListener(RESULTS_CHANGED, onChange);
  }, [reloadToConfirm, reloadResults]);

  const now = useNow(60_000);
  const items = useMemo(() => buildNotifications({
    invites: invites.data || [],
    requests: requests.data || [],
    conversations: conversations.data || [],
    outcomes: outcomes.data || [],
    upcoming: mine.data?.upcoming || [],
    open: open.data || [],
    areas,
    bookings: [...(bookings.data?.upcoming || []), ...(bookings.data?.past || [])],
    toConfirm: toConfirm.data || [],
    results: results.data || [],
    uid: user?.id,
    now,
  }), [invites.data, requests.data, conversations.data, outcomes.data, mine.data, open.data, areas, bookings.data, toConfirm.data, results.data, user?.id, now]);
  const loading = [conversations, outcomes, invites, requests].some((q) => q.loading && q.data === undefined);
  return { items, loading };
}

function NotificationRow({ item, isNew, now, onOpen }) {
  return (
    <li>
      <button type="button" className={cx('home-notif', isNew && 'is-new')} onClick={() => onOpen(item)}>
        <span className="home-notif-art">
          {item.person ? <Avatar person={item.person} size={42} /> : <span className={cx('home-notif-icon', `is-${item.kind}`)}><Icon name={KIND_ICON[item.kind]} size={20} /></span>}
          {item.person && <span className={cx('home-notif-kind', `is-${item.kind}`)} aria-hidden="true"><Icon name={KIND_ICON[item.kind]} size={11} strokeWidth={2.4} /></span>}
        </span>
        <span className="home-notif-text">
          <span className="home-notif-title">{item.title}</span>
          {item.body && <span className="home-notif-body">{item.body}</span>}
        </span>
        <span className="home-notif-side">
          <span className="home-notif-time t-num">{relativeShort(new Date(Math.min(item.at, now)).toISOString(), now)}</span>
          {isNew && <span className="home-notif-dot" aria-label="Uusi" />}
        </span>
      </button>
    </li>
  );
}

export function NotificationsButton({ feed }) {
  const { user } = useSession();
  const { requirePaid } = usePaywall();
  const uid = user?.id;
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(() => readSeen(uid));
  // While the sheet is open the dots still show what was new when it was opened.
  const [shownSince, setShownSince] = useState(seenAt);
  const [outcomeGame, setOutcomeGame] = useState(null);
  const [confirmResult, setConfirmResult] = useState(null);
  const now = useNow(60_000);
  const fresh = countNew(feed.items, seenAt);

  const openSheet = () => {
    const at = Date.now();
    setShownSince(seenAt);
    setSeenAt(at);
    writeSeen(uid, at);
    setOpen(true);
  };

  const openItem = (item) => {
    if (item.kind === 'outcome') {
      setOutcomeGame(item.game);
      setOpen(false);
      return;
    }
    if (item.kind === 'resultConfirm') {
      setConfirmResult(item.result);
      setOpen(false);
      return;
    }
    setOpen(false);
    if (item.to) navigate(item.to);
    else if (item.game) requirePaid(() => navigate(`/pelaa/peli/${item.game.id}`), 'Avaa peli');
  };

  // "Pelasitteko?" and "Vahvistatko tuloksen?" are their own sheets: ask once this one has gone.
  const onClosed = () => {
    if (outcomeGame) askOutcome(outcomeGame);
    if (confirmResult) askResult(confirmResult);
    setOutcomeGame(null);
    setConfirmResult(null);
  };

  return (
    <>
      <IconButton
        icon="bell"
        variant="on-dark"
        label={fresh ? `Ilmoitukset (${fresh} uutta)` : 'Ilmoitukset'}
        badge={fresh || undefined}
        className="home-bell"
        onClick={openSheet}
      />
      <Sheet open={open} onClose={() => setOpen(false)} onClosed={onClosed} title="Ilmoitukset" size="md">
        {feed.loading && feed.items.length === 0 ? (
          <SkeletonList count={4} />
        ) : feed.items.length === 0 ? (
          <EmptyState
            compact
            art="mail"
            title="Ei uusia ilmoituksia"
            text="Täällä näkyvät pelikutsut, pelipyynnöt, uudet viestit ja pelit lähelläsi."
          />
        ) : (
          <ul className="home-notifs">
            {feed.items.map((item) => (
              <NotificationRow key={item.id} item={item} now={now} isNew={item.at > shownSince} onOpen={openItem} />
            ))}
          </ul>
        )}
      </Sheet>
    </>
  );
}
