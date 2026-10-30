// WaitingProfileSheet — "Täydennä profiiliasi" for a player who has an account but no group yet
// (the join-code screen): a short, cheerful walk-through — photo, playing hand, favourite shot,
// tennis background, a few words — every step skippable, a little party at the end.
// The photo goes straight onto the shared profile (as in the app); the words and the tennis card
// are saved on "Valmis": the words onto the profile, the card onto the account until joining moves
// it onto the player's row (api.player.applyTennisDraft). The app still opens only with a code.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useSession } from '../app/session.jsx';
import { Avatar, Button, Icon, Illustration, Input, ProgressBar, Sheet, Spinner, Textarea, confetti } from '../ui/index.js';
import { Counter } from '../shared/profileEdit.jsx';
import { useProfilePhoto } from '../shared/profilePhoto.jsx';
import { FAVOURITE_SHOTS, PLAYS_HAND, TENNIS_STORY_MAX, parseStartYear, tennisDraftOf, tennisFacts } from '../domain/tennisProfile.js';
import { HEALTH_NOTE } from './sheets.jsx';

const BIO_MAX = 300;
const STEPS = ['photo', 'hand', 'shot', 'story', 'bio'];
const DONE = STEPS.length;

// Each choice gets its own colour and icon, so the tiles read at a glance.
const HAND_LOOK = { oikea: { icon: 'racket', tone: 'sky' }, vasen: { icon: 'racket', tone: 'clay', flip: true } };
const SHOT_LOOK = {
  forehand: { icon: 'racket', tone: 'lime' },
  rysty: { icon: 'racket', tone: 'sky', flip: true },
  syotto: { icon: 'ball', tone: 'clay' },
  palautus: { icon: 'refresh', tone: 'green' },
  lentolyonti: { icon: 'target', tone: 'violet' },
  smash: { icon: 'bolt', tone: 'red' },
  pudotus: { icon: 'sparkles', tone: 'teal' },
  lobbi: { icon: 'sun', tone: 'yellow' },
};

const formOf = ({ bio, tennis } = {}) => ({
  bio: bio || '',
  playsHand: tennis?.playsHand || '', favouriteShot: tennis?.favouriteShot || '',
  playingSince: tennis?.playingSince == null ? '' : String(tennis.playingSince), tennisStory: tennis?.tennisStory || '',
});

function ChoiceTile({ label, look, on, onPick, index, big = false }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onPick} style={{ '--i': index }}
      className={`wp-tile wp-tone-${look.tone}${on ? ' is-on' : ''}${big ? ' wp-tile-big' : ''}`}>
      <span className={`wp-tile-icon${look.flip ? ' is-flipped' : ''}`}><Icon name={look.icon} size={big ? 38 : 24} /></span>
      <span className="wp-tile-label">{label}</span>
      <span className="wp-tile-check" aria-hidden="true"><Icon name="check" size={14} /></span>
    </button>
  );
}

function StepHead({ step, title, sub }) {
  return (
    <div className="wp-head">
      <div className="wp-progress">
        <ProgressBar value={(step + 1) / STEPS.length} label={`Vaihe ${step + 1}/${STEPS.length}`} />
        <span className="wp-progress-count t-num">{step + 1}/{STEPS.length}</span>
      </div>
      <h2 className="wp-title" id="wp-title">{title}</h2>
      {sub && <p className="wp-sub">{sub}</p>}
    </div>
  );
}

export function WaitingProfileSheet({ open, onClose, onSaved }) {
  const { uid, profile } = useSession();
  const photo = useProfilePhoto({ uid, person: profile });
  const [initial, setInitial] = useState(null); // null while loading (or when loading failed)
  const [f, setF] = useState(formOf());
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState('fwd');
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const advanceTimer = useRef(null);

  useEffect(() => {
    if (!open || !uid) return undefined;
    let alive = true;
    setInitial(null); setLoadError(false); setError(''); setStep(0); setDir('fwd');
    api.account.getWaitingProfile(uid)
      .then((p) => { if (!alive) return; const form = formOf(p); setInitial(form); setF(form); })
      .catch(() => { if (alive) setLoadError(true); });
    return () => { alive = false; };
  }, [open, uid, attempt]);
  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const since = parseStartYear(f.playingSince);
  const sinceValid = !Number.isNaN(since);
  const dirty = Boolean(initial) && JSON.stringify(f) !== JSON.stringify(initial);
  const first = (profile?.name || '').trim().split(/\s+/)[0];

  const go = (to) => {
    clearTimeout(advanceTimer.current);
    setDir(to < step ? 'back' : 'fwd');
    setStep(to);
    setError('');
  };
  // a tap on a tile picks it and moves on by itself; a tap on the picked one takes it away
  const pick = (k, value) => {
    const next = f[k] === value ? '' : value;
    setF((x) => ({ ...x, [k]: next }));
    clearTimeout(advanceTimer.current);
    if (next) advanceTimer.current = setTimeout(() => go(step + 1), 420);
  };

  const finish = async () => {
    if (busy) return;
    setError(''); setBusy(true);
    try {
      if (dirty) {
        await api.account.saveWaitingProfile(uid, {
          bio: f.bio,
          tennis: { playsHand: f.playsHand, favouriteShot: f.favouriteShot, playingSince: since, tennisStory: f.tennisStory },
        });
      }
      setInitial(f);
      go(DONE);
      setTimeout(() => confetti({ y: window.innerHeight * 0.3 }), 180);
    } catch (err) {
      setError(err?.userMessage || 'Profiilia ei saatu tallennettua. Tarkista verkkoyhteys ja yritä uudelleen.');
    } finally { setBusy(false); }
  };

  // back to the code screen; it says "Profiili tallennettu" when there is something to see
  const done = () => onSaved(Boolean(profile?.avatarUrl || f.bio.trim() || tennisDraftOf({ ...f, playingSince: since })));
  const hasValue = [Boolean(profile?.avatarUrl), Boolean(f.playsHand), Boolean(f.favouriteShot), Boolean(f.playingSince || f.tennisStory.trim()), Boolean(f.bio.trim())][step];
  let footer = null;
  if (initial && step < DONE) {
    const last = step === DONE - 1;
    footer = (
      <div className="wp-footer">
        {step > 0 && <Button variant="ghost" size="lg" icon="arrow-left" onClick={() => go(step - 1)} disabled={busy}>Takaisin</Button>}
        <Button variant={last ? 'lime' : hasValue ? 'dark' : 'outline'} size="lg" block loading={busy}
          missing={step === 3 && !sinceValid ? `Tarkista vuosi (${1930}–${new Date().getFullYear()}).` : null}
          icon={last ? 'sparkles' : undefined} iconRight={!last && hasValue ? 'arrow-right' : undefined} onClick={last ? finish : () => go(step + 1)}>
          {last ? 'Valmis!' : hasValue ? 'Seuraava' : 'Ohita'}
        </Button>
      </div>
    );
  } else if (step === DONE) {
    footer = <Button variant="dark" size="lg" block onClick={done}>Jee, selvä!</Button>;
  }

  let body;
  if (!initial) {
    body = loadError ? (
      <div className="stack-3 wp-pad">
        <p className="field-msg field-msg-error" role="alert">Profiilia ei saatu haettua. Tarkista verkkoyhteys.</p>
        <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>Yritä uudelleen</Button>
      </div>
    ) : <div className="wp-loading"><Spinner /></div>;
  } else if (step === 0) {
    body = (
      <>
        <StepHead step={step} title={first ? `Hei ${first}! Näytä itsesi` : 'Näytä itsesi'} sub="Kasvokuva auttaa valmentajaa ja ryhmäkavereita tunnistamaan sinut." />
        <div className="wp-photo">
          <button type="button" className="wp-avatar" onClick={photo.open} disabled={photo.busy} aria-label="Lisää profiilikuva">
            <span className="wp-avatar-ring" aria-hidden="true" />
            <Avatar person={profile} size={124} />
            <span className="wp-avatar-badge">{photo.busy ? <Spinner size={16} /> : <Icon name="camera" size={20} />}</span>
          </button>
          <Button variant="soft" icon="camera" onClick={photo.open} disabled={photo.busy}>{photo.hasPhoto ? 'Vaihda kuva' : 'Lisää kuva'}</Button>
          {photo.hasPhoto && <Button variant="ghost" size="sm" onClick={photo.remove} disabled={photo.busy}>Poista kuva</Button>}
        </div>
      </>
    );
  } else if (step === 1) {
    body = (
      <>
        <StepHead step={step} title="Kummalla kädellä pelaat?" sub="Napauta — siirrymme seuraavaan itsestään." />
        <div className="wp-tiles wp-tiles-2" role="radiogroup" aria-label="Pelikäsi">
          {PLAYS_HAND.map((h, i) => <ChoiceTile key={h.value} big index={i} label={h.label} look={HAND_LOOK[h.value]} on={f.playsHand === h.value} onPick={() => pick('playsHand', h.value)} />)}
        </div>
      </>
    );
  } else if (step === 2) {
    body = (
      <>
        <StepHead step={step} title="Mikä on lempilyöntisi?" sub="Se, jota odotat koko treenin." />
        <div className="wp-tiles" role="radiogroup" aria-label="Lempilyönti">
          {FAVOURITE_SHOTS.map((s, i) => <ChoiceTile key={s.value} index={i} label={s.label} look={SHOT_LOOK[s.value]} on={f.favouriteShot === s.value} onPick={() => pick('favouriteShot', s.value)} />)}
        </div>
      </>
    );
  } else if (step === 3) {
    body = (
      <>
        <StepHead step={step} title="Milloin aloitit tenniksen?" sub="Ja jos haluat, pari sanaa tähänastisesta matkastasi." />
        <div className="wp-fields">
          <label className="wp-year">
            <span className="wp-year-icon"><Icon name="calendar" size={22} /></span>
            <span className="wp-year-text">Pelannut vuodesta</span>
            <Input inputMode="numeric" value={f.playingSince} placeholder="2015" aria-label="Pelannut vuodesta" className="wp-year-input"
              onChange={(e) => set('playingSince')(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} />
          </label>
          {!sinceValid && f.playingSince.length === 4 && <p className="field-msg field-msg-error">Kirjoita vuosi {1930}–{new Date().getFullYear()}.</p>}
          <div className="wp-text">
            <Textarea rows={3} value={f.tennisStory} onChange={set('tennisStory')} maxLength={TENNIS_STORY_MAX} aria-label="Tennistaustasi"
              placeholder="Esim. pelasin junnuna seurassa, sitten pitkä tauko — palasin kentille 2023." />
            <Counter value={f.tennisStory} max={TENNIS_STORY_MAX} />
          </div>
          <p className="k-fine">{HEALTH_NOTE}</p>
        </div>
      </>
    );
  } else if (step === 4) {
    body = (
      <>
        <StepHead step={step} title="Kerro vähän itsestäsi" sub="Mikä tenniksessä innostaa tai mitä haluaisit oppia?" />
        <div className="wp-fields">
          <div className="wp-text">
            <Textarea rows={4} value={f.bio} onChange={set('bio')} maxLength={BIO_MAX} aria-label="Esittely" placeholder="Haluan oppia uskaltamaan verkolle…" />
            <Counter value={f.bio} max={BIO_MAX} />
          </div>
          {error && <p className="field-msg field-msg-error" role="alert">{error}</p>}
        </div>
      </>
    );
  } else {
    const facts = tennisFacts({ playsHand: f.playsHand, favouriteShot: f.favouriteShot, playingSince: since || null });
    body = (
      <div className="wp-done">
        <div className="wp-done-art"><Illustration name="celebrate" size={132} /></div>
        <h2 className="wp-title" id="wp-title">Profiilisi on valmis!</h2>
        <div className="wp-card">
          <Avatar person={profile} size={56} />
          <div className="wp-card-main">
            <strong>{profile?.name}</strong>
            {facts.length > 0 && <div className="wp-facts">{facts.map((x, i) => <span key={x} className="wp-fact" style={{ '--i': i }}>{x}</span>)}</div>}
          </div>
        </div>
        <p className="wp-sub">Valmentajasi näkee profiilisi, kun liityt ryhmään. Nyt tarvitset vain koodin.</p>
      </div>
    );
  }

  return (
    <>
      <Sheet open={open} onClose={step === DONE ? done : onClose} size="md" className="wp-sheet" labelledBy="wp-title"
        confirmClose={dirty && step < DONE && !busy}
        onBack={() => { if (step > 0 && step < DONE) { go(step - 1); return true; } return false; }}
        footer={footer}>
        <div key={step} className={`wp-step wp-step-${dir}`}>{body}</div>
      </Sheet>
      {photo.sheets}
    </>
  );
}
