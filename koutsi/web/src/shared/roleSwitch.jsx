// roleSwitch.jsx — the admin's "Valmentaja | Pelaaja" switch in the top bar. One account can be
// both: the coach row plus a player row linked to their own coaching, so the same person sees
// the coach app (/valmentaja) and, one tap later, what a player in their groups sees (/pelaaja).
//
// Only for Koutsi admins (checked on the server), never in the demos (except the dev preview
// ?esikatsele) and never while acting as another coach — the bar it lives in is hidden then.
// The first switch to the player side asks which of the admin's own groups to join as a player
// (koutsi_admin_join_own_groups); after that a tap just opens the other app.
import { useEffect, useState } from 'react';
import { api, isDemo } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { browserPath, canonBase } from '../app/router.js';
import { useSession } from '../app/session.jsx';
import { Button, ChipSelect, Sheet, useToast } from '../ui/index.js';
import { previewRenewed } from './renewed.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const ROLES = [
  { base: '/valmentaja', home: '/valmentaja/koti', label: 'Valmentaja' },
  { base: '/pelaaja', home: '/pelaaja/koti', label: 'Pelaaja' },
];

// A full page load: the other role is its own bundle. The dev preview flag rides along.
const openApp = (role) => window.location.assign(browserPath(role.home) + (previewRenewed ? '?esikatsele=rooli' : ''));

function JoinOwnGroupsSheet({ open, onClose }) {
  const { state } = useData();
  const toast = useToast();
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const groups = [...(state.groups || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), 'fi'));
  const join = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.coach.joinOwnGroups(picked);
      openApp(ROLES[1]);
    } catch (err) {
      setBusy(false);
      toast(err.userMessage || 'Pelaajanäkymään siirtyminen ei onnistunut.', { tone: 'error' });
    }
  };
  return (
    <Sheet open={open} onClose={onClose} size="md" title="Pelaajanäkymä"
      subtitle="Liity omiin ryhmiisi pelaajaksi, niin näet saman kuin pelaajasi."
      footer={<Button variant="dark" size="lg" block loading={busy} onClick={join}>{picked.length ? 'Liity ja siirry pelaajaksi' : 'Siirry pelaajaksi ilman ryhmää'}</Button>}>
      <div className="stack-3">
        {groups.length > 0 && (
          <ChipSelect multiple ariaLabel="Ryhmät" value={picked} onChange={setPicked}
            options={groups.map((g) => ({ value: g.id, label: g.name }))} />
        )}
        <p className="k-fine">Näyt valituissa ryhmissä pelaajana: ryhmän muut pelaajat näkevät sinut jäsenlistalla, ja saat niistä pelaajan ilmoitukset. Ryhmiä voi muuttaa myöhemmin ryhmän sivulta kuten kenellä tahansa pelaajalla. Vaihtonappi näkyy vain sinulle.</p>
      </div>
    </Sheet>
  );
}

/** Renders `fallback` for everyone who isn't a Koutsi admin with both roles. */
export function RoleSwitch({ fallback = null }) {
  const { uid } = useSession();
  const { state } = useData();
  const here = canonBase();
  const onCoachSide = here === ROLES[0].base;
  const [admin, setAdmin] = useState(false);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    if (isDemo || !uid) return undefined;
    let alive = true;
    api.account.isAdmin().then((v) => { if (alive) setAdmin(Boolean(v)); }).catch(() => {});
    return () => { alive = false; };
  }, [uid]);

  // Linked to their own coaching: the coach's roster has them / the player's coaches include them.
  const selfLinked = onCoachSide
    ? (state.students || []).some((s) => s.id === uid)
    : (state.coaches || []).some((c) => c.id === uid);
  const show = previewRenewed || (admin && (onCoachSide || selfLinked));
  if (!show) return fallback;

  const pick = (role) => {
    if (role.base === here) return;
    if (onCoachSide && !selfLinked) setSheet(true);
    else openApp(role);
  };
  return (
    <>
      <div className="k-roleswitch" role="group" aria-label="Näkymä">
        {ROLES.map((r) => (
          <button key={r.base} type="button" className={cx('k-roleswitch-btn', r.base === here && 'is-on')}
            aria-pressed={r.base === here} onClick={() => pick(r)}>{r.label}</button>
        ))}
      </div>
      {onCoachSide && <JoinOwnGroupsSheet open={sheet} onClose={() => setSheet(false)} />}
    </>
  );
}
