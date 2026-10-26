// ExercisesScreen — the coach's drill bank: Krossi's built-in library (domain/drills) and the
// coach's own drills (koutsi_exercises) in one list. A library drill opens read-only and can be
// saved to the coach's own bank, which makes it an ordinary row (videos, edits, the old app).
// Any drill can be given as homework: "Anna kotiläksyksi" opens the Kotiläksy sheet with the
// drill written in, players still to pick.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Button, ChipSelect, EmptyState, Field, Icon, IconButton, Input, Page, Sheet, Stepper, Textarea, TopBar, useConfirm, useToast } from '../ui/index.js';
import { VideoPlayerSheet, VideoShareSheet } from '../shared/videos.jsx';
import { KOUTSI_TAGS, KOUTSI_TAG_LABELS } from '../domain/core.js';
import { LEVELS, buildDrillList, levelLabel, playersLabel, savedFields } from '../domain/drills/index.js';
import { DrillBrowser } from '../shared/drills/browser.jsx';
import { DrillDetail, DrillDetailSkeleton } from '../shared/drills/detail.jsx';
import { DRILL_COUNT, useDrillLibrary } from '../shared/drills/useLibrary.js';
import { exerciseHomeworkText } from '../domain/exercises.js';
import { useCoach } from './CoachRoot.jsx';
import { useRecord } from './merkitse.jsx';
import { track } from './usage.js';
import { exercisePath } from './nav.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function ExerciseForm({ open, onClose, editing }) {
  const { run } = useData();
  const { coachId } = useCoach();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) { setF(null); return; }
    const [min, max] = editing?.players || [2, 2];
    setF({
      name: editing?.name || '', goal: editing?.own?.goal || '', min, max: Math.min(12, max),
      minutes: editing?.minutes ? String(editing.minutes) : '', levels: editing?.levels || [], tags: editing?.tags || [],
    });
  }, [open, editing]);
  if (!f) return null;
  const set = (k) => (v) => setF((x) => {
    const next = { ...x, [k]: v?.target ? v.target.value : v };
    if (k === 'min' && next.max < next.min) next.max = next.min;
    if (k === 'max' && next.min > next.max) next.min = next.max;
    return next;
  });
  const ready = f.name.trim() && !busy;
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    const minutes = Math.round(Number(String(f.minutes).replace(',', '.')));
    const fields = {
      name: f.name.trim(), goal: f.goal.trim(), players: playersLabel([f.min, f.max]), playerCount: f.min,
      duration: minutes > 0 ? `${minutes} min` : '', level: levelLabel(f.levels), tags: f.tags,
    };
    const res = editing?.own
      ? await run(() => api.exercises.update(editing.own.id, fields), 'Harjoite päivitetty.')
      : await run(() => api.exercises.add(coachId, fields), 'Harjoite lisätty omiin harjoitteisiisi.');
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={editing ? 'Muokkaa harjoitetta' : 'Uusi oma harjoite'} size="md"
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose}>Peruuta</Button><Button variant="dark" size="lg" missing={!f.name.trim() ? 'Anna harjoitteelle nimi.' : null} loading={busy} onClick={save}>Tallenna</Button></div>}>
      <div className="stack-4">
        <Field label="Nimi" htmlFor="ex-name"><Input id="ex-name" value={f.name} onChange={set('name')} placeholder="Esim. Kakkossyöttö + suunta" maxLength={120} /></Field>
        <Field label="Tavoite ja ohje" htmlFor="ex-goal"><Textarea id="ex-goal" rows={4} value={f.goal} onChange={set('goal')} placeholder="Mitä harjoitteella treenataan ja miten se tehdään?" /></Field>
        <Field label="Pelaajia yhdellä kentällä" hint={`Näkyy listassa: ${f.max >= 12 ? `${f.min}+` : playersLabel([f.min, f.max])} ${f.min === 1 && f.max === 1 ? 'pelaaja' : 'pelaajaa'}`}>
          <div className="dl-range">
            <div className="dl-range-part"><span className="dl-range-label">Vähintään</span><Stepper value={f.min} onChange={set('min')} min={1} max={12} label="Pelaajia vähintään" size="sm" /></div>
            <span className="dl-range-dash" aria-hidden="true">–</span>
            <div className="dl-range-part"><span className="dl-range-label">Enintään</span><Stepper value={f.max} onChange={set('max')} min={1} max={12} label="Pelaajia enintään" size="sm" /></div>
          </div>
        </Field>
        <Field label="Kesto minuutteina" optional htmlFor="ex-du"><Input id="ex-du" inputMode="numeric" value={f.minutes} onChange={set('minutes')} placeholder="15" maxLength={3} /></Field>
        <Field label="Taso" hint="Jätä tyhjäksi, jos harjoite sopii kaikille tasoille.">
          <ChipSelect multiple size="sm" options={LEVELS.map((l) => ({ value: l, label: l }))} value={f.levels} onChange={set('levels')} ariaLabel="Taso" />
        </Field>
        <Field label="Aiheet"><ChipSelect multiple size="sm" options={KOUTSI_TAGS.map((t) => ({ value: t, label: KOUTSI_TAG_LABELS[t] }))} value={f.tags} onChange={set('tags')} ariaLabel="Aiheet" /></Field>
      </div>
    </Sheet>
  );
}

export function ExercisesScreen() {
  const { state } = useData();
  const [formOpen, setFormOpen] = useState(false);
  const { library, failed, retry } = useDrillLibrary();
  const items = useMemo(() => buildDrillList(state.exercises, { library: library || [] }), [state.exercises, library]);
  const own = state.exercises.length;
  return (
    <Page className="dl-page">
      <header className="dl-head">
        <div className="eyebrow">Harjoitepankki</div>
        <div className="dl-head-row">
          <h1 className="dl-title">Harjoitteet</h1>
          <button type="button" className="dl-add" aria-label="Uusi oma harjoite" title="Uusi oma harjoite" onClick={() => { track('pankki.uusi'); setFormOpen(true); }}>
            <Icon name="plus" size={24} strokeWidth={2.4} />
          </button>
        </div>
        <p className="dl-sub"><span className="t-num">{library?.length || DRILL_COUNT}</span> valmista harjoitetta Krossin kirjastossa · <span className="t-num">{own}</span> omaa. Pelaajasi näkevät molemmat.</p>
      </header>
      <DrillBrowser items={items} role="coach" groups={state.groups} track={track} loading={!library && !failed} failed={failed} onRetry={retry}
        onOpen={(it) => { track(it.own ? 'pankki.avaa-oma' : 'pankki.avaa-kirjasto'); navigate(exercisePath(it.key)); }} />
      <ExerciseForm open={formOpen} onClose={() => setFormOpen(false)} />
    </Page>
  );
}

export function ExerciseScreen({ params }) {
  const { state, run, reload } = useData();
  const { coachId } = useCoach();
  const confirm = useConfirm();
  const toast = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [playing, setPlaying] = useState(null);
  const [saving, setSaving] = useState(false);
  const record = useRecord();
  const { library, failed, retry } = useDrillLibrary();
  const items = useMemo(() => buildDrillList(state.exercises, { library: library || [] }), [state.exercises, library]);
  // A library drill's address is k-<id>; once saved it is found through its twin.
  const item = items.find((it) => it.key === params.id) || (params.id.startsWith('k-') && items.find((it) => it.lib?.id === params.id.slice(2))) || null;
  // Wait for the library before drawing (an own drill borrows its picture and steps from it),
  // unless it failed: then an own drill shows without them.
  if (!library && !failed) return (<><TopBar title="Harjoite" back="/valmentaja/harjoitteet" /><Page className="k-page-pad"><DrillDetailSkeleton /></Page></>);
  if (!item) {
    return (
      <>
        <TopBar title="Harjoite" back="/valmentaja/harjoitteet" />
        <Page>
          {failed && params.id.startsWith('k-')
            ? <EmptyState art="search" title="Krossin kirjasto ei latautunut" text="Tarkista yhteys ja yritä uudelleen." action={<Button variant="dark" icon="refresh" onClick={retry}>Yritä uudelleen</Button>} />
            : <EmptyState art="search" title="Harjoitetta ei löytynyt" />}
        </Page>
      </>
    );
  }
  const own = item.own;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const res = await run(() => api.exercises.add(coachId, savedFields(item.lib)));
    setSaving(false);
    if (res.ok) track('pankki.tallenna');
    if (res.ok) toast('Tallennettu omiin harjoitteisiisi.', { tone: 'success', icon: 'check' });
  };
  const remove = async () => {
    const twin = Boolean(item.lib);
    if (!(await confirm({
      title: twin ? 'Poista omista harjoitteista?' : 'Poista harjoite?',
      message: twin ? `${item.name} jää Krossin kirjastoon, mutta oma kopiosi${item.video ? ' ja sen video' : ''} poistuu.` : item.name,
      confirmLabel: 'Poista', danger: true,
    }))) return;
    const res = await run(() => api.exercises.remove(own.id), twin ? 'Poistettu omista harjoitteista.' : 'Harjoite poistettu.');
    // A saved library drill stays in the library, so the page stays open on its library copy.
    if (res.ok) navigate(twin ? exercisePath(`k-${item.lib.id}`) : '/valmentaja/harjoitteet', { replace: true });
  };
  const removeVideo = async () => {
    if (!(await confirm({ title: 'Poista harjoitevideo?', message: item.video?.title || item.name, confirmLabel: 'Poista', danger: true }))) return;
    await run(() => api.exercises.removeVideo(own.id), 'Harjoitevideo poistettu.');
  };
  const saveVideo = async ({ title, file, externalUrl, onProgress }) => {
    await api.exercises.setVideo({ exerciseId: own.id, coachId, title, file, externalUrl, onProgress });
    await reload().catch(() => {});
  };

  // The homework says what the coach wrote, or the library's goal (not the numbered steps a saved copy carries).
  const giveHomework = () => record.open('homework', { source: 'harjoite', text: exerciseHomeworkText({ name: item.name, goal: item.ownGoal ? own.goal : item.goal }) });
  const homework = <Button variant="lime" icon="check-circle" onClick={giveHomework}>Anna kotiläksyksi</Button>;
  const actions = own ? (
    <div className="dd-actions">
      <div className="dd-own-line"><Icon name="check-circle" size={16} />{item.lib ? 'Omissa harjoitteissasi' : 'Oma harjoitteesi'}</div>
      <div className="row wrap">
        {homework}
        {item.video
          ? <Button variant="dark" icon="play" onClick={() => setPlaying(item.video)}>{item.video.title || 'Katso video'}</Button>
          : <Button variant="outline" icon="play" onClick={() => setVideoOpen(true)}>Lisää video</Button>}
      </div>
      {item.video && (
        <div className="row wrap">
          <Button variant="outline" size="sm" onClick={() => setVideoOpen(true)}>Vaihda video</Button>
          <Button variant="ghost" size="sm" onClick={removeVideo}>Poista video</Button>
        </div>
      )}
    </div>
  ) : (
    <div className="dd-actions">
      <div className="dd-two">
        <Button variant="dark" size="lg" icon="plus" loading={saving} onClick={save}>Tallenna omiin</Button>
        <Button variant="outline" size="lg" icon="check-circle" onClick={giveHomework}>Anna kotiläksyksi</Button>
      </div>
      <p className="dd-hint">Omiin tallennettuun harjoitteeseen voit lisätä videon ja omat ohjeesi.</p>
    </div>
  );

  return (
    <>
      <TopBar title={item.name} back="/valmentaja/harjoitteet" actions={own ? <><IconButton icon="edit" label="Muokkaa" onClick={() => setEditOpen(true)} /><IconButton icon="trash" label={item.lib ? 'Poista omista' : 'Poista'} onClick={remove} /></> : null} />
      <Page className="k-page-pad">
        <DrillDetail item={item} role="coach" actions={actions} />
      </Page>
      {own && <ExerciseForm open={editOpen} editing={item} onClose={() => setEditOpen(false)} />}
      {own && <VideoShareSheet open={videoOpen} onClose={() => setVideoOpen(false)} title={item.video ? 'Vaihda harjoitevideo' : 'Lisää harjoitevideo'} onSave={saveVideo} />}
      <VideoPlayerSheet video={playing} onClose={() => setPlaying(null)} />
    </>
  );
}

/** For Profiili: "25 omaa · 196 kirjastossa". */
export const bankSummary = (ownCount) => `${plural(ownCount, 'oma', 'omaa')} · ${DRILL_COUNT} kirjastossa`;
