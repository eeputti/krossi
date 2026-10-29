// playerForms.jsx — adding and editing players, notes and homework, video audiences, merging
// duplicates, and a not-yet-joined player's personal invite.
import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Avatar, Button, ChipSelect, Field, Icon, Input, Sheet, Spinner, Textarea } from '../ui/index.js';
import { CopyButton, QrCode, ShareTextButton } from '../shared/bits.jsx';
import { optionalAge } from '../shared/fields.jsx';
import { koutsiInviteLink, koutsiInviteMessage } from '../domain/core.js';
import { exactNameMatch, firstName, matchStudents, mergeSides } from '../domain/roster.js';
import { LEVELS } from '../lib/constants.js';
import { useCoach } from './CoachRoot.jsx';
import { playerPath } from './nav.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const HEALTH_NOTE = 'Älä kirjoita vammoja, sairauksia, diagnooseja, lääkityksiä tai muita terveystietoja.';

function LevelPicker({ value, onChange }) {
  return <ChipSelect size="sm" allowEmpty options={LEVELS.map((l) => ({ value: l, label: l }))} value={value} onChange={onChange} ariaLabel="Taso" />;
}

/** Add a player by name — the coach can start right away; the player claims the profile later. */
export function AddPlayerSheet({ open, onClose }) {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [level, setLevel] = useState('');
  const [groupId, setGroupId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(''); setAge(''); setLevel(''); setGroupId(''); } }, [open]);
  const exact = exactNameMatch(state.students, name);
  const suggestions = matchStudents(state.students, name);
  const { age: parsedAge, valid } = optionalAge(age);
  const ready = name.trim() && valid && !exact && !busy;
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    let res;
    if (groupId) {
      const ref = 'picked-group';
      res = await run(() => api.students.bulkSetup(coachId, {
        groups: [{ client_id: ref, existing_id: groupId }],
        players: [{ name: name.trim(), age: parsedAge, level: level || null, group_refs: [ref] }], themes: [],
      }), `${name.trim()} lisätty ryhmään.`, { waitForRefresh: true });
    } else {
      res = await run(() => api.students.create(coachId, { name: name.trim(), age: parsedAge, level: level || null }), `${name.trim()} lisätty.`, { waitForRefresh: true });
    }
    setBusy(false);
    if (res.ok) {
      onClose();
      const id = groupId ? res.result?.players?.[0]?.id : res.result;
      if (id) navigate(playerPath(id));
    }
  };
  const groupOptions = state.groups.map((g) => ({ value: g.id, label: `${g.day} ${g.time}, ${g.name}` }));
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Lisää pelaaja" subtitle="Nimi riittää. Pelaaja voi liittyä myöhemmin omalla linkillään." size="md" dismissible={!busy} confirmClose={Boolean(name.trim())}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button><Button variant="dark" size="lg" missing={!name.trim() ? 'Kirjoita pelaajan nimi.' : !valid ? 'Iän pitää olla 1–119 vuotta.' : exact ? `Sinulla on jo pelaaja nimeltä ${exact.name}. Erota nimet toisistaan.` : null} loading={busy} onClick={submit}>Lisää</Button></div>}>
      <div className="stack-4">
        <Field label="Nimi" htmlFor="p-name">
          <Input id="p-name" size="lg" value={name} onChange={(e) => setName(e.target.value)} placeholder="Esim. Onni Virtanen" maxLength={120} autoComplete="off" />
        </Field>
        {suggestions.length > 0 && (
          <div className="k-suggest">
            <div className="field-msg">{exact ? 'Tämä on jo listallasi:' : 'Löytyykö hän jo listaltasi?'}</div>
            {suggestions.map((s) => (
              <button key={s.id} type="button" className="k-suggest-row" onClick={() => { onClose(); navigate(playerPath(s.id)); }}>
                <Avatar person={s} size={26} /><span className="grow truncate">{s.name}</span><Icon name="chevron-right" size={16} />
              </button>
            ))}
            {exact && <p className="k-warn-text">Sinulla on jo tismalleen tämän niminen pelaaja. Avaa hänet yllä — jos tämä on eri henkilö, erota nimet (esim. sukunimen alkukirjaimella).</p>}
          </div>
        )}
        <Field label="Ikä" optional htmlFor="p-age" error={!valid ? 'Iän pitää olla 1–119 vuotta.' : null}>
          <Input id="p-age" value={age} onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} inputMode="numeric" placeholder="Esim. 14" />
        </Field>
        <Field label="Taso" optional><LevelPicker value={level} onChange={setLevel} /></Field>
        {groupOptions.length > 0 && (
          <Field label="Ryhmä" optional>
            <ChipSelect size="sm" allowEmpty options={groupOptions} value={groupId} onChange={setGroupId} ariaLabel="Ryhmä" />
          </Field>
        )}
        <p className="field-msg">{HEALTH_NOTE}</p>
      </div>
    </Sheet>
  );
}

/** Name, age and level of a player who hasn't joined yet (after joining they are the player's own). */
export function EditPlaceholderSheet({ open, onClose, student }) {
  const { state, run } = useData();
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [level, setLevel] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && student) { setName(student.name || ''); setAge(student.age == null ? '' : String(student.age)); setLevel(student.level || ''); } }, [open, student]);
  if (!student) return null;
  const exact = exactNameMatch(state.students, name, { excludeIds: [student.id] });
  const { age: parsedAge, valid } = optionalAge(age);
  const ready = name.trim() && valid && !exact && !busy;
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    const res = await run(() => api.students.updatePlaceholder(student.id, { name: name.trim(), age: parsedAge, level: level || null }), 'Tiedot päivitetty.');
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Muokkaa perustietoja" subtitle={`${student.name} ei ole vielä liittynyt, joten voit muokata näitä hänen puolestaan.`} size="md" dismissible={!busy}
      confirmClose={name.trim() !== (student.name || '').trim() || age !== (student.age == null ? '' : String(student.age)) || level.trim() !== (student.level || '').trim() ? { title: 'Hylätäänkö muutokset?', message: 'Tietoja ei ole vielä tallennettu.' } : false}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button><Button variant="dark" size="lg" missing={!name.trim() ? 'Kirjoita pelaajan nimi.' : !valid ? 'Iän pitää olla 1–119 vuotta.' : exact ? `Sinulla on jo pelaaja nimeltä ${exact.name}. Erota nimet toisistaan.` : null} loading={busy} onClick={submit}>Tallenna</Button></div>}>
      <div className="stack-4">
        <Field label="Nimi" htmlFor="e-name" error={exact ? `Sinulla on jo toinen pelaaja nimeltä ${exact.name}. Erota nimet toisistaan.` : null}>
          <Input id="e-name" size="lg" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Ikä" optional htmlFor="e-age" error={!valid ? 'Iän pitää olla 1–119 vuotta.' : null}>
          <Input id="e-age" value={age} onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} inputMode="numeric" />
        </Field>
        <Field label="Taso" optional><LevelPicker value={level} onChange={setLevel} /></Field>
      </div>
    </Sheet>
  );
}

/** A coach's note or a homework: one text, a health-data reminder, never lost on a stray tap. */
export function TextEntrySheet({ open, onClose, title, subtitle, initial = '', placeholder, saveLabel = 'Tallenna', onSave }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setText(initial || ''); }, [open, initial]);
  const dirty = text.trim() !== (initial || '').trim();
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const ok = await onSave(text.trim());
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={title} subtitle={subtitle} size="md" dismissible={!busy} confirmClose={dirty}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button><Button variant="dark" size="lg" missing={!text.trim() ? 'Kirjoita teksti ensin.' : null} loading={busy} onClick={submit}>{saveLabel}</Button></div>}>
      <div className="stack-3">
        <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} autoFocus maxLength={4000} aria-label={title} />
        <p className="k-warn-text">{HEALTH_NOTE}</p>
      </div>
    </Sheet>
  );
}

/** Who sees a shared video. */
export function AudienceSheet({ open, onClose, video }) {
  const { state, run } = useData();
  const [ids, setIds] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && video) setIds(video.recipientIds || []); }, [open, video]);
  if (!video) return null;
  const submit = async () => {
    if (!ids.length || busy) return;
    setBusy(true);
    const res = await run(() => api.videos.setRecipients(video.shareId, ids), 'Videon näkyvyys päivitetty.');
    setBusy(false);
    if (res.ok) onClose();
  };
  const players = state.students.slice().sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Kuka näkee videon" subtitle={video.title} size="md"
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button><Button variant="dark" size="lg" missing={!ids.length ? 'Valitse ainakin yksi pelaaja.' : null} loading={busy} onClick={submit}>Tallenna</Button></div>}>
      <div className="k-pick-list">
        {players.map((s) => (
          <label key={s.id} className={cx('k-pick', ids.includes(s.id) && 'is-on')}>
            <input type="checkbox" checked={ids.includes(s.id)} onChange={() => setIds((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))} />
            <Avatar person={s} size={28} /><span className="truncate">{s.name}</span>
          </label>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * Merge two profiles of one real player. Which side is picked where doesn't matter: the side
 * that hasn't claimed an account is the one removed, and everything moves onto the other.
 */
export function MergeSheet({ open, onClose, student }) {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const [otherId, setOtherId] = useState(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setOtherId(null); setQuery(''); } }, [open]);
  if (!student) return null;
  const other = state.students.find((s) => s.id === otherId) || null;
  const sides = mergeSides(student, other);
  const matches = query.trim() ? matchStudents(state.students, query, { excludeIds: [student.id], limit: 8 }) : [];
  const submit = async () => {
    if (!sides || busy) return;
    setBusy(true);
    const res = await run(() => api.students.merge(coachId, sides.keep.id, sides.remove.id), `${sides.remove.name} yhdistettiin pelaajaan ${sides.keep.name}.`);
    setBusy(false);
    if (res.ok) { onClose(); navigate(playerPath(sides.keep.id), { replace: true }); }
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Yhdistä toiseen pelaajaan" subtitle="Kahdesta profiilista jää yksi. Ryhmät, treenit ja merkinnät siirtyvät sille — mitään ei häviä." size="md"
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button><Button variant="dark" size="lg" missing={!sides ? 'Hae ja valitse pelaaja, johon yhdistetään.' : null} loading={busy} onClick={submit}>Yhdistä</Button></div>}>
      <div className="stack-4">
        <div className="k-merge">
          <div className="k-merge-side"><Avatar person={student} size={32} /><span className="truncate">{student.name}</span></div>
          <Icon name="arrow-right" size={18} />
          {other ? (
            <button type="button" className="k-merge-side is-picked" onClick={() => setOtherId(null)}><Avatar person={other} size={32} /><span className="truncate">{other.name}</span><Icon name="close" size={14} /></button>
          ) : <span className="k-merge-side is-empty">Valitse pelaaja</span>}
        </div>
        {!other && (
          <>
            <Input icon="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hae nimellä" aria-label="Hae pelaajaa" autoFocus />
            <div className="k-suggest">
              {matches.map((s) => (
                <button key={s.id} type="button" className="k-suggest-row" onClick={() => setOtherId(s.id)}>
                  <Avatar person={s} size={26} /><span className="grow truncate">{s.name}</span>{s.isPlaceholder && <span className="k-faint">ei liittynyt</span>}
                </button>
              ))}
            </div>
          </>
        )}
        {other && sides && <p className="k-quiet-text"><strong>{sides.remove.name}</strong> poistuu, ja hänen tietonsa siirtyvät pelaajalle <strong>{sides.keep.name}</strong>.</p>}
        {other && !sides && <p className="field-msg field-msg-error">Kumpikin on jo liittynyt omalla tilillään, joten tietoja ei voi yhdistää automaattisesti.</p>}
      </div>
    </Sheet>
  );
}

/** A not-yet-joined player's own join code, link and ready message (works for minors too). */
export function PlaceholderInvite({ student }) {
  const { state } = useData();
  const [code, setCode] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setCode(null); setError('');
    api.students.placeholderJoinCode(student.id)
      .then((c) => { if (!alive) return; if (c) setCode(c); else setError('Liittymiskoodia ei löytynyt. Päivitä sivu.'); })
      .catch((err) => { if (alive) setError(err.userMessage); });
    return () => { alive = false; };
  }, [student.id]);
  const name = firstName(student.name) || 'Pelaaja';
  const link = code ? koutsiInviteLink(code, student.id) : '';
  const message = code ? koutsiInviteMessage(code, state.coach.name, null, student.id) : '';
  return (
    <div className="k-placeholder">
      <div className="k-placeholder-head"><Icon name="info" size={16} /><span>Ei vielä liittynyt</span></div>
      <p className="k-quiet-text">{name} ei ole vielä liittynyt Koutsiin. Voit silti kirjata hänelle treenejä, huomioita ja läksyjä — ne siirtyvät hänelle, kun hän liittyy omalla linkillään.</p>
      {error && <p className="field-msg field-msg-error">{error}</p>}
      {!code && !error && <Spinner size={18} />}
      {code && (
        <div className="k-placeholder-code">
          <QrCode text={link} size={112} />
          <div className="stack-2 grow">
            <div className="field-label">{name}n oma koodi</div>
            <div className="k-code">{code}</div>
            <div className="row wrap">
              <ShareTextButton text={message} title="Liity Koutsiin" label="Lähetä linkki" />
              <CopyButton text={link} label="Kopioi linkki" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
