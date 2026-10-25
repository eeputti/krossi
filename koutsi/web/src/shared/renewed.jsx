// renewed.jsx — the one-time "Krossi Koutsin ilme on uudistunut" note for people who already
// used the old Koutsi. Shown once per device (closing it is remembered in localStorage), never
// in the demos, never while an admin acts as a coach, and never to a brand-new account: they
// never saw the old look and get the WelcomeSheet instead.
import { useState } from 'react';
import { isDemo } from '../api/index.js';
import { Button, Icon, Sheet } from '../ui/index.js';

const SEEN_KEY = 'koutsi_uusi_ilme_nahty';

// `npm run dev:koutsi` → /demo/valmentaja?esikatsele shows the beta bar and this note in the
// demo, so they can be checked without signing in. Production builds drop this branch.
export const previewRenewed = process.env.NODE_ENV !== 'production'
  && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('esikatsele');

/** Show the "Koutsilla uusi ilme!" bar: in the real apps, or when previewing in dev. A
 *  function, not a constant: isDemo is set when the entry installs its backend, after the
 *  modules have loaded. */
export function showBetaBar() {
  return !isDemo || previewRenewed;
}

function seen() {
  try { return window.localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
function markSeen() {
  try { window.localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: it may show once more */ }
}

/**
 * RenewedIntro
 *   role: 'coach' | 'player'
 *   eligible: an existing user who isn't being acted as (decided once, when the app opens)
 */
/** Whether the note would open now — for an app that has more than one thing to show when it opens. */
export function renewedNoteDue(eligible = true) {
  return Boolean(eligible) && (!isDemo || previewRenewed) && (previewRenewed || !seen());
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
  const [open, setOpen] = useState(() => renewedNoteDue(eligible));
  const close = () => { markSeen(); setOpen(false); };
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
