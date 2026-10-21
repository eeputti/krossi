// PlayerScreen — one player from the coach's side: who they are, quick notes, attendance,
// their development timeline, the coach's notes/homework/videos, and roster management.
import { useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Link, navigate } from '../app/router.js';
import { Avatar, Button, Card, ChipSelect, Disclosure, EmptyState, Icon, IconButton, Page, Segmented, Sheet, StatTile, TopBar, useConfirm } from '../ui/index.js';
import { Block, Quiet } from '../shared/bits.jsx';
import { Timeline } from '../shared/Timeline.jsx';
import { VideoPlayerSheet } from '../shared/videos.jsx';
import {
  koutsiAttendanceSummary, koutsiTrainingsForStudent, koutsiThemeForDate, koutsiGroupById, koutsiMonthlySummary, koutsiFmtShortDate,
} from '../domain/core.js';
import { koutsiFmtEventDate } from '../domain/timeline.js';
import { groupsOf } from '../domain/week.js';
import { LEVELS, MOOD_LABELS } from '../lib/constants.js';
import { useCoach } from './CoachRoot.jsx';
import { groupPath } from './nav.js';
import { AudienceSheet, EditPlaceholderSheet, MergeSheet, PlaceholderInvite, TextEntrySheet } from './playerForms.jsx';
import { useRecord } from './merkitse.jsx';
import { ambitionById } from '../domain/playerNow.js';

function LevelSheet({ open, onClose, student }) {
  const { run } = useData();
  const set = async (level) => {
    const res = await run(() => api.students.setLevel(student.id, level || null), 'Taso päivitetty.');
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Pelaajan taso" size="sm">
      <ChipSelect options={LEVELS.map((l) => ({ value: l, label: l }))} value={student?.level || ''} onChange={set} layout="grid" columns={2} ariaLabel="Taso" />
    </Sheet>
  );
}

function Notes({ student, onEditNote, onEditHomework, onOpenVideo, onAudience }) {
  const { run } = useData();
  const confirm = useConfirm();
  const removeNote = async (d) => {
    if (await confirm({ title: 'Poista huomio?', message: d.text, confirmLabel: 'Poista', danger: true })) await run(() => api.notes.remove(d.id), 'Huomio poistettu.');
  };
  const removeHomework = async (h) => {
    if (await confirm({ title: 'Poista kotiläksy?', message: h.text, confirmLabel: 'Poista', danger: true })) await run(() => api.homework.remove(h.id), 'Kotiläksy poistettu.');
  };
  const removeVideo = async (v) => {
    if (await confirm({ title: 'Poista video?', message: `${v.title} poistetaan pelaajan näkymästä.`, confirmLabel: 'Poista', danger: true })) await run(() => api.videos.remove(v.id), 'Video poistettu.');
  };
  const toggleHomework = (h) => run(() => api.homework.toggleDone(h.id, !h.done));
  return (
    <div className="stack-5">
      <Block eyebrow="Valmentajalta" title="Huomiot">
        {student.diary.length === 0 ? <Quiet icon="edit">Ei vielä huomioita. Lyhyt huomio treenin jälkeen näkyy pelaajan aikajanalla.</Quiet> : (
          <div className="k-list">
            {student.diary.map((d) => (
              <div key={d.id} className="k-note-row">
                <div className="grow"><p className="k-note-text">{d.text}</p><span className="k-faint">{koutsiFmtEventDate(d.at)}</span></div>
                <IconButton icon="edit" label="Muokkaa" size="sm" onClick={() => onEditNote(d)} />
                <IconButton icon="trash" label="Poista" size="sm" onClick={() => removeNote(d)} />
              </div>
            ))}
          </div>
        )}
      </Block>
      <Block eyebrow="Kotiläksyt" title={`${student.homework.filter((h) => !h.done).length} avoinna`}>
        {student.homework.length === 0 ? <Quiet icon="check-circle">Ei kotiläksyjä.</Quiet> : (
          <div className="k-list">
            {student.homework.map((h) => (
              <div key={h.id} className="k-note-row">
                <button type="button" className={h.done ? 'k-check-btn is-on' : 'k-check-btn'} aria-label={h.done ? 'Merkitse tekemättömäksi' : 'Merkitse tehdyksi'} onClick={() => toggleHomework(h)}><Icon name="check" size={14} strokeWidth={3} /></button>
                <div className="grow"><p className={h.done ? 'k-note-text is-done' : 'k-note-text'}>{h.text}</p><span className="k-faint">{h.done && h.doneAt ? `Tehty ${koutsiFmtEventDate(h.doneAt)}` : koutsiFmtEventDate(h.at)}</span></div>
                <IconButton icon="edit" label="Muokkaa" size="sm" onClick={() => onEditHomework(h)} />
                <IconButton icon="trash" label="Poista" size="sm" onClick={() => removeHomework(h)} />
              </div>
            ))}
          </div>
        )}
      </Block>
      <Block eyebrow="Videot" title={`${student.videos.length} videota`}>
        {student.videos.length === 0 ? <Quiet icon="play">Ei videoita.</Quiet> : (
          <div className="k-list">
            {student.videos.map((v) => (
              <div key={v.id} className="k-note-row">
                <button type="button" className="k-video-thumb" style={{ '--h': v.hue }} onClick={() => onOpenVideo(v)} aria-label={`Katso ${v.title}`}><Icon name="play" size={14} /></button>
                <div className="grow"><p className="k-note-text">{v.title}</p><span className="k-faint">{v.addedBy === 'player' ? 'Pelaajan oma' : `Jaettu ${v.recipientIds.length} pelaajalle`} · {koutsiFmtShortDate(v.date)}</span></div>
                {v.addedBy !== 'player' && <IconButton icon="users" label="Kuka näkee" size="sm" onClick={() => onAudience(v)} />}
                {v.addedBy !== 'player' && <IconButton icon="trash" label="Poista" size="sm" onClick={() => removeVideo(v)} />}
              </div>
            ))}
          </div>
        )}
      </Block>
    </div>
  );
}

// The player's goal on top of their Kehitys: what they are after now, and (when the player has
// told) what kind of player they aim to be and where they are heading in the long run. Each earlier goal stays on
// the timeline below as "Tavoite päivitetty" with the old one underneath.
function PlayerGoal({ student }) {
  const history = student.goalHistory || [];
  const earlier = history.filter((h) => h.previousValue).length;
  const foot = [
    history[0] ? `Asetettu ${koutsiFmtEventDate(history[0].at)}` : '',
    earlier === 1 ? '1 aiempi tavoite aikajanalla' : earlier > 1 ? `${earlier} aiempaa tavoitetta aikajanalla` : '',
  ].filter(Boolean).join(' · ');
  return (
    <Card className="goal-card">
      <div className="eyebrow"><Icon name="target" size={13} /> Pelaajan tavoite</div>
      {student.goal ? <p className="goal-text">{student.goal}</p> : <p className="k-faint">Pelaaja ei ole vielä asettanut tavoitetta.</p>}
      {(student.ambition || student.longGoal) && (
        <div className="goal-long">
          {ambitionById(student.ambition) && <span className="chip chip-sm goal-aim">{ambitionById(student.ambition).label}</span>}
          {student.longGoal && <p className="goal-long-text"><span className="k-faint">Pitkällä aikavälillä:</span> {student.longGoal}</p>}
        </div>
      )}
      {student.goal && foot && <span className="goal-card-foot">{foot}</span>}
    </Card>
  );
}

function Details({ state, student }) {
  const now = new Date();
  const month = koutsiMonthlySummary(state, student.id, now.getFullYear(), now.getMonth());
  const moods = student.moods || [];
  const avg = moods.length ? (moods.reduce((s, m) => s + m.score, 0) / moods.length).toFixed(1) : '–';
  const field = (label, value, empty) => (
    <div className="k-detail">
      <div className="field-label">{label}</div>
      {value ? <p className="k-note-text">{value}</p> : <p className="k-faint">{empty}</p>}
    </div>
  );
  return (
    <div className="stack-5">
      <Card className="stack-4">
        {field('Tavoite', student.goal, 'Pelaaja ei ole vielä asettanut tavoitetta.')}
        {field('Toive seuraavalle kerralle', student.playerWish, 'Ei toivetta.')}
        {field('Pelaajan muistiinpano', student.playerNote, 'Ei muistiinpanoa.')}
      </Card>
      <div className="k-stats k-stats-3">
        <StatTile label="Treenit tässä kuussa" value={month.categories.find((c) => c.key === 'ryhmatreeni').count + month.categories.find((c) => c.key === 'valmennus').count} />
        <StatTile label="Omat treenit" value={month.categories.filter((c) => ['omatoiminen', 'fysiikka', 'muu', 'turnaus'].includes(c.key)).reduce((s, c) => s + c.count, 0)} />
        <StatTile label="Fiilis ka." value={avg} sub={moods.length ? `${moods.length} merkintää` : 'ei merkintöjä'} />
      </div>
      {moods.length > 0 && (
        <Block eyebrow="Fiilikset" title="Viimeisimmät">
          <div className="k-moods">
            {moods.slice(0, 8).map((m) => (
              <div key={m.id} className="k-mood" title={MOOD_LABELS[m.score]}>
                <span className="k-mood-score t-num" data-score={m.score}>{m.score}</span>
                <span className="k-faint">{koutsiFmtEventDate(m.at)}</span>
              </div>
            ))}
          </div>
        </Block>
      )}
    </div>
  );
}

export function PlayerScreen({ params }) {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const record = useRecord();
  const confirm = useConfirm();
  const [tab, setTab] = useState('kehitys');
  const [sheet, setSheet] = useState(null); // { kind, item }
  const [video, setVideo] = useState(null);
  const student = state.students.find((s) => s.id === params.id);
  const trainings = useMemo(() => (student ? koutsiTrainingsForStudent(state, student.id).map((t) => {
    const group = t.groupId ? koutsiGroupById(state, t.groupId) : null;
    return { ...t, groupName: group?.name || '', themeTitle: group ? koutsiThemeForDate(group, t.date)?.title || '' : '' };
  }) : []), [state, student]);
  if (!student) {
    return (
      <>
        <TopBar title="Pelaaja" back="/valmentaja/pelaajat" />
        <Page><EmptyState art="search" title="Pelaajaa ei löytynyt" text="Valmennus on ehkä päättynyt, tai pelaaja on yhdistetty toiseen." /></Page>
      </>
    );
  }
  const groups = groupsOf(state, student.id);
  const attendance = koutsiAttendanceSummary(state, student.id);
  const close = () => setSheet(null);

  const endCoaching = async () => {
    const twin = state.students.find((s) => s.id !== student.id && s.name.trim().toLocaleLowerCase('fi') === student.name.trim().toLocaleLowerCase('fi'));
    const ok = await confirm({
      title: `Päätä valmennus: ${student.name}?`,
      message: twin
        ? `Pelaaja poistuu listaltasi ja KAIKISTA ryhmistäsi. Sinulla on toinenkin pelaaja nimeltä ${twin.name} — jos tämä on sama henkilö, yhdistä profiilit sen sijaan, niin kumpikaan ryhmä ei katoa.`
        : 'Pelaaja poistuu listaltasi ja ryhmistäsi. Hänen omat tietonsa ja aiemmat merkinnät säilyvät hänen näkymässään.',
      confirmLabel: 'Päätä valmennus', danger: true,
    });
    if (!ok) return;
    const res = await run(() => api.students.endCoaching(coachId, student.id), 'Valmennus päättyi.');
    if (res.ok) navigate('/valmentaja/pelaajat', { replace: true });
  };
  const deletePlayer = async () => {
    const ok = await confirm({
      title: `Poista ${student.name} kokonaan?`,
      message: `${student.name} ja kaikki hänen tietonsa — ryhmät, treenit, huomiot, läksyt ja videot — poistetaan pysyvästi. Toimintoa ei voi perua.`,
      confirmLabel: 'Poista lopullisesti', danger: true, typeToConfirm: student.name,
    });
    if (!ok) return;
    const res = await run(() => api.students.deletePlaceholder(coachId, student.id), `${student.name} poistettiin.`);
    if (res.ok) navigate('/valmentaja/pelaajat', { replace: true });
  };

  return (
    <>
      <TopBar title={student.name} back="/valmentaja/pelaajat" actions={student.isPlaceholder ? <IconButton icon="edit" label="Muokkaa perustietoja" onClick={() => setSheet({ kind: 'edit' })} /> : null} />
      <Page className="stack-6 k-page-pad">
        <header className="k-player-head">
          <Avatar person={student} size={72} ring />
          <div className="grow">
            <h1 className="t-title">{student.name}</h1>
            <div className="row wrap k-player-meta">
              {student.ageLabel && <span>{student.ageLabel}</span>}
              <button type="button" className="chip chip-md chip-lime k-level-btn" onClick={() => setSheet({ kind: 'level' })}>{student.level || 'Aseta taso'}<Icon name="chevron-down" size={13} /></button>
            </div>
            {groups.length > 0 && (
              <div className="row wrap k-player-groups">
                {groups.map((g) => <Link key={g.id} to={groupPath(g.id)} className="chip chip-sm chip-outline">{g.day} {g.time} · {g.name}</Link>)}
              </div>
            )}
          </div>
        </header>

        {student.isPlaceholder && <PlaceholderInvite student={student} />}

        <div className="k-quick">
          <Button variant="lime" icon="chat" onClick={() => record.open('note', { ids: [student.id], source: 'pelaaja' })}>Huomio</Button>
          <Button variant="outline" icon="check-circle" onClick={() => record.open('homework', { ids: [student.id], source: 'pelaaja' })}>Kotiläksy</Button>
          <Button variant="outline" icon="play" onClick={() => record.open('video', { ids: [student.id], source: 'pelaaja' })}>Video</Button>
        </div>

        {attendance.total > 0 && (
          <Card className="k-attendance">
            <div className="grow">
              <div className="k-attendance-rate t-num">{attendance.rate} %</div>
              <div className="k-faint">läsnä {attendance.present}/{attendance.total} treenissä</div>
            </div>
            {attendance.events.length > 0 && (
              <div className="k-attendance-misses">
                <div className="field-label">Viimeisimmät poissaolot</div>
                {attendance.events.slice(0, 3).map((e) => <span key={e.training.id} className="k-faint">{koutsiFmtShortDate(e.training.date)}{e.reportedBy === student.id ? ' · ilmoitti itse' : ''}</span>)}
              </div>
            )}
          </Card>
        )}

        <Segmented ariaLabel="Näkymä" value={tab} onChange={setTab} options={[
          { value: 'kehitys', label: 'Kehitys' },
          { value: 'merkinnat', label: 'Merkinnät' },
          { value: 'tiedot', label: 'Tiedot' },
        ]} />
        {tab === 'kehitys' && (
          <div className="stack-4">
            <PlayerGoal student={student} />
            <Timeline viewer="coach" student={student} trainings={trainings} clubEvents={state.clubEvents} onOpenVideo={setVideo}
              emptyText="Aikajanalle kertyvät treenit teemoineen, huomiosi, läksyt ja pelaajan omat merkinnät." />
          </div>
        )}
        {tab === 'merkinnat' && (
          <Notes student={student}
            onEditNote={(d) => setSheet({ kind: 'note', item: d })}
            onEditHomework={(h) => setSheet({ kind: 'homework', item: h })}
            onOpenVideo={setVideo}
            onAudience={(v) => setSheet({ kind: 'audience', item: v })} />
        )}
        {tab === 'tiedot' && <Details state={state} student={student} />}

        <Disclosure title="Hallinta" summary="Valmennuksen päättäminen, yhdistäminen" icon="settings">
          <div className="stack-3">
            <p className="field-msg">Päättäminen poistaa pelaajan listaltasi ja ryhmistäsi. Aiemmat merkinnät säilyvät pelaajan omassa näkymässä.</p>
            <div className="row wrap">
              <Button variant="outline" size="sm" icon="users" onClick={() => setSheet({ kind: 'merge' })}>Yhdistä toiseen pelaajaan</Button>
              <Button variant="danger" size="sm" onClick={endCoaching}>Päätä valmennus</Button>
              {student.isPlaceholder && <Button variant="danger" size="sm" icon="trash" onClick={deletePlayer}>Poista kokonaan</Button>}
            </div>
          </div>
        </Disclosure>
      </Page>

      <LevelSheet open={sheet?.kind === 'level'} student={student} onClose={close} />
      <EditPlaceholderSheet open={sheet?.kind === 'edit'} student={student} onClose={close} />
      <MergeSheet open={sheet?.kind === 'merge'} student={student} onClose={close} />
      <AudienceSheet open={sheet?.kind === 'audience'} video={sheet?.item} onClose={close} />
      {/* new notes, homework and videos go through Merkitse's sheets (useRecord); these edit one */}
      <TextEntrySheet
        open={sheet?.kind === 'note'} onClose={close}
        title="Muokkaa huomiota"
        subtitle="Näkyy pelaajan aikajanalla."
        initial={sheet?.item?.text} placeholder="Esim. Hyvä nousu syötössä tällä viikolla…"
        onSave={async (text) => (await run(() => api.notes.update(sheet.item.id, text), 'Huomio päivitetty.')).ok}
      />
      <TextEntrySheet
        open={sheet?.kind === 'homework'} onClose={close}
        title="Muokkaa kotiläksyä"
        subtitle="Pelaaja voi merkitä läksyn tehdyksi omassa näkymässään."
        initial={sheet?.item?.text} placeholder="Esim. 20 rystylyöntiä seinää vasten…"
        onSave={async (text) => (await run(() => api.homework.update(sheet.item.id, text), 'Kotiläksy päivitetty.')).ok}
      />
      <VideoPlayerSheet video={video} onClose={() => setVideo(null)} />
    </>
  );
}
