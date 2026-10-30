// PlayerOnboarding — a player's first profile ("Luo profiilisi"), the cheerful version: the Koutsi
// wordmark (its ball bounces) top left, a big optional profile photo in the middle (the app's own
// picker with crop, kept in memory until the profile exists), questions with their own colour and
// icon, home towns as tiles. Writes what the shared
// OnboardingScreen writes (api.account.createProfile, role 'player'); the coach's onboarding stays
// the shared one.
import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useSession } from '../app/session.jsx';
import { AREA_OPTIONS } from '../lib/constants.js';
import { useProfilePhoto } from '../shared/profilePhoto.jsx';
import { KoutsiWordmark } from '../shared/gates.jsx';
import { Button, Icon, Input, Spinner } from '../ui/index.js';

export function PlayerOnboarding() {
  const { uid, user, refreshProfile, signOut } = useSession();
  // a Google / Apple sign-in already knows the name
  const [name, setName] = useState(() => (user?.user_metadata?.full_name || user?.user_metadata?.name || '').trim());
  const [age, setAge] = useState('');
  const [area, setArea] = useState('');
  const [photo, setPhoto] = useState(null); // { blob, url } — the cropped picture, uploaded with the profile
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const picker = useProfilePhoto({
    uid, person: { name, avatarUrl: photo?.url || '' },
    onCropped: (blob) => setPhoto((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return blob ? { blob, url: URL.createObjectURL(blob) } : null;
    }),
  });
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  const ageValid = !age || (/^\d{1,3}$/.test(age) && Number(age) >= 1 && Number(age) < 120);
  const ready = name.trim() && area && ageValid;
  const save = async () => {
    if (!ready || busy) return;
    setError(''); setBusy(true);
    try {
      const avatarFile = photo ? new File([photo.blob], 'profiilikuva.jpg', { type: 'image/jpeg' }) : null;
      await api.account.createProfile(uid, { name, age: age || null, area, avatarFile, role: 'player' });
      await refreshProfile();
    } catch (err) { setError(err?.userMessage || 'Profiilia ei saatu tallennettua. Yritä uudelleen.'); setBusy(false); }
  };
  return (
    <div className="k-center-page">
      <div className="k-gate-card k-gate-card-wide po-card">
        <KoutsiWordmark size="sm" />
        <div className="po-hero">
          <h1 className="k-gate-title">Tervetuloa Koutsiin!</h1>
          <p className="k-gate-lead">Muutama pieni kysymys, niin päästään alkuun. Profiilisi ei näy julkisena eikä muiden haussa — valmentajasi näkee vain valmennuksessa tarvittavat tiedot.</p>
        </div>
        <div className="po-photo-big">
          <button type="button" className="wp-avatar" onClick={picker.open} disabled={picker.busy} aria-label={photo ? 'Vaihda profiilikuva' : 'Valitse profiilikuva'}>
            <span className="wp-avatar-ring" aria-hidden="true" />
            {photo ? <img className="po-photo-img" src={photo.url} alt="" /> : <span className="po-photo-empty"><Icon name="camera" size={34} /></span>}
            <span className="wp-avatar-badge">{picker.busy ? <Spinner size={16} /> : <Icon name={photo ? 'edit' : 'plus'} size={20} />}</span>
          </button>
          <Button variant="soft" icon="image" onClick={picker.open} disabled={picker.busy}>{photo ? 'Vaihda kuva' : 'Valitse kiva profiilikuva'}</Button>
          {photo && <Button variant="ghost" size="sm" onClick={picker.remove} disabled={picker.busy}>Poista kuva</Button>}
          <span className="po-photo-hint">Vapaaehtoinen — kasvokuva auttaa valmentajaa tunnistamaan sinut.</span>
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
      {picker.sheets}
    </div>
  );
}
