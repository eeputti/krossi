// MessagesProvider.jsx — Viestit for the signed-in role: the conversations, the unread count and
// whether the feature is on. Kept apart from the coach's / player's state snapshot on purpose: a
// new message only re-reads this small overview, not the whole week.
//
//   const { ready, enabled, threads, unread, reload, byStudent, byCoach, byId } = useMessages();
//
// ready is false until the database has Viestit (the migration) — then nothing about messages shows.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useResync } from '../../app/hooks.js';
import { unreadTotal } from '../../domain/messages.js';

const OFF = { ready: false, enabled: false, threads: [], unread: 0, loaded: false };
const Ctx = createContext(null);

export function MessagesProvider({ role, ownerId, off = false, children }) {
  const [data, setData] = useState(OFF);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (off) { setData({ ...OFF, loaded: true }); return null; }
    const mine = ++seq.current;
    try {
      const next = await api.messages.overview(role);
      if (mine === seq.current) setData({ ...next, loaded: true });
      return next;
    } catch {
      if (mine === seq.current) setData((d) => ({ ...d, loaded: true }));
      return null;
    }
  }, [role, off]);

  useEffect(() => { reload(); }, [reload, ownerId]);
  // Live: only once the database has Viestit (subscribing to a missing table would fail the channel).
  useEffect(() => {
    if (!data.ready) return undefined;
    let timer = null;
    const unsubscribe = api.messages.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { reload(); }, 250);
    });
    return () => { clearTimeout(timer); unsubscribe?.(); };
  }, [data.ready, reload]);
  useResync(() => { if (data.ready) reload(); });

  const value = useMemo(() => {
    const threads = data.threads || [];
    return {
      ...data,
      role,
      reload,
      unread: unreadTotal(threads),
      byId: (id) => threads.find((t) => t.id === id) || null,
      byStudent: (id) => threads.find((t) => t.studentId === id) || null,
      byCoach: (id) => threads.find((t) => t.coachId === id) || null,
    };
  }, [data, role, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const NONE = { ...OFF, role: null, reload: async () => null, byId: () => null, byStudent: () => null, byCoach: () => null };
export function useMessages() {
  return useContext(Ctx) || NONE;
}
