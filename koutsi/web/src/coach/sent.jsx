// sent.jsx — the pieces of Lähetetyt (domain/sends.js), shared by its page, a group's page and the
// coach's videos:
//   SentRow       one sending in a list: what, to whom, when, and "3/8 tehty" for a homework
//   SentSheet     one sending opened: the text or the video, who got it (who has done the homework),
//                 the same thing's other sendings, Muokkaa, Poista and "Lähetä myös muille"
//   SendOnSheet   "Lähetä myös muille": the same thing to more players; whoever already has it shows
//                 as "Saanut" and can't be picked again
//   GroupSent     a group page's "Ryhmälle lähetetty": its last few, and the whole list behind a link
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Avatar, Button, Field, Icon, Sheet, Textarea, useConfirm } from '../ui/index.js';
import { RecipientPicker } from '../shared/recipients.jsx';
import { VideoPlayerSheet } from '../shared/videos.jsx';
import { Block } from '../shared/bits.jsx';
import { koutsiAddDays, koutsiTodayStr, koutsiFmtShortDate } from '../domain/core.js';
import {
  audienceIds, groupsCovering, homeworkProgress, receivedBy, recipientsLabel, relatedSends, sendLogFor, sentItems, sentWhen,
} from '../domain/sends.js';
import { RECORD_LOOK } from './tiles.jsx';
import { useCoach } from './CoachRoot.jsx';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const players = (n) => (n === 1 ? '1 pelaaja' : `${n} pelaajaa`);
const forPlayers = (n) => (n === 1 ? '1 pelaajalle' : `${n} pelaajalle`);

/** The look of each kind: the same icons and colours as Merkitse. */
export const SENT_LOOK = {
  video: RECORD_LOOK.video,
  homework: RECORD_LOOK.laksy,
  note: RECORD_LOOK.huomio,
  notice: RECORD_LOOK.tiedote,
};

export function SentIcon({ kind, size = 'md' }) {
  const look = SENT_LOOK[kind] || SENT_LOOK.note;
  return <span className={cx('k-merkitse-icon sent-icon', `is-${look.tone}`, size === 'sm' && 'is-sm')} aria-hidden="true"><Icon name={look.icon} size={size === 'sm' ? 15 : 18} /></span>;
}

/** One sending in a list. */
export function SentRow({ item, onOpen, showWhen = 'clock' }) {
  const { state } = useData();
  const progress = homeworkProgress(item);
  const look = SENT_LOOK[item.kind];
  const when = showWhen === 'clock' ? clockLabel(item.at) : sentWhen(item.at);
  return (
    <button type="button" className="k-row sent-row" onClick={() => onOpen(item)}>
      <SentIcon kind={item.kind} />
      <span className="k-row-main">
        <span className="sent-row-title">{item.kind === 'video' ? item.title : item.title.replace(/\s+/g, ' ')}</span>
        <span className="k-row-sub truncate">{look.label}, {recipientsLabel(state, item)}{when ? ` (${when})` : ''}</span>
      </span>
      {progress && (
        <span className={cx('sent-progress t-num', progress.done === progress.total && 'is-all')} title={`${progress.done}/${progress.total} tehnyt`}>
          {progress.done}/{progress.total}
        </span>
      )}
    </button>
  );
}

const pad = (n) => String(n).padStart(2, '0');
const clockLabel = (at) => { if (!at) return ''; const d = new Date(at); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** Finds the item again from fresh state, so an open sheet follows edits (and closes if it is gone). */
export function useSentItem(key) {
  const { state } = useData();
  return useMemo(() => (key ? sentItems(state).find((it) => it.key === key) || null : null), [state, key]);
}

/**
 * SentSheet — one sending. itemKey: SentRow's item.key (null = closed).
 */
export function SentSheet({ itemKey, onClose }) {
  const { state, run } = useData();
  const confirm = useConfirm();
  const live = useSentItem(itemKey);
  // keeps showing while the sheet slides away after a delete
  const [shown, setShown] = useState(null);
  useEffect(() => { if (live) setShown(live); }, [live]);
  const item = live || shown;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendOn, setSendOn] = useState(false);
  const [playing, setPlaying] = useState(null);
  useEffect(() => { setEditing(false); setSendOn(false); }, [itemKey]);
  useEffect(() => { if (itemKey && !live && shown) onClose(); }, [itemKey, live]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return null;

  const look = SENT_LOOK[item.kind];
  const audience = audienceIds(state, item);
  const copies = new Map(item.copies.map((c) => [c.studentId, c]));
  const people = audience.map((id) => state.students.find((s) => s.id === id)).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  const progress = homeworkProgress(item);
  const related = relatedSends(state, item);
  const video = item.kind === 'video' ? (state.videoLibrary || []).find((v) => v.id === item.videoId) : null;
  const holders = item.kind === 'video' ? receivedBy(state, item) : null;
  const canEdit = item.kind === 'homework' || item.kind === 'note';

  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const res = await run(() => api.sends.update(item.id, text), item.kind === 'homework' ? 'Kotiläksy päivitetty kaikille.' : 'Huomio päivitetty kaikille.');
    setBusy(false);
    if (res.ok) { track('lahetetyt.muokkaa'); setEditing(false); }
  };
  const remove = async () => {
    const n = item.kind === 'notice' ? audience.length : item.copies.length || item.studentIds.length;
    const ask = {
      homework: { title: 'Poista kotiläksy kaikilta?', message: `Läksy poistuu ${n === 1 ? '1 pelaajalta' : `${n} pelaajalta`}, myös tehdyt merkinnät.`, confirmLabel: 'Poista kaikilta' },
      note: { title: 'Poista huomio kaikilta?', message: `Huomio poistuu ${n === 1 ? '1 pelaajan' : `${n} pelaajan`} Kehityksestä.`, confirmLabel: 'Poista kaikilta' },
      video: { title: 'Ota video pois näiltä pelaajilta?', message: 'Video jää omiin Videoihisi, ja voit jakaa sen myöhemmin uudelleen.', confirmLabel: 'Ota pois' },
      notice: { title: 'Poista tiedote?', message: 'Tiedote katoaa pelaajien Kodista.', confirmLabel: 'Poista' },
    }[item.kind];
    if (!(await confirm({ ...ask, danger: true }))) return;
    setBusy(true);
    const res = await run(
      () => (item.kind === 'notice' ? api.announcements.remove(item.id) : api.sends.remove(item.id)),
      { homework: 'Kotiläksy poistettu.', note: 'Huomio poistettu.', video: 'Video otettu pois.', notice: 'Tiedote poistettu.' }[item.kind],
    );
    setBusy(false);
    if (res.ok) { track(`lahetetyt.poista-${item.kind}`); onClose(); }
  };

  const footer = editing ? (
    <div className="sheet-actions">
      <Button variant="soft" size="lg" onClick={() => setEditing(false)} disabled={busy}>Peruuta</Button>
      <Button variant="dark" size="lg" loading={busy} missing={!text.trim() ? 'Kirjoita teksti.' : null} onClick={save}>Tallenna kaikille</Button>
    </div>
  ) : (
    <div className="sheet-actions">
      {canEdit && <Button variant="soft" size="lg" onClick={() => { setText(item.title); setEditing(true); }}>Muokkaa</Button>}
      <Button variant="dark" size="lg" onClick={() => { track('lahetetyt.eteenpain'); setSendOn(true); }}>Lähetä myös muille</Button>
    </div>
  );

  return (
    <>
      <Sheet open={Boolean(itemKey)} onClose={() => !busy && onClose()} title={look.label}
        subtitle={`Lähetetty ${sentWhen(item.at)}${item.kind === 'notice' && item.until ? `, näkyy ${koutsiFmtShortDate(item.until)} asti` : ''}`}
        size="md" footer={footer} confirmClose={editing && text.trim() !== item.title}>
        <div className="stack-5">
          {editing ? (
            <Field label={item.kind === 'homework' ? 'Läksy' : 'Huomio'} htmlFor="sent-edit" hint="Muutos näkyy jokaiselle, joka sai tämän.">
              <Textarea id="sent-edit" rows={5} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
            </Field>
          ) : item.kind === 'video' ? (
            <button type="button" className="sent-video" onClick={() => video && setPlaying(video)} disabled={!video}>
              <span className="k-video-thumb" style={{ '--h': video?.hue ?? 20 }}><Icon name="play" size={16} /></span>
              <span className="grow sent-video-title">{item.title}</span>
              {video && <span className="k-textlink">Katso</span>}
            </button>
          ) : (
            <p className="sent-text">{item.title}</p>
          )}

          <section className="stack-2" aria-label="Kenelle">
            <div className="sent-section-head">
              <span className="field-label">Kenelle</span>
              <span className="k-faint">
                {progress ? `${progress.done}/${progress.total} tehnyt` : players(people.length)}
              </span>
            </div>
            <p className="sent-who">{recipientsLabel(state, item)}</p>
            <div className="sent-people">
              {people.map((s) => {
                const copy = copies.get(s.id);
                const status = item.kind === 'homework'
                  ? (copy ? (copy.done ? { text: `Tehty${copy.doneAt ? ` ${shortDay(copy.doneAt)}` : ''}`, tone: 'done' } : { text: 'Ei vielä', tone: 'open' }) : { text: 'Poistettu', tone: 'gone' })
                  : item.kind === 'note' ? (copy ? null : { text: 'Poistettu', tone: 'gone' })
                    : item.kind === 'video' ? (holders.has(s.id) ? null : { text: 'Otettu pois', tone: 'gone' }) : null;
                return (
                  <div key={s.id} className="sent-person">
                    <Avatar person={s} size={28} />
                    <span className="grow truncate">{s.name}</span>
                    {status && <span className={cx('sent-status', `is-${status.tone}`)}>{status.tone === 'done' && <Icon name="check" size={12} strokeWidth={3} />}{status.text}</span>}
                  </div>
                );
              })}
              {people.length === 0 && <p className="k-quiet">Kukaan ei ole enää pelaajasi.</p>}
            </div>
          </section>

          {related.length > 0 && (
            <section className="stack-2" aria-label="Lähetetty myös">
              <span className="field-label">{item.kind === 'video' ? 'Jaettu myös' : 'Lähetetty myös'}</span>
              <div className="sent-related">
                {related.map((x) => (
                  <div key={x.id} className="sent-related-row">
                    <span className="k-faint">{sentWhen(x.at)}</span>
                    <span className="grow truncate">{recipientsLabel(state, x)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!editing && (
            <button type="button" className="k-textlink is-danger sent-remove" onClick={remove} disabled={busy}>
              {{ homework: 'Poista kotiläksy kaikilta', note: 'Poista huomio kaikilta', video: 'Ota video pois näiltä pelaajilta', notice: 'Poista tiedote' }[item.kind]}
            </button>
          )}
        </div>
      </Sheet>
      <SendOnSheet open={sendOn} item={item} onClose={() => setSendOn(false)} />
      <VideoPlayerSheet video={playing} onClose={() => setPlaying(null)} />
    </>
  );
}

const shortDay = (at) => { const d = new Date(at); return `${d.getDate()}.${d.getMonth() + 1}.`; };

/**
 * SendOnSheet — "Lähetä myös muille" / "Jaa pelaajille": item is a Lähetetyt item or one of the
 * coach's videos as { kind: 'video', videoId, title }.
 */
export function SendOnSheet({ open, item, onClose, onSent }) {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const [ids, setIds] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setIds([]); setBusy(false); } }, [open]);
  const received = useMemo(() => (item && open ? receivedBy(state, item) : new Map()), [state, item, open]);
  if (!item) return null;
  const look = SENT_LOOK[item.kind];
  const fresh = ids.filter((id) => !received.has(id));

  const submit = async () => {
    if (!fresh.length || busy) return;
    setBusy(true);
    const n = fresh.length;
    const today = koutsiTodayStr();
    let res;
    if (item.kind === 'video') {
      res = await run(() => api.videos.shareSaved({ coachId, videoId: item.videoId, studentIds: fresh, groupIds: groupsCovering(state.groups, fresh) }), `Video jaettu ${forPlayers(n)}.`);
    } else if (item.kind === 'notice') {
      const groupIds = groupsCovering(state.groups, fresh);
      const inGroups = new Set(state.groups.filter((g) => groupIds.includes(g.id)).flatMap((g) => g.memberIds));
      const until = item.until && item.until >= today ? item.until : koutsiAddDays(today, 7);
      res = await run(() => api.announcements.add(coachId, { text: item.title, groupIds, studentIds: fresh.filter((id) => !inGroups.has(id)), until }), `Tiedote lähetetty ${forPlayers(n)}.`);
    } else {
      const log = sendLogFor(state, coachId, fresh, item.refId);
      res = await run(
        () => (item.kind === 'homework' ? api.homework.addMany(fresh, item.title, log) : api.notes.addMany(coachId, fresh, item.title, log)),
        item.kind === 'homework' ? `Kotiläksy annettu ${forPlayers(n)}.` : `Huomio lähetetty ${forPlayers(n)}.`,
      );
    }
    setBusy(false);
    if (!res.ok) return;
    track(`lahetetyt.eteenpain-${item.kind}`);
    onSent?.();
    onClose();
  };

  const free = state.students.filter((s) => !received.has(s.id)).length;
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={item.kind === 'video' && !item.id ? 'Jaa video' : 'Lähetä myös muille'} size="md" dismissible={!busy}
      footer={(
        <div className="sheet-actions">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button>
          <Button variant="dark" size="lg" loading={busy} missing={!fresh.length ? 'Valitse ainakin yksi pelaaja.' : null} onClick={submit}>
            {fresh.length ? `Lähetä ${forPlayers(fresh.length)}` : 'Lähetä'}
          </Button>
        </div>
      )}>
      <div className="stack-4">
        <div className="sent-what">
          <SentIcon kind={item.kind} size="sm" />
          <span className="grow">
            <span className="sent-what-kind">{look.label}</span>
            <span className="sent-what-text">{item.title}</span>
          </span>
        </div>
        {received.size > 0 && <p className="k-faint">{players(received.size)} on jo saanut tämän. Heitä ei voi valita uudelleen.</p>}
        <Field label={`Kenelle${fresh.length ? ` (${fresh.length})` : ''}`}>
          {free === 0
            ? <p className="k-quiet">Kaikki pelaajasi ovat jo saaneet tämän.</p>
            : <RecipientPicker students={state.students} groups={state.groups} value={ids} onChange={setIds} open={open} received={received} />}
        </Field>
      </div>
    </Sheet>
  );
}

/** A group page's "Ryhmälle lähetetty": the last three, the rest on Lähetetyt filtered to the group. */
export function GroupSent({ groupId }) {
  const { state } = useData();
  const [openKey, setOpenKey] = useState(null);
  const items = useMemo(() => sentItems(state).filter((it) => (it.groupIds || []).includes(groupId)), [state, groupId]);
  // nothing sent yet: the buttons above are enough, no empty box
  if (!state.sendsReady || items.length === 0) return null;
  return (
    <Block eyebrow="Ryhmälle lähetetty" title={`${items.length} ${items.length === 1 ? 'lähetys' : 'lähetystä'}`}
      action={<Button variant="ghost" size="sm" onClick={() => { track('ryhma.lahetetyt-kaikki'); navigate(`/valmentaja/lahetetyt?ryhma=${groupId}`); }}>{items.length > 3 ? 'Näytä kaikki' : 'Lähetetyt'}</Button>}>
      <div className="k-list">
        {items.slice(0, 3).map((it) => <SentRow key={it.key} item={it} showWhen="day" onOpen={(x) => { track('ryhma.lahetetty'); setOpenKey(x.key); }} />)}
      </div>
      <SentSheet itemKey={openKey} onClose={() => setOpenKey(null)} />
    </Block>
  );
}
