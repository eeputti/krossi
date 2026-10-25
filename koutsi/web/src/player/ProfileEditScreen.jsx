// ProfileEditScreen (player) — /pelaaja/profiili/muokkaa: photo, name, a few words about oneself
// (profiles.bio — the coach sees it on the player's page), home town and age.
import { useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { useSession } from '../app/session.jsx';
import { Field, Input, Textarea } from '../ui/index.js';
import { AreaField, Counter, EditCard, ProfileEditPage } from '../shared/profileEdit.jsx';

const BIO_MAX = 300;
const formOf = (me) => ({ name: me.name || '', bio: me.bio || '', area: me.area || '', age: me.age == null ? '' : String(me.age) });

export function ProfileEditScreen() {
  const { state, ownerId, run } = useData();
  const { refreshProfile } = useSession();
  const me = state.students[0];
  const initial = useMemo(() => formOf(me), [me.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  const age = f.age ? Number(f.age) : null;
  const ageValid = age == null || (Number.isInteger(age) && age >= 1 && age < 120);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const canSave = Boolean(f.name.trim()) && ageValid && dirty;

  const save = async () => {
    setBusy(true);
    const name = f.name.trim();
    const bio = f.bio.trim();
    const res = await run(async () => {
      if (name !== me.name) await api.account.saveDisplayName(ownerId, name);
      if (bio !== (me.bio || '') || f.area !== (me.area || '')) await api.account.saveAbout(ownerId, { bio, area: f.area });
      if ((me.age ?? null) !== age) await api.player.saveAge(ownerId, age);
    }, 'Profiili tallennettu.');
    setBusy(false);
    if (res.ok) refreshProfile?.();
    return res.ok;
  };

  return (
    <ProfileEditPage person={me} uid={ownerId} back="/pelaaja/profiili" dirty={dirty} canSave={canSave} busy={busy} onSave={save}
      photoText="Kasvokuva auttaa valmentajaa ja ryhmäkavereita tunnistamaan sinut.">
      <EditCard title="Perustiedot" icon="user">
        <Field label="Nimi" htmlFor="pe-name" error={!f.name.trim() ? 'Kirjoita nimesi.' : null}>
          <Input id="pe-name" value={f.name} onChange={set('name')} maxLength={120} autoComplete="name" />
        </Field>
        <Field label="Ikä" optional htmlFor="pe-age" error={!ageValid ? 'Iän pitää olla 1–119 vuotta.' : null} hint="Ikää ei tarvitse ilmoittaa.">
          <Input id="pe-age" inputMode="numeric" value={f.age} onChange={(e) => set('age')(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} />
        </Field>
      </EditCard>
      <EditCard title="Kerro itsestäsi" icon="chat">
        <Field label="Esittely" optional htmlFor="pe-bio" hint="Näkyy valmentajallesi. Esim. kauanko olet pelannut, lempilyöntisi tai mikä tenniksessä innostaa.">
          <Textarea id="pe-bio" rows={4} value={f.bio} onChange={set('bio')} maxLength={BIO_MAX} placeholder="Pelannut tennistä viisi vuotta, lempilyönti on…" />
          <Counter value={f.bio} max={BIO_MAX} />
        </Field>
      </EditCard>
      <EditCard title="Missä pelaat" icon="pin">
        <AreaField value={f.area} onChange={set('area')} />
      </EditCard>
    </ProfileEditPage>
  );
}
