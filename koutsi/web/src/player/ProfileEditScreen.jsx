// ProfileEditScreen (player) — /pelaaja/profiili/muokkaa: photo, name, age, the tennis profile
// (hand, favourite shot, playing since, tennis history — koutsi_students, once the migration is in:
// state.tennisProfileReady), a few words about oneself (profiles.bio) and home town. The coach sees
// all but the home town on the player's page.
import { useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { useSession } from '../app/session.jsx';
import { ChipSelect, Field, Input, Textarea } from '../ui/index.js';
import { AreaField, Counter, EditCard, ProfileEditPage } from '../shared/profileEdit.jsx';
import { FAVOURITE_SHOTS, PLAYS_HAND, TENNIS_STORY_MAX, parseStartYear } from '../domain/tennisProfile.js';
import { HEALTH_NOTE } from './sheets.jsx';

const BIO_MAX = 300;
const formOf = (me) => ({
  name: me.name || '', bio: me.bio || '', area: me.area || '', age: me.age == null ? '' : String(me.age),
  playsHand: me.playsHand || '', favouriteShot: me.favouriteShot || '',
  playingSince: me.playingSince == null ? '' : String(me.playingSince), tennisStory: me.tennisStory || '',
});
const tennisOf = (x) => [x.playsHand || '', x.favouriteShot || '', x.playingSince ?? null, (x.tennisStory || '').trim()].join('|');

export function ProfileEditScreen() {
  const { state, ownerId, run } = useData();
  const tennisReady = state.tennisProfileReady !== false;
  const { refreshProfile } = useSession();
  const me = state.students[0];
  const initial = useMemo(() => formOf(me), [me.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  const age = f.age ? Number(f.age) : null;
  const ageValid = age == null || (Number.isInteger(age) && age >= 1 && age < 120);
  const since = parseStartYear(f.playingSince);
  const sinceValid = !Number.isNaN(since);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const canSave = Boolean(f.name.trim()) && ageValid && sinceValid && dirty;

  const save = async () => {
    setBusy(true);
    const name = f.name.trim();
    const bio = f.bio.trim();
    const res = await run(async () => {
      if (name !== me.name) await api.account.saveDisplayName(ownerId, name);
      if (bio !== (me.bio || '') || f.area !== (me.area || '')) await api.account.saveAbout(ownerId, { bio, area: f.area });
      if ((me.age ?? null) !== age) await api.player.saveAge(ownerId, age);
      const tennis = { playsHand: f.playsHand, favouriteShot: f.favouriteShot, playingSince: since, tennisStory: f.tennisStory.trim() };
      if (tennisReady && tennisOf(tennis) !== tennisOf(me)) await api.player.saveTennis(ownerId, tennis);
    }, 'Profiili tallennettu.', { waitForRefresh: true }); // reopening the form must start from the saved values
    setBusy(false);
    if (res.ok) refreshProfile?.();
    return res.ok;
  };

  return (
    <ProfileEditPage person={me} uid={ownerId} back="/pelaaja/profiili" dirty={dirty} canSave={canSave} missing={!f.name.trim() ? 'Kirjoita nimesi.' : !ageValid ? 'Tarkista ikä (1–119).' : !sinceValid ? 'Tarkista vuosi, jolloin aloitit tenniksen.' : null} busy={busy} onSave={save}
      photoText="Kasvokuva auttaa valmentajaa ja ryhmäkavereita tunnistamaan sinut.">
      <EditCard title="Perustiedot" icon="user">
        <Field label="Nimi" htmlFor="pe-name" error={!f.name.trim() ? 'Kirjoita nimesi.' : null}>
          <Input id="pe-name" value={f.name} onChange={set('name')} maxLength={120} autoComplete="name" />
        </Field>
        <Field label="Ikä" optional htmlFor="pe-age" error={!ageValid ? 'Iän pitää olla 1–119 vuotta.' : null} hint="Ikää ei tarvitse ilmoittaa.">
          <Input id="pe-age" inputMode="numeric" value={f.age} onChange={(e) => set('age')(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} />
        </Field>
      </EditCard>
      {tennisReady && (
        <EditCard title="Tennis" icon="racket">
          <Field label="Pelikäsi" optional>
            <ChipSelect ariaLabel="Pelikäsi" options={PLAYS_HAND} value={f.playsHand} onChange={set('playsHand')} allowEmpty size="sm" />
          </Field>
          <Field label="Lempilyönti" optional>
            <ChipSelect ariaLabel="Lempilyönti" options={FAVOURITE_SHOTS} value={f.favouriteShot} onChange={set('favouriteShot')} allowEmpty size="sm" />
          </Field>
          <Field label="Pelannut vuodesta" optional htmlFor="pe-since" error={!sinceValid && f.playingSince.length === 4 ? `Kirjoita vuosi ${1930}–${new Date().getFullYear()}.` : null}>
            <Input id="pe-since" inputMode="numeric" value={f.playingSince} placeholder="esim. 2015" className="profile-edit-year"
              onChange={(e) => set('playingSince')(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} />
          </Field>
          <Field label="Tennistaustasi" optional htmlFor="pe-story" hint={HEALTH_NOTE}>
            <Textarea id="pe-story" rows={3} value={f.tennisStory} onChange={set('tennisStory')} maxLength={TENNIS_STORY_MAX}
              placeholder="Esim. pelasin junnuna seurassa, sitten pitkä tauko — palasin kentille 2023." />
            <Counter value={f.tennisStory} max={TENNIS_STORY_MAX} />
          </Field>
        </EditCard>
      )}
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
