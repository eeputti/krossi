// renewed.jsx — the one-time "Krossi Koutsin ilme on uudistunut" note for people who already
// used the old Koutsi, and the "[BETA] Koutsilla uusi ilme! Palaa vanhaan" bar. The note shows
// once per account: closing it is kept on the account (RENEWED_SEEN_KEY in the auth metadata) and
// on the device; a device that closed it before 11.11.2026 (localStorage only) copies that to the
// account the next time the app opens there. Never in the demos, never while an admin acts as a
// coach, and never on an account's first visit (the intro film comes first).
// Accounts made from 11.11.2026 on never knew the old Koutsi (the user's call that day): no note,
// no way back (bar, Profiili row), and the old app sends them to this one (lib/koutsi-auth.jsx).
import { useEffect, useState } from 'react';
import { api, isDemo } from '../api/index.js';
import { useSession } from '../app/session.jsx';
import { RENEWED_SEEN_KEY } from '../lib/constants.js';
import { Button, Icon, Sheet } from '../ui/index.js';

// `npm run dev:koutsi` → /demo/valmentaja?esikatsele shows the beta bar and this note in the
// demo, so they can be checked without signing in. Production builds drop this branch.
export const previewRenewed = process.env.NODE_ENV !== 'production'
  && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('esikatsele');

// Same moment in lib/koutsi-auth.jsx (KOUTSI_NEW_ONLY_SINCE): keep the two equal.
export const NEW_ONLY_SINCE = '2026-11-11T00:00:00+02:00';

/** An account made before 11.11.2026 (a missing date counts as old, as before): it may still
 *  see the note and go back to the old app. `user` = useSession().user. */
export function knewOldKoutsi(user) {
  const made = Date.parse(user?.created_at || '');
  return !Number.isFinite(made) || made < Date.parse(NEW_ONLY_SINCE);
}

/** Show the "Koutsilla uusi ilme!" bar: in the real apps for accounts that knew the old Koutsi,
 *  or when previewing in dev. A function, not a constant: isDemo is set when the entry installs
 *  its backend, after the modules have loaded. */
export function showBetaBar(user) {
  return (!isDemo || previewRenewed) && knewOldKoutsi(user);
}

function seenHere() {
  try { return window.localStorage.getItem(RENEWED_SEEN_KEY) === '1'; } catch { return false; }
}
const seenOnAccount = (user) => Boolean(user?.user_metadata?.[RENEWED_SEEN_KEY]);
function markSeen(user) {
  try { window.localStorage.setItem(RENEWED_SEEN_KEY, '1'); } catch { /* private mode: the account still keeps it */ }
  if (!isDemo && user && !seenOnAccount(user)) api.account.markRenewedSeen().catch(() => { /* tried again on the next open */ });
}

/**
 * RenewedIntro
 *   role: 'coach' | 'player'
 *   eligible: an existing user who isn't being acted as (decided once, when the app opens)
 */
/** Whether the note would open now — for an app that has more than one thing to show when it opens.
 *  `user` = useSession().user: an account made from 11.11.2026 on, or one that closed it, never gets it. */
export function renewedNoteDue(user, eligible = true) {
  return Boolean(eligible) && (!isDemo || previewRenewed) && knewOldKoutsi(user)
    && (previewRenewed || (!seenHere() && !seenOnAccount(user)));
}

// Where the old app's things are now, so a returning user isn't lost — old name → new place.
const MOVED = {
  coach: [
    ['Oppilaat', 'Pelaajat'],
    ['Päiväkirja', 'Huomio (pelaajan sivulla ja Merkitse-napissa)'],
    ['Ryhmät ja Treenit', 'Viikkohallinta'],
    ['Viikon teemat', 'Koti → Aseta teema'],
    ['Harjoitteet ja Profiili', 'Lisää-valikko (puhelimessa)'],
  ],
  player: [
    ['Treenit', 'Viikko'],
    ['Fiilis treenin jälkeen', 'Koti → Miten meni?'],
    ['Toive valmentajalle', 'Merkitse-nappi'],
    ['Ryhmä, Harjoitteet ja Profiili', 'Lisää-valikko (puhelimessa)'],
  ],
};

function MovedList({ role }) {
  return (
    <div className="k-moved">
      <div className="k-moved-head">Mistä löydät tutut asiat</div>
      <ul className="k-moved-list">
        {MOVED[role === 'coach' ? 'coach' : 'player'].map(([from, to]) => (
          <li key={from} className="k-moved-row">
            <span className="k-moved-from">{from}</span>
            <Icon name="arrow-right" size={14} className="k-moved-arrow" />
            <span className="k-moved-to">{to}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RenewedIntro({ role, eligible }) {
  const { user } = useSession();
  const [open, setOpen] = useState(() => renewedNoteDue(user, eligible));
  const close = () => { markSeen(user); setOpen(false); };
  // Closed on this device before the account kept it: tell the account once, so other devices know.
  const copyToAccount = !isDemo && Boolean(user) && seenHere() && !seenOnAccount(user);
  useEffect(() => {
    if (copyToAccount) api.account.markRenewedSeen().catch(() => { /* tried again on the next open */ });
  }, [copyToAccount]);
  // Header-less sheet: the dark "Hieman uutisia" band is the header, the floating close sits on it.
  return (
    <Sheet open={open} onClose={close} size="sm" className="k-renewed-sheet" labelledBy="k-renewed-title"
      footer={<Button variant="dark" size="lg" block onClick={close}>Selvä</Button>}>
      <div className="k-renewed-band">
        <span className="k-renewed-icon" aria-hidden="true"><Icon name="sparkles" size={20} /></span>
        <span className="k-renewed-tag">Hieman uutisia</span>
      </div>
      <div className="k-renewed">
        <h2 id="k-renewed-title" className="sheet-title">Krossi Koutsin ilme on uudistunut</h2>
        <p className="k-body-text">
          {role === 'coach'
            ? <>Uutena esimerkiksi <b>Koti</b>-näkymä, joka kokoaa kaiken yhteen: teemat, treenit ja pelaajien kuulumiset.</>
            : <>Uutena esimerkiksi <b>Koti</b>-näkymä, joka kokoaa kaiken yhteen: viikon teeman, seuraavan treenin ja oman kehityksesi.</>}
        </p>
        <MovedList role={role} />
        <p className="k-renewed-note">
          Tietosi ovat tallessa. Voit kuitenkin vielä vaihtaa vanhaan ulkoasuun yläreunan napista!
        </p>
        {/* The privacy notice promises to announce material changes in the app (25.10.2026 update). */}
        <p className="k-renewed-note">
          Päivitimme samalla tietosuojaselosteen: siinä kerrotaan uusista merkinnöistä ja siitä, kuka ne näkee.{' '}
          <a className="k-textlink" href="/tietosuoja" target="_blank" rel="noopener">Lue tietosuojaseloste <Icon name="arrow-right" size={13} /></a>
        </p>
      </div>
    </Sheet>
  );
}
