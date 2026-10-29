// PlayerOnboarding — a player's first profile ("Luo profiilisi"), the cheerful version: a bouncing
// ball, three questions with their own colour and icon, home towns as tiles. Writes exactly what
// the shared OnboardingScreen writes (api.account.createProfile, role 'player'); the coach's
// onboarding stays the shared one.
import { useState } from 'react';
import { api } from '../api/index.js';
import { useSession } from '../app/session.jsx';
import { AREA_OPTIONS } from '../lib/constants.js';
import { Button, Icon, Input, TennisBall } from '../ui/index.js';

export function PlayerOnboarding() {
  const { uid, user, refreshProfile, signOut } = useSession();
  // a Google / Apple sign-in already knows the name
  const [name, setName] = useState(() => (user?.user_metadata?.full_name || user?.user_metadata?.name || '').trim());
  const [age, setAge] = useState('');
  const [area, setArea] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ageValid = !age || (/^\d{1,3}$/.test(age) && Number(age) >= 1 && Number(age) < 120);
  const ready = name.trim() && area && ageValid;
  const save = async () => {
    if (!ready || busy) return;
    setError(''); setBusy(true);
    try {
      await api.account.createProfile(uid, { name, age: age || null, area, avatarFile: null, role: 'player' });
      await refreshProfile();
    } catch (err) { setError(err?.userMessage || 'Profiilia ei saatu tallennettua. Yritä uudelleen.'); setBusy(false); }
  };
  return (
    <div className="k-center-page">
      <div className="k-gate-card k-gate-card-wide po-card">
        <div className="po-hero">
          <span className="po-hero-art"><TennisBall size={58} motion="bounce" shadow /></span>
          <h1 className="k-gate-title">Tervetuloa Koutsiin!</h1>
          <p className="k-gate-lead">Kolme pientä kysymystä, niin päästään alkuun. Profiilisi ei näy julkisena eikä muiden haussa — valmentajasi näkee vain valmennuksessa tarvittavat tiedot.</p>
        </div>
        {error && <p className="field-msg field-msg-error" role="alert">{error}</p>}
        <div className="stack-4">
          <div className="po-field wp-tone-sky" style={{ '--i': 0 }}>
            <label className="po-label" htmlFor="onb-name"><span className="po-label-icon"><Icon name="user" size={18} /></span>Mikä on nimesi?</label>
            <Input id="onb-name" size="lg" value={name} onChange={(e) => setName(e.target.value)} placeholder="Etunimi Sukunimi" autoComplete="name" />
          </div>
          <div className="po-field wp-tone-yellow" style={{ '--i': 1 }}>
            <label className="po-label" htmlFor="onb-age"><span className="po-label-icon"><Icon name="gift" size={18} /></span>Kuinka vanha olet? <span className="po-optional">(vapaaehtoinen)</span></label>
            <Input id="onb-age" size="lg" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} placeholder="Esim. 24" />
            {!ageValid && <p className="field-msg field-msg-error">Jos annat iän, sen pitää olla 1–119 vuotta.</p>}
          </div>
          <div className="po-field wp-tone-clay" style={{ '--i': 2 }}>
            <span className="po-label" id="onb-area"><span className="po-label-icon"><Icon name="pin" size={18} /></span>Missä pelaat?</span>
            <div className="po-towns" role="radiogroup" aria-labelledby="onb-area">
              {AREA_OPTIONS.map((a) => (
                <button key={a} type="button" role="radio" aria-checked={area === a} className={`po-town${area === a ? ' is-on' : ''}`} onClick={() => setArea(a)}>
                  <Icon name={area === a ? 'check-circle' : 'pin'} size={17} />{a}
                </button>
              ))}
            </div>
          </div>
        </div>
        <Button variant="lime" size="lg" block iconRight="arrow-right" loading={busy} onClick={save} className="k-gate-cta"
          missing={!name.trim() ? 'Kirjoita nimesi.' : !area ? 'Valitse, missä pelaat.' : !ageValid ? 'Iän pitää olla 1–119 vuotta (tai jätä tyhjäksi).' : null}>Jatketaan!</Button>
        <Button variant="ghost" block onClick={signOut}>Kirjaudu ulos</Button>
      </div>
    </div>
  );
}
