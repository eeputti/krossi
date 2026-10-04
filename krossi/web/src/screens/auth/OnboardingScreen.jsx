// OnboardingScreen — shown after the first sign-in until a Krossi player profile exists (also for
// accounts Krossi Koutsi created: they share the profiles row but have no Krossi player data).
// One progressive scroll:
// photo + name, age, home city, level (+ competition classes), play styles. The rest is filled
// later from the profile. Sticky "Aloitetaan! 🎾" saves, celebrates and drops the player in the app.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { INVITE_CODE_KEY, authStore } from '../../app/App.jsx';
import { useBusy, useIsDesktop } from '../../app/hooks.js';
import { useSession } from '../../app/session.jsx';
import { AGE_RANGES, CITIES, COMPETITION_CLASSES, PLAY_STYLES, SKILL_LEVELS } from '../../lib/constants.js';
import { firstName } from '../../lib/format.js';
import { Avatar, Button, ChipSelect, Icon, Input, ProgressBar, Spinner, Toggle, confetti, useToast } from '../../ui/index.js';
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

const AGE_VALUES = new Set(AGE_RANGES.map((a) => a.value));
// Krossi is for 16+; Koutsi keeps its junior accounts private, and so do we.
const KOUTSI_JUNIOR_GROUPS = new Set(['junior_13_17', 'child_under_13']);
const isUnder16 = (age) => /^\d{1,3}$/.test(String(age || '')) && Number(age) < 16;

/** Koutsi junior accounts can't join Krossi's player search — explain kindly, nothing is changed. */
function KoutsiJuniorNotice({ onSignOut, signingOut }) {
  return (
    <div className="auth-onb">
      <header className="auth-onb-hero court-lines on-dark">
        <div className="auth-onb-hero-inner">
          <div className="auth-onb-topbar">
            <span className="auth-onb-logo">Krossi</span>
            <button type="button" className="auth-onb-signout" onClick={onSignOut} disabled={signingOut}>
              {signingOut ? <Spinner size={14} /> : <Icon name="logout" size={15} />}
              Kirjaudu ulos
            </button>
          </div>
          <h1 className="auth-onb-title">Krossi on 16 vuotta täyttäneille</h1>
          <p className="auth-onb-lead">
            Tilisi on Krossi Koutsin junioritili. Juniorien profiilit pysyvät yksityisinä, joten Krossin
            pelaajahaku ei ole vielä käytössäsi. Koutsissa kaikki toimii kuten ennenkin.
          </p>
          <div className="auth-onb-junior-actions">
            <Button as="a" href="https://koutsi.krossi.app/pelaaja" variant="lime" size="lg" iconRight="arrow-right">Takaisin Krossi Koutsiin</Button>
          </div>
        </div>
      </header>
    </div>
  );
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
  const { user, profile: existing, setProfile, refreshProfile } = useSession();
  // `existing` = a profile Krossi Koutsi created; prefill from it and keep its private flag
  // unless the player explicitly opts in to the Krossi player search.
  const fromKoutsi = Boolean(existing);
  const [ageGroup, setAgeGroup] = useState(fromKoutsi ? undefined : null);
  const [visible, setVisible] = useState(true);
  const toast = useToast();
  const [busy, run] = useBusy();
  const isDesktop = useIsDesktop();
  const [signingOut, setSigningOut] = useState(false);
  const [name, setName] = useState(() => (existing?.name && existing.name !== 'Pelaaja' ? existing.name : prefillName(user)));
  const [age, setAge] = useState(() => existing?.ageRange || '');
  const [city, setCity] = useState(() => (CITIES.includes(existing?.city) ? existing.city : ''));
  const [skill, setSkill] = useState('');
  const [classes, setClasses] = useState([]);
  const [styles, setStyles] = useState([]);
  const [avatar, setAvatar] = useState({ path: null, preview: existing?.avatarUrl || null, uploading: false });
  const [flagged, setFlagged] = useState(() => new Set());
  const fileInput = useRef(null);
  const previewUrl = useRef(null);
  const refs = { name: useRef(null), city: useRef(null), skill: useRef(null) };

  const { inviterName } = useInviter(authStore.get(INVITE_CODE_KEY));

  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  useEffect(() => {
    if (!fromKoutsi) return undefined;
    let alive = true;
    api.profile.getKoutsiAgeGroup().then((g) => alive && setAgeGroup(g)).catch(() => alive && setAgeGroup(null));
    return () => { alive = false; };
  }, [fromKoutsi]);

  // An exact age (Koutsi stores years) isn't one of our ranges: keep it as is and hide the picker.
  const exactAge = age && !AGE_VALUES.has(age);

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
    hiddenFromFeed: fromKoutsi ? !visible : false,
    playingThisWeek: true,
    avatarPath: avatar.path,
    ...(fromKoutsi && visible && existing?.isDiscoverable === false ? { discoverable: true } : {}),
  }), [name, age, city, skill, classes, styles, avatar.path, fromKoutsi, visible, existing?.isDiscoverable]);

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

  if (fromKoutsi && ageGroup === undefined) {
    return <div className="gate-error"><Spinner size={28} /></div>;
  }
  if (fromKoutsi && (KOUTSI_JUNIOR_GROUPS.has(ageGroup) || isUnder16(existing?.ageRange))) {
    return <KoutsiJuniorNotice onSignOut={signOut} signingOut={signingOut} />;
  }

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
          <h1 className="auth-onb-title">{fromKoutsi ? 'Täydennä Krossi-profiilisi' : 'Tervetuloa Krossiin!'}</h1>
          <p className="auth-onb-lead">
            {fromKoutsi
              ? 'Sinulla on jo Krossi Koutsi -tili, joten osa tiedoista on valmiina. Nimi, kaupunki ja kuva ovat yhteiset Koutsin kanssa.'
              : 'Pari valintaa, niin löydät tasoisesi pelikaverit. Loput voit täyttää myöhemmin.'}
          </p>
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

        {!exactAge && (
          <Step n={2} title="Ikäryhmä" optional done={Boolean(age)}>
            <ChipSelect options={AGE_RANGES} value={age} onChange={setAge} allowEmpty layout="grid" columns={3} ariaLabel="Ikäryhmä" />
          </Step>
        )}

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

        {fromKoutsi && (
          <Step n={6} title="Näkyvyys" hint="Koutsi-profiilisi on tähän asti ollut yksityinen." done>
            <Toggle
              checked={visible}
              onChange={setVisible}
              icon="eye"
              label="Näy muille Krossi-pelaajille"
              hint={visible
                ? 'Muut pelaajat näkevät profiilisi ja voivat pyytää sinua pelaamaan.'
                : 'Pysyt piilossa pelaajalistalta, mutta voit silti liittyä peleihin ja luoda omia.'}
            />
          </Step>
        )}

        <p className="auth-onb-later" style={{ '--i': 7 }}>
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
