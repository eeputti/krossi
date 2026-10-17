// ProfileScreen (coach) — who the coach is, notifications, tools that aren't weekly work
// (drill bank, bulk setup, annual plans, Ylläpito), and account settings.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { useSession } from '../app/session.jsx';
import { Avatar, Button, Card, Field, Icon, IconButton, Input, ListRow, Page, PageHeader, Sheet, Textarea, useToast } from '../ui/index.js';
import { AccountSection, EmailPrefToggle } from '../shared/account.jsx';
import { useCoach } from './CoachRoot.jsx';
import { BulkSetupSheet } from './BulkSetupSheet.jsx';
import { bankSummary } from './ExercisesScreen.jsx';

function ProfileEditSheet({ open, onClose }) {
  const { state, run } = useData();
  const { coachId, uid } = useCoach();
  const { refreshProfile } = useSession();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF({ name: state.coach.name || '', tagline: state.coach.tagline || '', bio: state.coach.bio || '', experience: state.coach.experience || '', specialties: (state.coach.specialties || []).join(', ') });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.name.trim() || busy) return;
    setBusy(true);
    const res = await run(async () => {
      if (f.name.trim() !== state.coach.name) await api.account.saveDisplayName(uid, f.name.trim());
      await api.coach.saveProfile(coachId, {
        tagline: f.tagline.trim(), bio: f.bio.trim(), experience: f.experience.trim(),
        specialties: f.specialties.split(',').map((s) => s.trim()).filter(Boolean),
      });
    }, 'Profiili päivitetty.');
    setBusy(false);
    if (res.ok) { refreshProfile(); onClose(); }
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Muokkaa profiilia" size="md"
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose}>Peruuta</Button><Button variant="dark" size="lg" disabled={!f.name.trim()} loading={busy} onClick={save}>Tallenna</Button></div>}>
      <div className="stack-4">
        <Field label="Nimi" htmlFor="cp-name"><Input id="cp-name" value={f.name} onChange={set('name')} maxLength={120} /></Field>
        <Field label="Esittely" optional htmlFor="cp-tag" hint="Esim. Tennisvalmentaja · Lahti"><Input id="cp-tag" value={f.tagline} onChange={set('tagline')} maxLength={120} /></Field>
        <Field label="Kuvaus" optional htmlFor="cp-bio"><Textarea id="cp-bio" rows={3} value={f.bio} onChange={set('bio')} /></Field>
        <Field label="Kokemus" optional htmlFor="cp-exp"><Input id="cp-exp" value={f.experience} onChange={set('experience')} /></Field>
        <Field label="Erikoisalat" optional htmlFor="cp-spec" hint="Erota pilkulla."><Input id="cp-spec" value={f.specialties} onChange={set('specialties')} /></Field>
      </div>
    </Sheet>
  );
}

function SharedPlanSheet({ open, onClose }) {
  const { coachId } = useCoach();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState([]);
  const ref = useRef(null);
  useEffect(() => { if (open) api.plans.submissions(coachId).then(setList).catch(() => setList([])); }, [open, coachId]);
  const upload = async (file) => {
    setBusy(true);
    try {
      await api.plans.uploadShared(coachId, file);
      toast('Vuosisuunnitelma lähetetty — viemme teemat Koutsiin ja ilmoitamme, kun ne ovat valmiina.');
      setList(await api.plans.submissions(coachId));
    } catch (err) { toast(err); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Lähetä vuosisuunnitelma" subtitle="Jos sinulla on usean ryhmän viikkoteemat Excelissä, lähetä se meille — viemme teemat Koutsiin puolestasi." size="md">
      <div className="stack-4">
        <Button variant="dark" icon="download" loading={busy} onClick={() => ref.current?.click()}>Valitse Excel (.xlsx)</Button>
        <input ref={ref} type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
        {list.length > 0 && (
          <div className="stack-2">
            <div className="field-label">Lähetetyt</div>
            {list.map((s) => (
              <div key={s.id} className="k-file-row"><Icon name="list" size={16} /><span className="grow truncate">{s.filename}</span><span className="chip chip-sm chip-neutral">{s.status === 'pending' ? 'Käsittelyssä' : 'Käsitelty'}</span></div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

export function ProfileScreen() {
  const { state, reload } = useData();
  const { uid, isAdmin } = useCoach();
  const toast = useToast();
  const [sheet, setSheet] = useState(null);
  const fileRef = useRef(null);
  const c = state.coach;
  const changePhoto = async (file) => {
    try { await api.account.uploadAvatar(uid, file); await reload(); toast('Profiilikuva vaihdettu.'); } catch (err) { toast(err); }
  };
  return (
    <Page>
      <PageHeader title="Profiili" />
      <div className="stack-6">
        <Card className="k-profile-card">
          <button type="button" className="k-avatar-edit" onClick={() => fileRef.current?.click()} aria-label="Vaihda profiilikuva">
            <Avatar person={c} size={72} ring />
            <span className="k-avatar-edit-badge"><Icon name="camera" size={14} /></span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) changePhoto(f); }} />
          <div className="grow">
            <h2 className="t-h2">{c.name}</h2>
            <p className="k-faint">{c.tagline || 'Valmentaja'}</p>
            <p className="k-faint">{state.students.length} pelaajaa · {state.groups.length} ryhmää</p>
          </div>
          <IconButton icon="edit" label="Muokkaa profiilia" onClick={() => setSheet('edit')} />
        </Card>
        {(c.bio || c.experience || (c.specialties || []).length > 0) && (
          <Card className="stack-2">
            {c.bio && <p className="k-body-text">{c.bio}</p>}
            {c.experience && <p className="k-faint">{c.experience}</p>}
            {(c.specialties || []).length > 0 && <div className="row wrap">{c.specialties.map((s) => <span key={s} className="chip chip-sm chip-neutral">{s}</span>)}</div>}
          </Card>
        )}
        <section className="stack-2">
          <div className="eyebrow">Ilmoitukset</div>
          <Card><EmailPrefToggle uid={uid} /></Card>
        </section>
        <section className="stack-2">
          <div className="eyebrow">Työkalut</div>
          <div className="list-group">
            <ListRow icon="book" title="Harjoitepankki" subtitle={bankSummary(state.exercises.length)} onClick={() => navigate('/valmentaja/harjoitteet')} />
            <ListRow icon="list" title="Lisää monta kerralla" subtitle="Ryhmät ja pelaajat listasta" onClick={() => setSheet('bulk')} />
            <ListRow icon="calendar" title="Lähetä vuosisuunnitelma" subtitle="Usean ryhmän teemat Excelistä" onClick={() => setSheet('plan')} />
            {isAdmin && <ListRow icon="shield" title="Ylläpito" subtitle="Käyttäjät, palaute, vuosisuunnitelmat" onClick={() => navigate('/valmentaja/yllapito')} />}
          </div>
        </section>
        <AccountSection role="coach" uid={uid} profileName={c.name} />
      </div>
      <ProfileEditSheet open={sheet === 'edit'} onClose={() => setSheet(null)} />
      <BulkSetupSheet open={sheet === 'bulk'} onClose={() => setSheet(null)} />
      <SharedPlanSheet open={sheet === 'plan'} onClose={() => setSheet(null)} />
    </Page>
  );
}
