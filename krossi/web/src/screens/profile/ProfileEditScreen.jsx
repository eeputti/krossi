// ProfileEditScreen — /pelaa/profiili/muokkaa: every profile field + photo, with an unsaved-changes guard.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useBusy, useIsDesktop } from '../../app/hooks.js';
import { goBack } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import {
  AGE_RANGES, AVAILABILITY_SLOTS, BACKHAND_TYPES, CITIES, COMPETITION_CLASSES, GENDERS, HANDEDNESS, PLAY_STYLES, SKILL_LEVELS,
} from '../../lib/constants.js';
import {
  Avatar, Button, ChipSelect, Field, Icon, Input, Page, Skeleton, Spinner, Textarea, Toggle, TopBar, useConfirm, useToast,
} from '../../ui/index.js';
import { formToInput, profileToForm } from './profileForm.js';

const BIO_MAX = 300;
const SKILL_OPTIONS = SKILL_LEVELS.map((s) => ({ value: s.value, label: s.label, hint: s.desc }));
const SLOT_OPTIONS = AVAILABILITY_SLOTS.map((s) => ({ value: s.value, label: s.label, hint: s.time ? `klo ${s.time}` : 'milloin vain' }));
const CLASS_OPTIONS = COMPETITION_CLASSES.map((c) => ({ value: c, label: c }));

function EditCard({ title, icon, children }) {
  return (
    <section className="profile-edit-card rise">
      <h2 className="profile-edit-title">
        <span className="profile-edit-title-icon"><Icon name={icon} size={16} /></span>
        {title}
      </h2>
      <div className="profile-edit-fields">{children}</div>
    </section>
  );
}

export function ProfileEditScreen() {
  const { user, profile, setProfile } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const isDesktop = useIsDesktop();
  const ids = useId();
  const initial = useMemo(() => profileToForm(profile), [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm] = useState(initial);
  const [avatar, setAvatar] = useState({ path: null, preview: null, uploading: false });
  const [errors, setErrors] = useState({});
  const [busy, run] = useBusy();
  const fileInput = useRef(null);
  const saved = useRef(false);
  const previewUrl = useRef(null);

  const dirty = Boolean(avatar.path) || JSON.stringify(form) !== JSON.stringify(initial);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { if (!saved.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: null }));
  };
  const setCity = (city) => {
    setForm((f) => ({ ...f, city, alsoCities: f.alsoCities.filter((c) => c !== city) }));
    if (errors.city) setErrors((e) => ({ ...e, city: null }));
  };

  const back = async () => {
    if (dirty && !saved.current) {
      const ok = await confirm({
        title: 'Hylätäänkö muutokset?',
        message: 'Et ole tallentanut muutoksiasi. Jos poistut nyt, ne menetetään.',
        confirmLabel: 'Hylkää muutokset',
        cancelLabel: 'Jatka muokkausta',
        danger: true,
      });
      if (!ok) return;
    }
    goBack('/pelaa/profiili');
  };

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { toast('Valitse kuvatiedosto.', { tone: 'error' }); return; }
    const prev = { path: avatar.path, preview: avatar.preview };
    const url = URL.createObjectURL(file);
    setAvatar({ path: prev.path, preview: url, uploading: true });
    try {
      const path = await api.profile.uploadAvatar(user.id, file);
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = url;
      setAvatar({ path, preview: url, uploading: false });
      toast('Kuva valmis — muista tallentaa', { icon: 'camera', tone: 'info' });
    } catch (err) {
      URL.revokeObjectURL(url);
      setAvatar({ ...prev, uploading: false });
      toast(err);
    }
  };

  const save = () => run(async () => {
    const next = {};
    if (!form.name.trim()) next.name = 'Kerro nimesi, niin muut tietävät kenen kanssa pelaavat.';
    if (!form.city) next.city = 'Valitse kotikaupunkisi.';
    setErrors(next);
    if (Object.keys(next).length) {
      toast('Tarkista merkityt kohdat.', { tone: 'error' });
      document.querySelector('.field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (avatar.uploading) { toast('Kuva latautuu vielä — hetki vain.', { tone: 'info' }); return; }
    try {
      const updated = await api.profile.saveMine(user.id, formToInput(form, avatar.path));
      saved.current = true;
      setProfile(updated);
      toast('Profiili tallennettu!');
      goBack('/pelaa/profiili');
    } catch (err) {
      toast(err);
    }
  });

  const saveAction = <Button variant="lime" size="sm" loading={busy} onClick={save} className="profile-edit-save-top">Tallenna</Button>;

  if (!profile) {
    return (
      <>
        <TopBar title="Muokkaa profiilia" back="/pelaa/profiili" />
        <Page className="profile-subpage"><Skeleton h={260} r={22} /><Skeleton h={180} r={22} className="profile-skel-gap" /></Page>
      </>
    );
  }

  const bioLeft = BIO_MAX - form.bio.length;
  const otherCities = CITIES.filter((c) => c !== form.city).map((c) => ({ value: c, label: c }));
  const shownAvatar = avatar.preview || profile.avatarUrl;

  return (
    <>
      <TopBar title="Muokkaa profiilia" onBack={back} actions={saveAction} />
      <Page className="profile-subpage profile-edit">
        <EditCard title="Kuva ja perustiedot" icon="user">
          <div className="profile-edit-photo">
            <button type="button" className="profile-edit-avatar" onClick={() => fileInput.current?.click()} aria-label="Vaihda profiilikuva" disabled={avatar.uploading}>
              <Avatar src={shownAvatar} name={form.name || profile.name} color={profile.avatarColor} size={104} />
              <span className="profile-edit-avatar-badge">{avatar.uploading ? <Spinner size={16} /> : <Icon name="camera" size={17} />}</span>
            </button>
            <div className="profile-edit-photo-text">
              <span className="profile-edit-photo-title">{shownAvatar ? 'Hyvä kuva!' : 'Lisää profiilikuva'}</span>
              <span className="profile-edit-photo-sub">Kasvokuva auttaa pelikavereita tunnistamaan sinut kentällä.</span>
              <Button variant="soft" size="sm" icon="camera" onClick={() => fileInput.current?.click()} disabled={avatar.uploading}>
                {avatar.uploading ? 'Ladataan…' : shownAvatar ? 'Vaihda kuva' : 'Valitse kuva'}
              </Button>
            </div>
            <input ref={fileInput} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={pickPhoto} />
          </div>

          <Field label="Nimi" htmlFor={`${ids}-name`} error={errors.name}>
            <Input id={`${ids}-name`} size="lg" value={form.name} maxLength={40} autoComplete="given-name" placeholder="Etunimesi" onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Ikä">
            <ChipSelect ariaLabel="Ikä" options={AGE_RANGES} value={form.ageRange} onChange={(v) => set('ageRange', v)} size="sm" />
          </Field>
          <Field label="Sukupuoli" optional>
            <ChipSelect ariaLabel="Sukupuoli" options={GENDERS} value={form.gender} onChange={(v) => set('gender', v)} allowEmpty size="sm" />
          </Field>
        </EditCard>

        <EditCard title="Missä pelaat" icon="pin">
          <Field label="Kotikaupunki" error={errors.city}>
            <ChipSelect ariaLabel="Kotikaupunki" options={CITIES.map((c) => ({ value: c, label: c }))} value={form.city} onChange={setCity} size="sm" />
          </Field>
          <Field label="Pelaan myös" optional hint="Näyt myös näiden kaupunkien pelaajille ja peleille.">
            <ChipSelect ariaLabel="Pelaan myös" options={otherCities} value={form.alsoCities} onChange={(v) => set('alsoCities', v)} multiple size="sm" />
          </Field>
        </EditCard>

        <EditCard title="Pelitaso" icon="racket">
          <ChipSelect ariaLabel="Pelitaso" options={SKILL_OPTIONS} value={form.skillLevel} onChange={(v) => v && set('skillLevel', v)} size="lg" layout="grid" columns={isDesktop ? 2 : 1} />
          {form.skillLevel === 'kilpapelaaja' && (
            <Field label="Kilpailuluokat" hint="Valitse luokat, joissa pelaat tai olet pelannut.">
              <ChipSelect ariaLabel="Kilpailuluokat" options={CLASS_OPTIONS} value={form.competitionClasses} onChange={(v) => set('competitionClasses', v)} multiple size="sm" />
            </Field>
          )}
        </EditCard>

        <EditCard title="Pelityyli" icon="ball">
          <Field label="Pelimuodot" hint="Mikä sinua kiinnostaa?">
            <ChipSelect ariaLabel="Pelimuodot" options={PLAY_STYLES} value={form.playStyles} onChange={(v) => set('playStyles', v)} multiple size="sm" />
          </Field>
          <Field label="Pelikäsi" optional>
            <ChipSelect ariaLabel="Pelikäsi" options={HANDEDNESS} value={form.handedness} onChange={(v) => set('handedness', v)} allowEmpty size="sm" />
          </Field>
          <Field label="Rysty" optional>
            <ChipSelect ariaLabel="Rysty" options={BACKHAND_TYPES} value={form.backhand} onChange={(v) => set('backhand', v)} allowEmpty size="sm" />
          </Field>
        </EditCard>

        <EditCard title="Sopivat ajat" icon="clock">
          <ChipSelect ariaLabel="Sopivat ajat" options={SLOT_OPTIONS} value={form.availability} onChange={(v) => set('availability', v)} multiple layout="grid" columns={isDesktop ? 3 : 2} className="profile-edit-slots" />
        </EditCard>

        <EditCard title="Esittely" icon="edit">
          <Field htmlFor={`${ids}-bio`} label="Kerro itsestäsi pelaajana" optional>
            <Textarea
              id={`${ids}-bio`}
              rows={4}
              maxLength={BIO_MAX}
              value={form.bio}
              placeholder="Esim. Pelaan pari kertaa viikossa, mieluiten iltaisin. Etsin vakiopelikaveria kaksinpeliin!"
              onChange={(e) => set('bio', e.target.value.slice(0, BIO_MAX))}
            />
            <span className={`profile-edit-counter t-num${bioLeft < 30 ? ' is-low' : ''}`} aria-live="polite">{form.bio.length}/{BIO_MAX}</span>
          </Field>
        </EditCard>

        <EditCard title="Näkyvyys" icon="eye">
          <div className="profile-edit-toggles">
            <Toggle
              icon="users"
              label="Näy pelaajalistassa"
              hint="Muut löytävät sinut pelaajalistasta ja voivat pyytää pelaamaan."
              checked={!form.hiddenFromFeed}
              onChange={(on) => set('hiddenFromFeed', !on)}
            />
            <Toggle
              icon="calendar"
              label="Pelaan tällä viikolla"
              hint="Näytät muille, että olet valmis peliin tällä viikolla."
              checked={form.playingThisWeek}
              onChange={(on) => set('playingThisWeek', on)}
            />
          </div>
        </EditCard>

        <div className="profile-edit-bottom">
          <Button variant="lime" size="lg" block loading={busy} icon="check" onClick={save}>Tallenna muutokset</Button>
          <Button variant="ghost" block onClick={back}>Peruuta</Button>
        </div>
      </Page>
    </>
  );
}
