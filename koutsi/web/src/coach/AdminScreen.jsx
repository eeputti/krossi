// AdminScreen — Ylläpito: users (open a coach's view, turn a name list into invite links,
// delete an account), pilot feedback, annual plans waiting for review, and what the renewed
// app's quick actions are used for (Käyttö). Every RPC behind this re-checks koutsi_is_admin()
// on the server.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { Button, Card, Chip, EmptyState, ErrorState, Field, Icon, Input, Page, Segmented, Select, Sheet, SkeletonList, StatTile, Textarea, TopBar, useConfirm, useToast } from '../ui/index.js';
import { CopyButton } from '../shared/bits.jsx';
import { koutsiParseNameList } from '../domain/core.js';
import { koutsiFmtEventDate } from '../domain/timeline.js';
import { useCoach } from './CoachRoot.jsx';
import { MerkitseUsage } from './MerkitseUsage.jsx';
import { AdminUsage } from './AdminUsage.jsx';

const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} Mt` : b >= 1024 ? `${Math.round(b / 1024)} kt` : `${b} t`);
const fmtWhen = (iso) => (iso ? koutsiFmtEventDate(iso) : 'ei koskaan');

function useLoad(fn) {
  const [s, setS] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    setS((x) => ({ ...x, loading: true, error: null }));
    try { setS({ data: await fn(), error: null, loading: false }); } catch (error) { setS({ data: null, error, loading: false }); }
  }, [fn]);
  useEffect(() => { load(); }, [load]);
  return { ...s, reload: load };
}

function ImportSheet({ coach, onClose }) {
  const toast = useToast();
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => {
    setGroups([]); setGroupId(''); setText(''); setResult(null);
    if (coach) api.admin.groups(coach.id).then(setGroups).catch(() => setGroups([]));
  }, [coach]);
  const names = koutsiParseNameList(text);
  const run = async () => {
    if (!names.length || busy) return;
    setBusy(true);
    try { setResult(await api.admin.bulkInviteCodes(coach.id, names, groupId || null)); } catch (err) { toast(err); } finally { setBusy(false); }
  };
  const allText = (result || []).map((r) => `${r.label}: ${r.link}`).join('\n');
  return (
    <Sheet open={Boolean(coach)} onClose={onClose} title="Tuo pelaajalista" subtitle={coach ? `Valmentaja ${coach.name} — jokainen nimi saa oman koodin ja linkin.` : ''} size="lg">
      {result ? (
        <div className="stack-3">
          <CopyButton variant="dark" text={allText} label="Kopioi kaikki linkit" />
          <div className="k-list">
            {result.map((r) => (
              <div key={r.code} className="k-code-row"><span className="grow truncate">{r.label}</span><span className="k-code-small">{r.code}</span><CopyButton text={r.link} label="Linkki" /></div>
            ))}
          </div>
        </div>
      ) : (
        <div className="stack-4">
          <Field label="Ryhmä" optional>
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="Ei ryhmää" options={groups.map((g) => ({ value: g.id, label: `${g.name} (${g.memberCount})` }))} />
          </Field>
          <Field label="Nimet" hint="Yksi per rivi tai Excelin ensimmäinen sarake.">
            <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Button variant="dark" loading={busy} disabled={!names.length} onClick={run}>Luo {names.length} kutsulinkkiä</Button>
        </div>
      )}
    </Sheet>
  );
}

function UserCard({ user, onActAs, onImport, onDelete }) {
  const [opening, setOpening] = useState(false);
  const toast = useToast();
  const open = async () => {
    setOpening(true);
    try { await onActAs(user.id); } catch (err) { toast(err); setOpening(false); }
  };
  return (
    <Card className="admin-user">
      <div className="row-between wrap">
        <div className="grow">
          <div className="k-row-title">{user.name}</div>
          <div className="k-faint admin-mail">{user.email || 'Ei sähköpostia'}</div>
          <div className="row wrap admin-roles">
            {user.isAdmin && <Chip tone="clay" size="sm">Ylläpitäjä</Chip>}
            {user.isCoach && <Chip tone="green" size="sm">Valmentaja</Chip>}
            {user.isPlayer && <Chip tone="neutral" size="sm">Pelaaja</Chip>}
          </div>
        </div>
        <div className="admin-stats">
          <span><strong className="t-num">{user.appOpenCount}×</strong> avattu, {fmtWhen(user.lastAppOpenAt)}</span>
          {user.isCoach && <span><strong className="t-num">{user.studentCount}</strong> pelaajaa{user.pendingStudents.length ? ` (${user.pendingStudents.length} ei tiliä)` : ''}, <strong className="t-num">{user.groupCount}</strong> ryhmää, <strong className="t-num">{user.trainingCount}</strong> treeniä</span>}
          <span className="k-faint">Kirjautunut {fmtWhen(user.lastSignInAt)}, {fmtBytes(user.storageBytes)}</span>
        </div>
      </div>
      {user.pendingPlans > 0 && <p className="k-warn-text">{user.pendingPlans} vuosisuunnitelmaa odottaa käsittelyä</p>}
      <div className="row wrap">
        {user.isCoach && <Button variant="dark" size="sm" icon="eye" loading={opening} onClick={open}>Avaa näkymä</Button>}
        {user.isCoach && <Button variant="outline" size="sm" icon="list" onClick={() => onImport(user)}>Tuo pelaajalista</Button>}
        {!user.isAdmin && <Button variant="ghost" size="sm" icon="trash" onClick={() => onDelete(user)}>Poista tili</Button>}
      </div>
    </Card>
  );
}

function Users() {
  const { actAs } = useCoach();
  const toast = useToast();
  const confirm = useConfirm();
  const fetchUsers = useCallback(() => api.admin.users(), []);
  const { data, error, loading, reload } = useLoad(fetchUsers);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [importFor, setImportFor] = useState(null);
  const list = useMemo(() => (data || []).filter((u) => (role === 'all' || (role === 'coach' ? u.isCoach : u.isPlayer))
    && (!q.trim() || `${u.name} ${u.email}`.toLocaleLowerCase('fi').includes(q.trim().toLocaleLowerCase('fi'))))
    .sort((a, b) => String(b.lastAppOpenAt || b.lastSignInAt || '').localeCompare(String(a.lastAppOpenAt || a.lastSignInAt || ''))), [data, q, role]);
  const remove = async (user) => {
    const ok = await confirm({
      title: `Poista käyttäjä ${user.name}?`,
      message: `Poistaa pysyvästi koko tilin (${user.email || 'ei sähköpostia'}), profiilin, Koutsi-tiedot ja ${fmtBytes(user.storageBytes)} tiedostoja. Sama tili on myös Krossin tili. Toimintoa ei voi perua.`,
      confirmLabel: 'Poista lopullisesti', danger: true, typeToConfirm: user.email || user.name,
    });
    if (!ok) return;
    try { await api.admin.deleteUser(user.id); toast(`${user.name} poistettiin.`); reload(); } catch (err) { toast(err); }
  };
  if (loading && !data) return <SkeletonList count={4} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const coaches = data.filter((u) => u.isCoach).length;
  const players = data.filter((u) => u.isPlayer).length;
  const week = data.filter((u) => u.lastAppOpenAt && Date.now() - new Date(u.lastAppOpenAt).getTime() < 7 * 86400000).length;
  return (
    <div className="stack-4">
      <div className="k-stats">
        <StatTile label="Käyttäjiä" value={data.length} />
        <StatTile label="Valmentajia" value={coaches} />
        <StatTile label="Pelaajia" value={players} />
        <StatTile label="Aktiivisia 7 pv" value={week} tone="lime" />
      </div>
      <Input icon="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hae nimellä tai sähköpostilla" aria-label="Hae käyttäjää" />
      <Segmented ariaLabel="Rooli" size="sm" value={role} onChange={setRole} options={[{ value: 'all', label: 'Kaikki' }, { value: 'coach', label: 'Valmentajat' }, { value: 'player', label: 'Pelaajat' }]} />
      <div className="stack-3">{list.map((u) => <UserCard key={u.id} user={u} onActAs={actAs} onImport={setImportFor} onDelete={remove} />)}</div>
      <ImportSheet coach={importFor} onClose={() => setImportFor(null)} />
    </div>
  );
}

function Feedback() {
  const toast = useToast();
  const confirm = useConfirm();
  const fetchFeedback = useCallback(() => api.admin.feedback(), []);
  const { data, error, loading, reload } = useLoad(fetchFeedback);
  if (loading && !data) return <SkeletonList count={3} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data.length) return <EmptyState compact art="mail" title="Ei palautetta" />;
  const remove = async (f) => {
    if (!(await confirm({ title: 'Poista palaute?', message: f.message.slice(0, 140), confirmLabel: 'Poista', danger: true }))) return;
    try { await api.admin.deleteFeedback(f.id); reload(); } catch (err) { toast(err); }
  };
  return (
    <div className="stack-3">
      {data.map((f) => (
        <Card key={f.id} className="stack-2">
          <div className="row-between">
            <span className="k-row-title">{f.senderName}<span className="k-faint">, {f.isCoach ? 'valmentaja' : f.isPlayer ? 'pelaaja' : 'käyttäjä'}, {fmtWhen(f.createdAt)}</span></span>
            <Button variant="ghost" size="sm" icon="trash" onClick={() => remove(f)}>Poista</Button>
          </div>
          <span className="chip chip-sm chip-neutral">{f.category}</span>
          <p className="k-body-text">{f.message}</p>
          {f.email && <a className="k-textlink" href={`mailto:${f.email}`}>{f.email}</a>}
        </Card>
      ))}
    </div>
  );
}

function Plans() {
  const toast = useToast();
  const fetchPlans = useCallback(async () => ({ pending: await api.admin.pendingPlans(), shared: await api.plans.submissions(null, true) }), []);
  const { data, error, loading, reload } = useLoad(fetchPlans);
  if (loading && !data) return <SkeletonList count={3} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const open = async (path) => {
    const tab = window.open('', '_blank'); // in the tap: iPhone blocks a window opened after an await
    try { const url = await api.plans.url(path); if (url && tab) tab.location.href = url; else tab?.close(); } catch (err) { tab?.close(); toast(err); }
  };
  const publish = async (p) => { try { await api.admin.publishPlan(p.groupId); toast('Merkitty käyttöön.'); reload(); } catch (err) { toast(err); } };
  const handled = async (s) => { try { await api.admin.handleSubmission(s.id); toast('Merkitty käsitellyksi.'); reload(); } catch (err) { toast(err); } };
  if (!data.pending.length && !data.shared.length) return <EmptyState compact art="calendar" title="Ei odottavia vuosisuunnitelmia" />;
  return (
    <div className="stack-3">
      {data.pending.map((p) => (
        <Card key={p.groupId} className="stack-2">
          <div className="k-row-title">{p.groupName}<span className="k-faint">, {p.coachName}</span></div>
          <div className="k-faint">{p.filename}, {fmtWhen(p.uploadedAt)}</div>
          <div className="row wrap"><Button variant="outline" size="sm" icon="external" onClick={() => open(p.storagePath)}>Avaa</Button><Button variant="dark" size="sm" onClick={() => publish(p)}>Merkitse käyttöön</Button></div>
        </Card>
      ))}
      {data.shared.map((s) => (
        <Card key={s.id} className="stack-2">
          <div className="k-row-title">Yhteinen Excel<span className="k-faint">, {fmtWhen(s.uploadedAt)}</span></div>
          <div className="k-faint">{s.filename}, {fmtBytes(s.sizeBytes)}</div>
          <div className="row wrap"><Button variant="outline" size="sm" icon="external" onClick={() => open(s.storagePath)}>Avaa</Button><Button variant="dark" size="sm" onClick={() => handled(s)}>Merkitse käsitellyksi</Button></div>
        </Card>
      ))}
    </div>
  );
}

export function AdminScreen() {
  const { isAdmin } = useCoach();
  const [tab, setTab] = useState('users');
  if (!isAdmin) return null;
  return (
    <>
      <TopBar title="Ylläpito" back="/valmentaja/profiili" />
      <Page width="wide" className="stack-4 k-page-pad">
        <p className="k-faint">Pilotin käyttäjät, palaute, vuosisuunnitelmat ja käyttö</p>
        <Segmented ariaLabel="Ylläpito" value={tab} onChange={setTab} options={[{ value: 'users', label: 'Käyttäjät' }, { value: 'feedback', label: 'Palaute' }, { value: 'plans', label: 'Suunnitelmat' }, { value: 'usage', label: 'Käyttö' }]} />
        {tab === 'users' && <Users />}
        {tab === 'feedback' && <Feedback />}
        {tab === 'plans' && <Plans />}
        {tab === 'usage' && (
          <div className="stack-6">
            <AdminUsage />
            <MerkitseUsage />
          </div>
        )}
        <p className="k-fine"><Icon name="info" size={14} /> Vuosisuunnitelman lisääminen ryhmälle ylläpitäjänä onnistuu vielä vanhassa Koutsissa (Ylläpito → Vuosisuunnitelmat).</p>
      </Page>
    </>
  );
}
