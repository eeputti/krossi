// OnboardingScreen — shown after the first sign-in until a profile exists. One progressive scroll:
// photo + name, age, home city, level (+ competition classes), play styles. The rest is filled
// later from the profile. Sticky "Aloitetaan! 🎾" saves, celebrates and drops the player in the app.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { INVITE_CODE_KEY, authStore } from '../../app/App.jsx';
import { useBusy, useIsDesktop } from '../../app/hooks.js';
import { useSession } from '../../app/session.jsx';
import { AGE_RANGES, CITIES, COMPETITION_CLASSES, PLAY_STYLES, SKILL_LEVELS } from '../../lib/constants.js';
import { firstName } from '../../lib/format.js';
import { Avatar, Button, ChipSelect, Icon, Input, ProgressBar, Spinner, confetti, useToast } from '../../ui/index.js';
import { useInviter } from './useInviter.js';

const cx = (...c) => c.filter(Boolean).join(' ');

const CITY_OPTIONS = CITIES.map((c) => ({ value: c, label: c }));
const SKILL_OPTIONS = SKILL_LEVELS.map((s) => ({ value: s.value, label: s.label, hint: s.desc }));
const CLASS_OPTIONS = COMPETITION_CLASSES.map((c) => ({ value: c, label: c }));
const REQUIRED = [
  { key: 'name', label: 'nimi' },
  { key: 'city', label: 'kotikaupunki' },
  { key: 'skill', label: 'pelitaso' },
];

function prefillName(user) {
  const meta = user?.user_metadata || user?.userMetadata || {};
  return String(meta.full_name || meta.name || user?.name || '').trim();
}

function Step({ n, title, hint, done, optional, flagged, stepRef, children }) {
  return (
    <section ref={stepRef} className={cx('auth-onb-step', done && 'is-done', flagged && 'is-flagged')} style={{ '--i': n }}>
      <header className="auth-onb-step-head">
        <span key={done ? 'done' : 'todo'} className={cx('auth-onb-step-num', done && 'pop')} aria-hidden="true">
          {done ? <Icon name="check" size={15} strokeWidth={3} /> : n}
        </span>
        <div className="auth-onb-step-heading">
          <h2 className="auth-onb-step-title">
            {title}
            {optional && <span className="auth-onb-optional">valinnainen</span>}
          </h2>
          {hint && <p className="auth-onb-step-hint">{hint}</p>}
        </div>
      </header>
      <div className="auth-onb-step-body">{children}</div>
    </section>
  );
}

export function OnboardingScreen() {
  const { user, setProfile, refreshProfile } = useSession();
  const toast = useToast();
  const [busy, run] = useBusy();
  const isDesktop = useIsDesktop();
  const [signingOut, setSigningOut] = useState(false);
  const [name, setName] = useState(() => prefillName(user));
  const [age, setAge] = useState('');
  const [city, setCity] = useState('');
  const [skill, setSkill] = useState('');
  const [classes, setClasses] = useState([]);
  const [styles, setStyles] = useState([]);
  const [avatar, setAvatar] = useState({ path: null, preview: null, uploading: false });
  const [flagged, setFlagged] = useState(() => new Set());
  const fileInput = useRef(null);
  const previewUrl = useRef(null);
  const refs = { name: useRef(null), city: useRef(null), skill: useRef(null) };

  const { inviterName } = useInviter(authStore.get(INVITE_CODE_KEY));

  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  const valid = { name: name.trim().length > 0, city: Boolean(city), skill: Boolean(skill) };
  const missing = REQUIRED.filter((r) => !valid[r.key]);
  const doneCount = REQUIRED.length - missing.length;
  const isFlagged = (key) => flagged.has(key) && !valid[key];

  const input = useMemo(() => ({
    name: name.trim(),
    ageRange: age || null,
    gender: null,
    areas: city ? [city] : [],
    bio: null,
    skillLevel: skill,
    competitionClasses: skill === 'kilpapelaaja' ? classes : [],
    playStyles: styles,
    availability: [],
    handedness: null,
    backhand: null,
    hiddenFromFeed: false,
    playingThisWeek: true,
    avatarPath: avatar.path,
  }), [name, age, city, skill, classes, styles, avatar.path]);

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { toast('Valitse kuvatiedosto.', { tone: 'error' }); return; }
    const prev = { path: avatar.path, preview: avatar.preview };
    const url = URL.createObjectURL(file);
    setAvatar({ ...prev, preview: url, uploading: true });
    try {
      const path = await api.profile.uploadAvatar(user.id, file);
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = url;
      setAvatar({ path, preview: url, uploading: false });
      toast('Hyvä kuva! 📸', { icon: 'camera' });
    } catch (err) {
      URL.revokeObjectURL(url);
      setAvatar({ ...prev, uploading: false });
      toast(err);
    }
  };

  const save = () => {
    if (busy) return;
    if (missing.length) {
      setFlagged(new Set(missing.map((m) => m.key)));
      refs[missing[0].key].current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast(`Vielä puuttuu: ${missing.map((m) => m.label).join(', ')}`, { tone: 'info', icon: 'info' });
      return;
    }
    if (avatar.uploading) { toast('Kuva latautuu vielä — hetki vain.', { tone: 'info' }); return; }
    run(async () => {
      try {
        const saved = await api.profile.saveMine(user.id, input);
        confetti();
        toast(`Tervetuloa Krossiin, ${firstName(saved?.name || input.name)}! 🎾`, { icon: 'sparkles', duration: 4200 });
        if (saved) setProfile(saved);
        else await refreshProfile();
      } catch (err) {
        toast(err);
      }
    });
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await api.auth.signOut();
    } catch (err) {
      toast(err);
      setSigningOut(false);
    }
  };

  return (
    <div className="auth-onb">
      <header className="auth-onb-hero court-lines on-dark">
        <div className="auth-onb-hero-inner">
          <div className="auth-onb-topbar">
            <span className="auth-onb-logo">Krossi</span>
            <button type="button" className="auth-onb-signout" onClick={signOut} disabled={signingOut}>
              {signingOut ? <Spinner size={14} /> : <Icon name="logout" size={15} />}
              Kirjaudu ulos
            </button>
          </div>
          {inviterName && (
            <div className="auth-onb-invite pop">
              <Avatar name={inviterName} color="green" size={26} />
              <span><strong>{inviterName}</strong> kutsui sinut Krossiin 🎾</span>
            </div>
          )}
          <h1 className="auth-onb-title">Tervetuloa Krossiin!</h1>
          <p className="auth-onb-lead">Pari valintaa, niin löydät tasoisesi pelikaverit. Loput voit täyttää myöhemmin.</p>
          <div className="auth-onb-progress">
            <ProgressBar value={doneCount / REQUIRED.length} tone="lime" label="Profiilin valmius" />
            <span className="auth-onb-progress-label t-num">{doneCount}/{REQUIRED.length} valmiina</span>
          </div>
        </div>
      </header>

      <main className="auth-onb-body stagger">
        <Step n={1} title="Kuka olet?" hint="Kuvallinen profiili saa enemmän pelikutsuja." done={valid.name} flagged={isFlagged('name')} stepRef={refs.name}>
          <div className="auth-onb-me">
            <button
              type="button"
              className="auth-onb-avatar"
              onClick={() => fileInput.current?.click()}
              aria-label={avatar.preview ? 'Vaihda profiilikuva' : 'Lisää profiilikuva'}
              disabled={avatar.uploading}
            >
              {avatar.preview || name.trim() ? (
                <Avatar key={avatar.preview || 'initials'} src={avatar.preview} name={name.trim()} color="green" size={84} className={avatar.preview ? 'pop' : undefined} />
              ) : (
                <span className="auth-onb-avatar-empty"><Icon name="user" size={34} strokeWidth={1.8} /></span>
              )}
              <span className="auth-onb-avatar-badge">
                {avatar.uploading ? <Spinner size={15} /> : <Icon name={avatar.preview ? 'edit' : 'camera'} size={16} />}
              </span>
            </button>
            <input ref={fileInput} type="file" accept="image/*" className="sr-only" onChange={pickPhoto} tabIndex={-1} aria-hidden="true" />
            <div className="auth-onb-name">
              <label className="field-label" htmlFor="onb-name">Nimi</label>
              <Input
                id="onb-name"
                size="lg"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Etunimi tai koko nimi"
                autoComplete="name"
                autoCapitalize="words"
                maxLength={60}
              />
              <span className="auth-onb-name-hint">{avatar.uploading ? 'Kuva latautuu…' : avatar.preview ? 'Kuva valmis ✓' : 'Napauta kuvaa lisätäksesi oman'}</span>
            </div>
          </div>
        </Step>

        <Step n={2} title="Ikäryhmä" optional done={Boolean(age)}>
          <ChipSelect options={AGE_RANGES} value={age} onChange={setAge} allowEmpty layout="grid" columns={3} ariaLabel="Ikäryhmä" />
        </Step>

        <Step
          n={3}
          title="Kotikaupunki"
          hint="Näet ensin tämän kaupungin pelit ja pelaajat. Lisää kaupunkeja voit valita myöhemmin."
          done={valid.city}
          flagged={isFlagged('city')}
          stepRef={refs.city}
        >
          <ChipSelect options={CITY_OPTIONS} value={city} onChange={setCity} ariaLabel="Kotikaupunki" />
        </Step>

        <Step n={4} title="Pelitaso" hint="Rehellinen arvio auttaa löytämään tasaisia pelejä." done={valid.skill} flagged={isFlagged('skill')} stepRef={refs.skill}>
          <ChipSelect options={SKILL_OPTIONS} value={skill} onChange={setSkill} size="lg" layout="grid" columns={isDesktop ? 2 : 1} ariaLabel="Pelitaso" className="auth-onb-levels" />
          {skill === 'kilpapelaaja' && (
            <div className="auth-onb-classes rise">
              <div className="auth-onb-sublabel">Kilpailuluokka <span className="field-optional">(voit valita useamman)</span></div>
              <ChipSelect options={CLASS_OPTIONS} value={classes} onChange={setClasses} multiple size="sm" ariaLabel="Kilpailuluokat" />
            </div>
          )}
        </Step>

        <Step n={5} title="Mitä haluat pelata?" optional done={styles.length > 0}>
          <ChipSelect options={PLAY_STYLES} value={styles} onChange={setStyles} multiple ariaLabel="Pelimuodot" />
        </Step>

        <p className="auth-onb-later" style={{ '--i': 6 }}>
          <Icon name="sparkles" size={16} />
          <span>Pelivuorot, kätisyyden ja esittelyn voit lisätä myöhemmin profiilista — ei kiirettä.</span>
        </p>
      </main>

      <div className="auth-onb-cta">
        <div className="auth-onb-cta-inner">
          <p className={cx('auth-onb-cta-hint', !missing.length && 'is-ready')} aria-live="polite">
            {missing.length
              ? <>Vielä puuttuu: {missing.map((m) => m.label).join(', ')}</>
              : <><Icon name="check-circle" size={15} /> Kaikki valmista — mennään pelaamaan!</>}
          </p>
          <Button variant="lime" size="lg" block loading={busy} onClick={save} className="auth-onb-submit">
            Aloitetaan! 🎾
          </Button>
        </div>
      </div>
    </div>
  );
}
