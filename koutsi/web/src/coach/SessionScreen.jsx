// SessionScreen — one session: when, who, the week's theme, a note / homework / video for the
// players who came (or, before it, for everyone expected), and attendance. Attendance is a
// tap per player (Paikalla ↔ Poissa); presence is "no row", so nothing needs saving for the
// players who came. A tap shows immediately and is saved in the background.
import { useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { goBack, Link } from '../app/router.js';
import { Avatar, Button, Card, EmptyState, Icon, IconButton, Page, TopBar, useToast } from '../ui/index.js';
import { Block, ThemeCard } from '../shared/bits.jsx';
import {
  koutsiFmtLongDate, koutsiThemeForDate, koutsiTimeRangeLabel, koutsiIsoWeekOfDateStr, koutsiFmtShortDate,
} from '../domain/core.js';
import { presentPlayerIds, sessionRoster, sessionStatus } from '../domain/week.js';
import { groupPath, playerPath } from './nav.js';
import { TrainingSheet, useTrainingDelete } from './trainingForms.jsx';
import { GroupThemeSheet } from './GroupThemeSheet.jsx';
import { useRecord } from './merkitse.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

export function SessionScreen({ params }) {
  const { state, mutate, reload } = useData();
  const toast = useToast();
  const removeTraining = useTrainingDelete();
  const record = useRecord();
  const [editOpen, setEditOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [pending, setPending] = useState(() => new Set());
  const training = state.trainings.find((t) => t.id === params.id);
  if (!training) {
    return (
      <>
        <TopBar title="Treeni" back="/valmentaja/ryhmat" />
        <Page><EmptyState art="calendar" title="Treeniä ei löytynyt" text="Se on ehkä poistettu tai siirretty." /></Page>
      </>
    );
  }
  const group = training.groupId ? state.groups.find((g) => g.id === training.groupId) : null;
  const roster = sessionRoster(state, training);
  const absentIds = new Set((training.absences || []).map((a) => a.studentId));
  const status = sessionStatus(training, group);
  const theme = group ? koutsiThemeForDate(group, training.date) : null;
  const week = koutsiIsoWeekOfDateStr(training.date);
  const present = roster.filter((s) => !absentIds.has(s.id)).length;
  // after a session: the players who were there; before it: everyone expected
  const recipients = status === 'upcoming' ? roster.map((s) => s.id) : presentPlayerIds(state, training);
  const label = `${koutsiFmtShortDate(training.date)} klo ${training.time} — ${group ? group.name : training.type}`;

  const setStatus = async (student, next) => {
    if (pending.has(student.id)) return;
    setPending((p) => new Set(p).add(student.id));
    // optimistic: the tap shows at once; the reload after the write is the truth
    mutate((s) => ({
      ...s,
      trainings: s.trainings.map((t) => (t.id !== training.id ? t : {
        ...t,
        absences: next === 'poissa'
          ? [...(t.absences || []).filter((a) => a.studentId !== student.id), { studentId: student.id, reason: 'poissa', reportedBy: null, updatedAt: new Date().toISOString() }]
          : (t.absences || []).filter((a) => a.studentId !== student.id),
      })),
    }));
    try {
      await api.attendance.set([training.id], student.id, next);
    } catch (err) {
      toast(err);
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(student.id); return n; });
      reload().catch(() => {});
    }
  };

  const remove = async () => {
    if (await removeTraining(training, label)) goBack('/valmentaja/ryhmat');
  };

  return (
    <>
      <TopBar title={group ? group.name : training.type} back="/valmentaja/ryhmat" actions={(
        <>
          <IconButton icon="edit" label="Muokkaa treeniä" onClick={() => setEditOpen(true)} />
          <IconButton icon="trash" label="Poista treeni" onClick={remove} />
        </>
      )} />
      <Page className="stack-6 k-page-pad">
        <header className="k-session-head">
          <div className="eyebrow">{status === 'now' ? 'Käynnissä nyt' : status === 'past' ? 'Pidetty' : 'Tulossa'}</div>
          <h1 className="t-title">{koutsiFmtLongDate(training.date).replace(/^./, (c) => c.toUpperCase())}</h1>
          <p className="k-group-when">klo {koutsiTimeRangeLabel(training.time, training.durationMinutes || group?.durationMinutes)} · {training.type}</p>
          {group && <Link to={groupPath(group.id)} className="chip chip-sm chip-outline">{group.day} {group.time} · {group.name}</Link>}
        </header>

        {roster.length > 0 && (
          <div className="k-quick">
            <Button variant="lime" icon="chat" onClick={() => record.open('note', { ids: recipients, source: 'treeni' })}>Huomio</Button>
            <Button variant="outline" icon="check-circle" onClick={() => record.open('homework', { ids: recipients, source: 'treeni' })}>Kotiläksy</Button>
            <Button variant="outline" icon="play" onClick={() => record.open('video', { ids: recipients, source: 'treeni' })}>Video</Button>
          </div>
        )}

        {group && (theme ? (
          <ThemeCard theme={theme} week={week} eyebrow={`Teema · vko ${week.week}`}>
            <Button variant="outline" size="sm" icon="edit" className="k-theme-edit" onClick={() => setThemeOpen(true)}>Vaihda teema</Button>
          </ThemeCard>
        ) : (
          <Card className="k-empty-theme">
            <p className="k-quiet-text">Viikolle {week.week} ei ole teemaa tälle ryhmälle.</p>
            <Button variant="dark" size="sm" icon="sparkles" onClick={() => setThemeOpen(true)}>Aseta teema</Button>
          </Card>
        ))}

        <Block eyebrow="Läsnäolo" title={roster.length ? `${present}/${roster.length} paikalla` : 'Ei pelaajia'}>
          {roster.length === 0 ? <p className="k-quiet">Ryhmässä ei ole pelaajia.</p> : (
            <>
              <p className="field-msg">{status === 'upcoming' ? 'Pelaajat voivat ilmoittaa poissaolon etukäteen omassa sovelluksessaan.' : 'Napauta poissaolleet. Kaikki muut merkitään paikalla olleiksi.'} Poissaolon syytä ei tallenneta.</p>
              <ul className="k-attend">
                {roster.map((s) => {
                  const absent = absentIds.has(s.id);
                  const entry = (training.absences || []).find((a) => a.studentId === s.id);
                  return (
                    <li key={s.id} className={cx('k-attend-row', absent && 'is-absent')}>
                      <Link to={playerPath(s.id)} className="k-attend-who">
                        <Avatar person={s} size={36} />
                        <span className="grow">
                          <span className="k-row-title truncate">{s.name}</span>
                          {absent && entry?.reportedBy === s.id && <span className="k-faint">Ilmoitti itse</span>}
                        </span>
                      </Link>
                      <div className="k-attend-toggle" role="group" aria-label={`Läsnäolo: ${s.name}`}>
                        <button type="button" className={cx('k-attend-btn', !absent && 'is-on is-present')} aria-pressed={!absent} onClick={() => absent && setStatus(s, 'paikalla')}>
                          <Icon name="check" size={15} strokeWidth={2.6} />Paikalla
                        </button>
                        <button type="button" className={cx('k-attend-btn', absent && 'is-on is-absent')} aria-pressed={absent} onClick={() => !absent && setStatus(s, 'poissa')}>
                          <Icon name="close" size={15} strokeWidth={2.6} />Poissa
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Block>
      </Page>
      <TrainingSheet open={editOpen} editing={training} onClose={() => setEditOpen(false)} />
      <GroupThemeSheet open={themeOpen} group={group} week={week} onClose={() => setThemeOpen(false)} />
    </>
  );
}
