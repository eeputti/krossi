// ProfileScreen (player) — own details, own note to the coach, notifications, account.
import { useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Avatar, Card, Icon, IconButton, Page, PageHeader, useToast } from '../ui/index.js';
import { AccountSection, EmailPrefToggle } from '../shared/account.jsx';
import { koutsiGroupsForStudent } from '../domain/core.js';
import { PlayerProfileSheet } from './sheets.jsx';
import { usePlayerActions } from './PlayerApp.jsx';

export function ProfileScreen() {
  const { state, ownerId, reload } = useData();
  const actions = usePlayerActions();
  const toast = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const fileRef = useRef(null);
  const me = state.students[0];
  const groups = koutsiGroupsForStudent(state, me.id);
  const changePhoto = async (file) => {
    try { await api.account.uploadAvatar(ownerId, file); await reload(); toast('Profiilikuva vaihdettu.'); } catch (err) { toast(err); }
  };
  return (
    <Page>
      <PageHeader title="Profiili" />
      <div className="stack-6">
        <Card className="k-profile-card">
          <button type="button" className="k-avatar-edit" onClick={() => fileRef.current?.click()} aria-label="Vaihda profiilikuva">
            <Avatar person={me} size={72} ring />
            <span className="k-avatar-edit-badge"><Icon name="camera" size={14} /></span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) changePhoto(f); }} />
          <div className="grow">
            <h2 className="t-h2">{me.name}</h2>
            <p className="k-faint">{[me.ageLabel, me.level].filter(Boolean).join(' · ') || 'Pelaaja'}</p>
            {groups.length > 0 && <p className="k-faint">{groups.map((g) => `${g.day} ${g.time} ${g.name}`).join(' · ')}</p>}
          </div>
          <IconButton icon="edit" label="Muokkaa tietoja" onClick={() => setEditOpen(true)} />
        </Card>
        <Card interactive onClick={() => actions.openText('note')} className="goal-card">
          <div className="eyebrow"><Icon name="edit" size={13} /> Oma muistiinpano</div>
          {me.playerNote ? <p className="goal-text">{me.playerNote}</p> : <p className="k-faint">Kirjoita muistiinpano itsellesi ja valmentajalle — esim. mitä haluat muistaa seuraavasta treenistä.</p>}
        </Card>
        <section className="stack-2">
          <div className="eyebrow">Ilmoitukset</div>
          <Card><EmailPrefToggle uid={ownerId} /></Card>
        </section>
        <AccountSection role="player" uid={ownerId} profileName={me.name} />
      </div>
      <PlayerProfileSheet open={editOpen} student={me} onClose={() => setEditOpen(false)} />
    </Page>
  );
}
