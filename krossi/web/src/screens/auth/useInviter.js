// useInviter — who invited this visitor? Resolves an invite code to { inviterName }.
//   const { inviterName, loading } = useInviter(code)   // code: string | null
// Invites are a nice-to-have: an unknown code, a missing RPC (migration not applied yet) or a
// network error all degrade to "no inviter" so the welcome screens never break.
import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';

export function useInviter(code) {
  const [state, setState] = useState({ inviterName: null, loading: Boolean(code) });
  useEffect(() => {
    if (!code) { setState({ inviterName: null, loading: false }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    api.invites.resolve(code)
      .then((res) => { if (alive) setState({ inviterName: res?.inviterName?.trim() || null, loading: false }); })
      .catch(() => { if (alive) setState({ inviterName: null, loading: false }); }); // degrade to a generic welcome
    return () => { alive = false; };
  }, [code]);
  return state;
}
