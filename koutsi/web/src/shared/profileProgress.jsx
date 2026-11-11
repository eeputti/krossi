// profileProgress.jsx — the small "Profiili 50 % valmis, puuttuu kuva ja kuvaus" strip, for both
// roles: under the Profiili card (a tap opens Muokkaa profiilia at the first missing part) and on
// top of Muokkaa profiilia (counts the form as it is typed). The numbers come from
// domain/profileCompleteness.js.
// Once a profile reaches 100 % the account remembers it and the strip is gone for good; reaching
// it here says "Profiilisi on valmis!" once. Only the signed-in person's own profile ever shows it.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useSession } from '../app/session.jsx';
import { Icon, ProgressBar, useToast } from '../ui/index.js';
import { PROFILE_DONE_KEY, missingText, pctText } from '../domain/profileCompleteness.js';

// Marked in this visit (the demo has no account metadata; a slow USER_UPDATED must not bring it back).
const doneNow = new Set();
// Someone saw their profile below 100 % in this visit: reaching it then deserves a word.
const sawBelow = new Set();

/**
 * useProfileDone(uid) → { show, done, markDone }
 *   show: false for someone else's profile and once the account has reached 100 %.
 */
export function useProfileDone(uid) {
  const { user } = useSession();
  const own = Boolean(uid) && user?.id === uid;
  const remembered = doneNow.has(uid) || Boolean(user?.user_metadata?.[PROFILE_DONE_KEY]);
  const [done, setDone] = useState(remembered);
  const known = done || remembered;
  const markDone = () => {
    if (known || !own) return;
    doneNow.add(uid);
    setDone(true);
    api.account.markProfileDone().catch(() => { doneNow.delete(uid); }); // tried again on the next visit
  };
  return { show: own && !known, done: known, markDone };
}

/** The strip itself. `as="button"` with onClick on Profiili, a plain block on Muokkaa profiilia. */
export function ProgressStrip({ progress, onClick, className = '' }) {
  const { pct, missing } = progress;
  const complete = pct >= 100;
  const body = (
    <>
      <ProgressBar value={pct / 100} tone="green" className="k-pstrip-bar" label={`Profiili ${pctText(pct)}`} />
      <span className="k-pstrip-text">
        {complete ? (
          <><b>Profiili {pctText(100)}</b><Icon name="check" size={14} className="k-pstrip-check" /></>
        ) : (
          <>
            <span className="k-pstrip-long"><b>Profiili {pctText(pct)}</b>, puuttuu {missingText(missing, 3)}</span>
            <span className="k-pstrip-short"><b>{pctText(pct)}</b>, puuttuu {missingText(missing, 1)}</span>
          </>
        )}
      </span>
      {onClick && !complete && <Icon name="chevron-right" size={16} className="k-pstrip-go" />}
    </>
  );
  if (onClick && !complete) {
    return <button type="button" className={`k-pstrip is-button ${className}`} onClick={onClick}>{body}</button>;
  }
  return <div className={`k-pstrip${complete ? ' is-complete' : ''} ${className}`}>{body}</div>;
}

/**
 * The Profiili card's strip: hidden at 100 % and for good after that. Reaching 100 % marks the
 * account (and, when this visit saw it below, says so).
 */
export function ProfileProgress({ uid, progress, onOpen }) {
  const toast = useToast();
  const { show, markDone } = useProfileDone(uid);
  const complete = progress.pct >= 100;
  const marking = useRef(false);
  useEffect(() => {
    if (!show) return;
    if (!complete) { sawBelow.add(uid); return; }
    if (marking.current) return;
    marking.current = true;
    if (sawBelow.has(uid)) toast('Profiilisi on valmis!', { icon: 'check' });
    markDone();
  }, [show, complete]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!show || complete) return null;
  return <ProgressStrip progress={progress} onClick={() => onOpen(progress.missing[0]?.id)} className="k-profile-progress" />;
}

/** Note on Muokkaa profiilia that this visit saw the profile unfinished (so 100 % gets its word). */
export function noteBelow(uid) { sawBelow.add(uid); }
