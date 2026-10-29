// MessagesScreen — Viestit for the coach: one conversation per player, newest first, "Vastaamatta"
// gathers the ones where the player wrote last. "Uusi viesti" picks a player messages are on for;
// "Tiedote ryhmälle" is Merkitse's Tiedote (a notice to many is not a conversation). "Viestit
// käyttöön" (MessagingSheet) decides who messages are on for: adults first, the coach picks.
import { useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Avatar, Button, EmptyState, Icon, ListRow, Page, Segmented, Sheet, SkeletonList, Switch, TopBar, useToast } from '../ui/index.js';
import { useMessages } from '../shared/messages/MessagesProvider.jsx';
import { groupMessaging, listTime, messagingOf, previewOf, sortThreads, unanswered } from '../domain/messages.js';
import { groupsOf } from '../domain/week.js';
import { koutsiSortGroupsBySchedule } from '../domain/core.js';
import { useRecord } from './merkitse.jsx';
import { threadPath } from './nav.js';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');
/** "Marialle", "Emilille": who a sentence speaks to. */
export const allative = (name) => { const f = String(name || '').split(' ')[0] || name; return /[aeiouyäö]$/i.test(f) ? `${f}lle` : `${f}ille`; };

/** "Aikuiset edistyneet · Ti 17:00 ja To 18:00" — the player's groups with this coach. */
export function groupLine(state, studentId) {
  const groups = groupsOf(state, studentId);
  if (!groups.length) return 'Yksityistunnit';
  const names = [...new Set(groups.map((g) => g.name))];
  const times = groups.slice(0, 2).map((g) => `${g.day} ${g.time}`).join(' ja ');
  return `${names.join(', ')} (${times}${groups.length > 2 ? ' …' : ''})`;
}

function ThreadRow({ thread, student, state }) {
  const unread = thread.unread > 0;
  return (
    <button type="button" className={cx('msg-row', unread && 'is-unread')} onClick={() => { track('viestit.avaa'); navigate(threadPath(student.id)); }}
      aria-label={`${student.name}${unread ? ', lukematon' : ''}`}>
      <Avatar person={student} size={44} />
      <span className="msg-row-text">
        <span className="msg-row-top">
          <span className="msg-row-title truncate">{student.name}</span>
          <span className="msg-row-time t-num">{listTime(thread.lastMessageAt)}</span>
        </span>
        <span className="msg-row-group truncate">{groupLine(state, student.id)}</span>
        <span className="msg-row-bottom">
          <span className="msg-row-preview truncate">{previewOf(thread, 'coach')}</span>
          {unread && <span className="msg-row-dot" aria-hidden="true" />}
        </span>
      </span>
    </button>
  );
}

/** "Viestit käyttöön": the active groups as switches (a mixed group shows its count), then the players in no group. */
export function MessagingSheet({ open, onClose }) {
  const { state } = useData();
  const m = useMessages();
  const toast = useToast();
  const [draft, setDraft] = useState({}); // groupId | 'p:<id>' → boolean
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => koutsiSortGroupsBySchedule(state.groups.filter((g) => g.memberIds.length)), [state.groups]);
  const inGroup = useMemo(() => new Set(state.groups.flatMap((g) => g.memberIds)), [state.groups]);
  const loners = state.students.filter((s) => !inGroup.has(s.id));
  const studentById = (id) => state.students.find((s) => s.id === id);
  const groupState = (g) => (draft[g.id] != null ? (draft[g.id] ? 'on' : 'off') : groupMessaging(g, m.threads));
  const playerOn = (id) => (draft[`p:${id}`] != null ? draft[`p:${id}`] : messagingOf(m.threads, id) === 'on');
  const changed = Object.keys(draft).length > 0;
  const close = () => { setDraft({}); onClose(); };

  const save = async () => {
    const on = new Set();
    const off = new Set();
    for (const [key, value] of Object.entries(draft)) {
      const ids = key.startsWith('p:') ? [key.slice(2)] : (groups.find((g) => g.id === key)?.memberIds || []);
      ids.forEach((id) => (value ? on : off).add(id));
    }
    on.forEach((id) => off.delete(id)); // a player in a group turned on and another turned off: on wins
    setBusy(true);
    try {
      if (on.size) await api.messages.setEnabled([...on], true);
      if (off.size) await api.messages.setEnabled([...off], false);
      await m.reload();
      track('viestit.kayttoon');
      toast(on.size ? `Viestit käytössä ${on.size} pelaajalle.` : 'Tallennettu.');
      close();
    } catch (err) { toast(err); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={() => !busy && close()} title="Viestit käyttöön" subtitle="Kenen kanssa voit viestiä kahden kesken" size="md" dismissible={!busy && !changed}
      footer={(
        <div className="sheet-actions">
          <Button variant="soft" size="lg" onClick={close} disabled={busy}>Peruuta</Button>
          <Button variant="dark" size="lg" disabled={!changed} loading={busy} onClick={save}>Tallenna</Button>
        </div>
      )}>
      <p className="msg-lead">Viestit ovat <strong>täysi-ikäisille</strong> pelaajille. Valitse aikuisten ryhmät — alaikäisille viestit tulevat myöhemmin huoltajan kautta. Jos ryhmässä on alle 18-vuotias, ota viestit häneltä pois hänen sivultaan.</p>
      <div className="list-group msg-toggles">
        {groups.map((g) => {
          const st = groupState(g);
          const accounts = g.memberIds.filter((id) => studentById(id) && !studentById(id).isPlaceholder).length;
          const hint = [
            g.memberIds.length === 1 ? '1 pelaaja' : `${g.memberIds.length} pelaajaa`,
            accounts < g.memberIds.length ? `${accounts} tunnuksella` : '',
            st === 'some' ? `viestit ${g.memberIds.filter((id) => playerOn(id)).length}:lle` : '',
          ].filter(Boolean).join(', ');
          return (
            <div key={g.id} className="toggle-row">
              <span className="toggle-row-text"><span className="toggle-row-label">{g.name}</span><span className="toggle-row-hint">{`${g.day} ${g.time}, ${hint}`}</span></span>
              <Switch checked={st === 'on'} label={`Viestit: ${g.name} ${g.day} ${g.time}`} onChange={(v) => setDraft((d) => ({ ...d, [g.id]: v }))} />
            </div>
          );
        })}
      </div>
      {loners.length > 0 && (
        <>
          <div className="msg-label">Ei ryhmässä</div>
          <div className="list-group msg-toggles">
            {loners.map((s) => (
              <div key={s.id} className="toggle-row">
                <span className="toggle-row-text"><span className="toggle-row-label">{s.name}</span>{s.isPlaceholder && <span className="toggle-row-hint">Ei vielä liittynyt</span>}</span>
                <Switch checked={playerOn(s.id)} label={`Viestit: ${s.name}`} onChange={(v) => setDraft((d) => ({ ...d, [`p:${s.id}`]: v }))} />
              </div>
            ))}
          </div>
        </>
      )}
      <p className="msg-note"><Icon name="info" size={15} /><span>Pelaaja ilman tunnusta saa viestit, kun hän liittyy. Viestit näkevät vain sinä ja pelaaja.</span></p>
    </Sheet>
  );
}

/** "Uusi viesti": a player messages are on for. */
function PickSheet({ open, onClose, onSetup }) {
  const { state } = useData();
  const m = useMessages();
  const players = state.students.filter((s) => messagingOf(m.threads, s.id) === 'on')
    .sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  const go = (s) => { onClose(); navigate(threadPath(s.id)); };
  return (
    <Sheet open={open} onClose={onClose} title="Uusi viesti" subtitle="Kenelle?" size="md">
      {players.length === 0 ? (
        <EmptyState compact art="mail" title="Viestit eivät ole vielä kenelläkään" text="Valitse ensin aikuisten ryhmät." action={<Button variant="dark" onClick={() => { onClose(); onSetup(); }}>Viestit käyttöön</Button>} />
      ) : (
        <div className="list-group msg-pick">
          {players.map((s) => (
            <ListRow key={s.id} leading={<Avatar person={s} size={36} />} title={s.name}
              subtitle={s.isPlaceholder ? 'Ei vielä liittynyt' : groupLine(state, s.id)} onClick={() => go(s)} />
          ))}
          <ListRow icon="users" title="Muut pelaajat" subtitle="Viestit käyttöön ryhmille tai pelaajille" onClick={() => { onClose(); onSetup(); }} />
        </div>
      )}
    </Sheet>
  );
}

export function MessagesScreen({ query }) {
  const { state } = useData();
  const m = useMessages();
  const record = useRecord();
  const [tab, setTab] = useState('kaikki');
  const [setupOpen, setSetupOpen] = useState(() => Boolean(query?.kayttoon));
  const [pickOpen, setPickOpen] = useState(false);
  const studentById = (id) => state.students.find((s) => s.id === id);
  const withMessages = sortThreads(m.threads.filter((t) => t.lastMessageAt && studentById(t.studentId)));
  const waiting = unanswered(withMessages);
  const rows = tab === 'vastaamatta' ? waiting : withMessages;
  const onCount = m.threads.filter((t) => t.enabled && studentById(t.studentId)).length;

  let content;
  if (!m.loaded) content = <SkeletonList count={4} variant="row" />;
  else if (!m.ready || !m.enabled) {
    content = <EmptyState art="mail" title="Viestit eivät ole vielä käytössä" text="Viestit tulevat käyttöön vaiheittain. Tiedotteen ryhmille voit lähettää jo nyt Merkitse-napista." />;
  } else {
    content = (
      <>
        <div className="msg-actions">
          <Button variant="dark" icon="chat" onClick={() => { track('viestit.uusi'); setPickOpen(true); }}>Uusi viesti</Button>
          <Button variant="outline" icon="send" title="Tiedote ryhmälle" onClick={() => { track('viestit.tiedote'); record.openMerkinta({ kind: 'tiedote' }); }}>Tiedote</Button>
        </div>
        {onCount === 0 ? (
          <EmptyState art="mail" title="Ota viestit käyttöön" text="Valitse aikuisten ryhmät, joiden pelaajien kanssa haluat viestiä kahden kesken."
            action={<Button variant="lime" icon="users" onClick={() => setSetupOpen(true)}>Viestit käyttöön</Button>} />
        ) : (
          <>
            <Segmented ariaLabel="Näytä" value={tab} onChange={setTab} options={[
              { value: 'kaikki', label: 'Kaikki' },
              { value: 'vastaamatta', label: 'Vastaamatta', badge: waiting.length || undefined },
            ]} />
            {rows.length === 0 ? (
              <EmptyState compact art="mail" title={tab === 'vastaamatta' ? 'Kaikkiin on vastattu' : 'Ei vielä viestejä'}
                text={tab === 'vastaamatta' ? 'Kun pelaaja kirjoittaa, keskustelu näkyy tässä, kunnes vastaat.' : 'Aloita "Uusi viesti" -napista tai pelaajan sivulta.'} />
            ) : (
              <div className="msg-list" role="list">
                {rows.map((t) => <ThreadRow key={t.id} thread={t} student={studentById(t.studentId)} state={state} />)}
              </div>
            )}
          </>
        )}
        <p className="msg-note">
          <Icon name="lock" size={15} />
          <span>Keskustelun näkevät vain sinä ja pelaaja. Viestit ovat käytössä {onCount === 1 ? '1 pelaajalle' : `${onCount} pelaajalle`}. <button type="button" className="k-textlink" onClick={() => setSetupOpen(true)}>Muuta</button></span>
        </p>
      </>
    );
  }
  return (
    <>
      <TopBar title="Viestit" back="/valmentaja/koti" />
      <Page className="msg-page k-page-pad">{content}</Page>
      {m.ready && m.enabled && (
        <>
          <MessagingSheet open={setupOpen} onClose={() => setSetupOpen(false)} />
          <PickSheet open={pickOpen} onClose={() => setPickOpen(false)} onSetup={() => setSetupOpen(true)} />
        </>
      )}
    </>
  );
}

/** For the player page: what a "Viesti" tap does when messages are not on for the player yet. */
export function TurnOnSheet({ open, onClose, student, onOn }) {
  const m = useMessages();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!student) return null;
  const turnOn = async () => {
    setBusy(true);
    try {
      await api.messages.setEnabled([student.id], true);
      await m.reload();
      track('viestit.kayttoon-pelaaja');
      onClose();
      onOn?.();
    } catch (err) { toast(err); } finally { setBusy(false); }
  };
  const first = (student.name || '').split(' ')[0];
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={`Viestit ${allative(student.name)}?`} size="sm"
      footer={<Button variant="dark" size="lg" block loading={busy} onClick={turnOn}>Ota käyttöön</Button>}>
      <div className="stack-3">
        <p className="msg-lead">Viestit ovat täysi-ikäisille pelaajille. Ottamalla ne käyttöön vahvistat, että {student.name} on täysi-ikäinen.</p>
        {student.isPlaceholder && <p className="msg-note"><Icon name="info" size={15} /><span>{first} ei ole vielä liittynyt Koutsiin. Viestit toimivat, kun hän liittyy.</span></p>}
      </div>
    </Sheet>
  );
}
