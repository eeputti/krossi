// ProfileEditScreen (coach) — /valmentaja/profiili/muokkaa: photo, name, the one-line intro under
// the name, a description, experience, specialties (players see these on their Ryhmäsi page) and
// home town.
import { useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { useSession } from '../app/session.jsx';
import { Button, ChipSelect, Field, Input, Textarea } from '../ui/index.js';
import { AreaField, Counter, EditCard, ProfileEditPage } from '../shared/profileEdit.jsx';
import { useCoach } from './CoachRoot.jsx';

const BIO_MAX = 600;
const SUGGESTED = ['Juniorit', 'Aikuisryhmät', 'Aloittelijat', 'Kilpavalmennus', 'Yksityistunnit', 'Nelinpeli', 'Syöttö ja palautus', 'Fysiikka', 'Lyöntitekniikka', 'Taktiikka'];

const formOf = (c) => ({
  name: c.name || '', tagline: c.tagline || '', bio: c.bio || '', experience: c.experience || '',
  specialties: [...(c.specialties || [])], area: c.area || '',
});

function SpecialtiesField({ value, onChange }) {
  const [own, setOwn] = useState('');
  const options = [...SUGGESTED, ...value.filter((s) => !SUGGESTED.includes(s))].map((s) => ({ value: s, label: s }));
  const add = () => {
    const t = own.trim().replace(/\s+/g, ' ');
    if (!t) return;
    if (!value.some((s) => s.toLowerCase() === t.toLowerCase())) onChange([...value, t]);
    setOwn('');
  };
  return (
    <>
      <Field label="Erikoisalat" optional hint="Valitse tai lisää omia.">
        <ChipSelect ariaLabel="Erikoisalat" options={options} value={value} onChange={onChange} multiple size="sm" />
      </Field>
      <div className="profile-edit-add">
        <Input value={own} onChange={(e) => setOwn(e.target.value)} maxLength={40} placeholder="Oma erikoisala, esim. Padel"
          aria-label="Oma erikoisala" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <Button variant="soft" icon="plus" onClick={add} disabled={!own.trim()}>Lisää</Button>
      </div>
    </>
  );
}

export function ProfileEditScreen() {
  const { state, run } = useData();
  const { coachId, uid } = useCoach();
  const { refreshProfile } = useSession();
  const c = state.coach;
  const initial = useMemo(() => formOf(c), [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  // Chips keep the suggestion order; own ones come after them.
  const setSpecialties = (list) => setF((x) => ({ ...x, specialties: list }));

  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const canSave = Boolean(f.name.trim()) && dirty;

  const save = async () => {
    setBusy(true);
    const name = f.name.trim();
    const res = await run(async () => {
      if (name !== c.name) await api.account.saveDisplayName(uid, name);
      await api.coach.saveProfile(coachId, {
        tagline: f.tagline.trim(), bio: f.bio.trim(), experience: f.experience.trim(), specialties: f.specialties,
      });
      if (f.area !== (c.area || '')) await api.account.saveAbout(uid, { area: f.area });
    }, 'Profiili tallennettu.');
    setBusy(false);
    if (res.ok) refreshProfile?.();
    return res.ok;
  };

  return (
    <ProfileEditPage person={c} uid={uid} back="/valmentaja/profiili" dirty={dirty} canSave={canSave} busy={busy} onSave={save}
      photoText="Pelaajasi näkevät kuvasi ja esittelysi omassa Koutsissaan.">
      <EditCard title="Perustiedot" icon="user">
        <Field label="Nimi" htmlFor="ce-name" error={!f.name.trim() ? 'Kirjoita nimesi.' : null}>
          <Input id="ce-name" value={f.name} onChange={set('name')} maxLength={120} autoComplete="name" />
        </Field>
        <Field label="Esittely" optional htmlFor="ce-tag" hint="Näkyy nimesi alla, esim. Tennisvalmentaja · Lahti">
          <Input id="ce-tag" value={f.tagline} onChange={set('tagline')} maxLength={120} />
        </Field>
      </EditCard>
      <EditCard title="Kerro itsestäsi" icon="chat">
        <Field label="Kuvaus" optional htmlFor="ce-bio" hint="Millainen valmentaja olet ja keitä valmennat?">
          <Textarea id="ce-bio" rows={4} value={f.bio} onChange={set('bio')} maxLength={BIO_MAX} />
          <Counter value={f.bio} max={BIO_MAX} />
        </Field>
        <Field label="Kokemus" optional htmlFor="ce-exp" hint="Esim. 10 vuotta valmennusta · Tennisliiton koulutus">
          <Input id="ce-exp" value={f.experience} onChange={set('experience')} maxLength={160} />
        </Field>
        <SpecialtiesField value={f.specialties} onChange={setSpecialties} />
      </EditCard>
      <EditCard title="Missä valmennat" icon="pin">
        <AreaField value={f.area} onChange={set('area')} />
      </EditCard>
    </ProfileEditPage>
  );
}
