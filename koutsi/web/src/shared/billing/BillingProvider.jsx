// BillingProvider.jsx — Laskutus for the signed-in role, kept apart from the week's snapshot like
// Viestit: a sent invoice re-reads this small state, not the whole week.
//
//   coach:  const { ready, enabled, biller, invoices, memberships, reload, run } = useBilling();
//   player: const { ready, invoices, terms, reload } = useBilling();
//
// ready is false until the database has Laskutus (the migration); enabled is the coach's gate.
// run(fn, message) = a write: its Finnish error as a toast, then a fresh overview, then the message.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useResync } from '../../app/hooks.js';
import { useToast } from '../../ui/index.js';

const OFF = { ready: false, enabled: false, biller: null, invoices: [], memberships: [], terms: [], loaded: false };
const Ctx = createContext(null);

export function BillingProvider({ role, ownerId, off = false, children }) {
  const toast = useToast();
  const [data, setData] = useState(OFF);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (off || !ownerId) { setData({ ...OFF, loaded: true }); return null; }
    const mine = ++seq.current;
    try {
      const next = role === 'coach' ? await api.billing.overview(ownerId) : await api.billing.mine();
      if (mine === seq.current) setData({ ...OFF, ...next, loaded: true });
      return next;
    } catch {
      if (mine === seq.current) setData((d) => ({ ...d, loaded: true }));
      return null;
    }
  }, [role, ownerId, off]);

  useEffect(() => { reload(); }, [reload]);
  useResync(() => { if (data.ready) reload(); });

  const run = useCallback(async (fn, message) => {
    let result;
    try {
      result = await fn();
    } catch (err) {
      toast(err);
      reload(); // a two-step write may have half-landed (drafts made, sending failed): show what is there
      return { ok: false, error: err };
    }
    await reload();
    if (message) toast(message);
    return { ok: true, result };
  }, [reload, toast]);

  const value = useMemo(() => ({ ...data, role, reload, run }), [data, role, reload, run]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const NONE = { ...OFF, role: null, reload: async () => null, run: async () => ({ ok: false }) };
export function useBilling() {
  return useContext(Ctx) || NONE;
}

/** The link to an invoice's own page: koutsi.krossi.app/lasku/<token> (…/demo/lasku/… in the dev demo). */
export function invoiceLink(token) {
  if (typeof window === 'undefined') return `https://koutsi.krossi.app/lasku/${token}`;
  const prefix = /^\/demo(\/|$)/.test(window.location.pathname) ? '/demo' : '';
  return `${window.location.origin}${prefix}/lasku/${token}`;
}
