// ExercisesScreen — the coach's drill bank (reachable from Profiili and the side nav; it is a
// tool, not something a coach opens every week). List with filters, detail with video, and
// "Anna kotiläksyksi": the Kotiläksy sheet opens with the drill written in, players to pick.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Link, navigate } from '../app/router.js';
import { Button, ChipSelect, EmptyState, Field, Icon, IconButton, Input, Page, Segmented, Sheet, Textarea, TopBar, useConfirm, useToast } from '../ui/index.js';
import { Quiet } from '../shared/bits.jsx';
import { VideoPlayerSheet, VideoShareSheet } from '../shared/videos.jsx';
import { KOUTSI_TAGS, KOUTSI_TAG_LABELS } from '../domain/core.js';
import { exerciseFacts, exerciseHomeworkText } from '../domain/exercises.js';
import { useCoach } from './CoachRoot.jsx';
import { useRecord } from './merkitse.jsx';
import { exercisePath } from './nav.js';

const COUNTS = [{ value: 'all', label: 'Kaikki' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4+' }];

function ExerciseForm({ open, onClose, editing }) {
  const { run } = useData();
  const { coachId } = useCoach();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF(open ? { name: editing?.name || '', goal: editing?.goal || '', players: editing?.players || '', playerCount: editing?.playerCount || 1, duration: editing?.duration || '', level: editing?.level || '', tags: editing?.tags || [] } : null);
  }, [open, editing]);
  if (!f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const ready = f.name.trim() && !busy;
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    const fields = { ...f, name: f.name.trim(), playerCount: Number(f.playerCount) || 1 };
    const res = editing ? await run(() => api.exercises.update(editing.id, fields), 'Harjoite päivitetty.') : await run(() => api.exercises.add(coachId, fields), 'Harjoite lisätty.');
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={editing ? 'Muokkaa harjoitetta' : 'Uusi harjoite'} size="md"
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose}>Peruuta</Button><Button variant="dark" size="lg" disabled={!ready} loading={busy} onClick={save}>Tallenna</Button></div>}>
      <div className="stack-4">
        <Field label="Nimi" htmlFor="ex-name"><Input id="ex-name" value={f.name} onChange={set('name')} placeholder="Esim. Kakkossyöttö + suunta" maxLength={120} /></Field>
        <Field label="Tavoite ja ohje" htmlFor="ex-goal"><Textarea id="ex-goal" rows={3} value={f.goal} onChange={set('goal')} placeholder="Mitä harjoitteella treenataan ja miten se tehdään?" /></Field>
        <div className="k-two">
          <Field label="Pelaajia" htmlFor="ex-pl"><Input id="ex-pl" value={f.players} onChange={set('players')} placeholder="2" /></Field>
          <Field label="Kesto" htmlFor="ex-du"><Input id="ex-du" value={f.duration} onChange={set('duration')} placeholder="15 min" /></Field>
        </div>
        <Field label="Pelaajamäärä (suodatinta varten)"><ChipSelect size="sm" options={COUNTS.slice(1)} value={String(f.playerCount >= 4 ? 4 : f.playerCount)} onChange={(v) => v && set('playerCount')(Number(v))} ariaLabel="Pelaajamäärä" /></Field>
        <Field label="Taso" optional htmlFor="ex-lv"><Input id="ex-lv" value={f.level} onChange={set('level')} placeholder="Esim. Kaikki tasot" /></Field>
        <Field label="Aiheet"><ChipSelect multiple size="sm" options={KOUTSI_TAGS.map((t) => ({ value: t, label: KOUTSI_TAG_LABELS[t] }))} value={f.tags} onChange={set('tags')} ariaLabel="Aiheet" /></Field>
      </div>
    </Sheet>
  );
}

export function ExercisesScreen() {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const [count, setCount] = useState('all');
  const [tag, setTag] = useState('');
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const list = useMemo(() => state.exercises.filter((e) => (count === 'all' || (count === '4' ? e.playerCount >= 4 : String(e.playerCount) === count))
    && (!tag || (e.tags || []).includes(tag))
    && (!query.trim() || `${e.name} ${e.goal}`.toLocaleLowerCase('fi').includes(query.trim().toLocaleLowerCase('fi'))))
    .sort((a, b) => a.name.localeCompare(b.name, 'fi')), [state.exercises, count, tag, query]);
  const toast = useToast();
  const restore = async () => {
    const r = await run(() => api.exercises.seedStarters(coachId));
    if (r.ok) toast(r.result > 0 ? `${r.result} esimerkkiharjoitetta palautettu.` : 'Kaikki esimerkkiharjoitteet ovat jo pankissasi.', { tone: r.result > 0 ? 'success' : 'info' });
  };
  return (
    <>
      <TopBar title="Harjoitepankki" back="/valmentaja/profiili" actions={<IconButton icon="plus" label="Uusi harjoite" onClick={() => setFormOpen(true)} />} />
      <Page className="stack-4 k-page-pad">
        {state.exercises.length > 0 && <p className="k-faint">{state.exercises.length} harjoitetta · pelaajasi näkevät pankin omassa sovelluksessaan</p>}
        {state.exercises.length === 0 ? (
          <EmptyState art="racket" title="Harjoitepankki on tyhjä" text="Lisää omia harjoitteita tai palauta valmiit esimerkkiharjoitteet."
            action={<><Button variant="dark" icon="plus" onClick={() => setFormOpen(true)}>Uusi harjoite</Button><Button variant="outline" icon="refresh" onClick={restore}>Palauta esimerkit</Button></>} />
        ) : (
          <>
            <Input icon="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hae harjoitetta" aria-label="Hae harjoitetta" />
            <Segmented ariaLabel="Pelaajamäärä" size="sm" value={count} onChange={setCount} options={COUNTS} />
            <ChipSelect layout="scroll" size="sm" allowEmpty options={KOUTSI_TAGS.map((t) => ({ value: t, label: KOUTSI_TAG_LABELS[t] }))} value={tag} onChange={setTag} ariaLabel="Aihe" />
            {list.length === 0 ? <Quiet>Ei osumia näillä suodattimilla.</Quiet> : (
              <div className="k-list stagger">
                {list.map((e, i) => (
                  <Link key={e.id} to={exercisePath(e.id)} className="k-row" style={{ '--i': i }}>
                    <span className="k-ex-icon">{e.video ? <Icon name="play" size={16} /> : <Icon name="racket" size={16} />}</span>
                    <span className="k-row-main">
                      <span className="k-row-title truncate">{e.name}</span>
                      <span className="k-row-sub truncate">{exerciseFacts(e)}</span>
                    </span>
                    <Icon name="chevron-right" size={18} className="k-chevron" />
                  </Link>
                ))}
              </div>
            )}
            <Button variant="ghost" icon="refresh" onClick={restore}>Palauta poistetut esimerkkiharjoitteet</Button>
          </>
        )}
      </Page>
      <ExerciseForm open={formOpen} onClose={() => setFormOpen(false)} />
    </>
  );
}

export function ExerciseScreen({ params }) {
  const { state, run, reload } = useData();
  const { coachId } = useCoach();
  const confirm = useConfirm();
  const [editOpen, setEditOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [playing, setPlaying] = useState(null);
  const record = useRecord();
  const ex = state.exercises.find((e) => e.id === params.id);
  if (!ex) return (<><TopBar title="Harjoite" back="/valmentaja/harjoitteet" /><Page><EmptyState art="search" title="Harjoitetta ei löytynyt" /></Page></>);
  const remove = async () => {
    if (!(await confirm({ title: 'Poista harjoite?', message: ex.name, confirmLabel: 'Poista', danger: true }))) return;
    const res = await run(() => api.exercises.remove(ex.id), 'Harjoite poistettu.');
    if (res.ok) navigate('/valmentaja/harjoitteet', { replace: true });
  };
  const removeVideo = async () => {
    if (!(await confirm({ title: 'Poista harjoitevideo?', message: ex.video?.title || ex.name, confirmLabel: 'Poista', danger: true }))) return;
    await run(() => api.exercises.removeVideo(ex.id), 'Harjoitevideo poistettu.');
  };
  const saveVideo = async ({ title, file, externalUrl, onProgress }) => {
    await api.exercises.setVideo({ exerciseId: ex.id, coachId, title, file, externalUrl, onProgress });
    await reload().catch(() => {});
  };
  return (
    <>
      <TopBar title={ex.name} back="/valmentaja/harjoitteet" actions={<><IconButton icon="edit" label="Muokkaa" onClick={() => setEditOpen(true)} /><IconButton icon="trash" label="Poista" onClick={remove} /></>} />
      <Page className="stack-5 k-page-pad">
        <h1 className="t-title">{ex.name}</h1>
        <div className="row wrap">
          {ex.players && <span className="chip chip-md chip-neutral"><Icon name="users" size={14} />{ex.players}</span>}
          {ex.duration && <span className="chip chip-md chip-neutral"><Icon name="clock" size={14} />{ex.duration}</span>}
          {ex.level && <span className="chip chip-md chip-neutral">{ex.level}</span>}
          {(ex.tags || []).map((t) => <span key={t} className="chip chip-md chip-lime">{KOUTSI_TAG_LABELS[t] || t}</span>)}
        </div>
        {ex.goal && <p className="k-body-text">{ex.goal}</p>}
        <Button variant="lime" icon="check-circle" className="k-ex-homework" onClick={() => record.open('homework', { source: 'harjoite', text: exerciseHomeworkText(ex) })}>Anna kotiläksyksi</Button>
        <div className="stack-2">
          <div className="field-label">Video</div>
          {ex.video ? (
            <div className="row wrap">
              <Button variant="dark" icon="play" onClick={() => setPlaying(ex.video)}>{ex.video.title || 'Katso video'}</Button>
              <Button variant="outline" size="sm" onClick={() => setVideoOpen(true)}>Vaihda</Button>
              <Button variant="ghost" size="sm" onClick={removeVideo}>Poista</Button>
            </div>
          ) : <Button variant="outline" icon="plus" onClick={() => setVideoOpen(true)}>Lisää video</Button>}
          <p className="field-msg">Harjoitevideo näkyy myös pelaajillesi heidän harjoitepankissaan.</p>
        </div>
      </Page>
      <ExerciseForm open={editOpen} editing={ex} onClose={() => setEditOpen(false)} />
      <VideoShareSheet open={videoOpen} onClose={() => setVideoOpen(false)} title={ex.video ? 'Vaihda harjoitevideo' : 'Lisää harjoitevideo'} onSave={saveVideo} />
      <VideoPlayerSheet video={playing} onClose={() => setPlaying(null)} />
    </>
  );
}
