// recipients.jsx — who a note, homework or video is for. One tap per group adds its players (a
// second tap takes them off again), a name search, and a checkbox per player. With players
// already picked (after a session, from a group's page) it starts folded to one summary line.
// It goes last in its sheet, and its list grows with the sheet instead of scrolling inside it.
import { useEffect, useMemo, useState } from 'react';
import { Avatar, Input } from '../ui/index.js';
import { koutsiSortGroupsBySchedule } from '../domain/core.js';
import { firstName, matchStudents } from '../domain/roster.js';

const cx = (...c) => c.filter(Boolean).join(' ');

/** "Aino, Onni ja 2 muuta" */
export function recipientSummary(students, ids) {
  const names = ids.map((id) => students.find((s) => s.id === id)).filter(Boolean).map((s) => firstName(s.name) || s.name);
  if (names.length === 0) return 'Ei valittu';
  if (names.length <= 3) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} ja ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(', ')} ja ${names.length - 2} muuta`;
}

/**
 * RecipientPicker
 *   students: [{ id, name, … }]   groups: the coach's groups (for the one-tap picks)
 *   value: picked ids   onChange(ids)   open: the sheet is open (resets the fold)
 */
/*   boxed: the list scrolls in a box of its own (Merkitse, where the text field comes after it) */
export function RecipientPicker({ students, groups = [], value, onChange, open = true, boxed = false }) {
  const [expanded, setExpanded] = useState(value.length === 0);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!open) return;
    setExpanded(value.length === 0);
    setQuery('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const known = useMemo(() => new Set(students.map((s) => s.id)), [students]);
  const sortedGroups = useMemo(() => koutsiSortGroupsBySchedule(groups)
    .map((g) => ({ ...g, ids: g.memberIds.filter((id) => known.has(id)) }))
    .filter((g) => g.ids.length > 0), [groups, known]);
  const list = useMemo(() => {
    const base = query.trim() ? matchStudents(students, query, { limit: 60 }) : students.slice().sort((a, b) => a.name.localeCompare(b.name, 'fi'));
    return base;
  }, [students, query]);

  const picked = new Set(value);
  const toggle = (id) => onChange(picked.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  const groupOn = (g) => g.ids.every((id) => picked.has(id));
  const toggleGroup = (g) => onChange(groupOn(g) ? value.filter((id) => !g.ids.includes(id)) : [...new Set([...value, ...g.ids])]);

  if (!expanded) {
    const shown = value.map((id) => students.find((s) => s.id === id)).filter(Boolean);
    return (
      <div className="k-recipients-folded">
        <span className="k-recipients-avatars" aria-hidden="true">
          {shown.slice(0, 4).map((s) => <Avatar key={s.id} person={s} size={28} />)}
        </span>
        <span className="grow k-recipients-text">
          <strong>{value.length === 1 ? '1 pelaaja' : `${value.length} pelaajaa`}</strong>
          <span className="k-faint truncate">{recipientSummary(students, value)}</span>
        </span>
        <button type="button" className="k-textlink" onClick={() => setExpanded(true)}>Muuta</button>
      </div>
    );
  }
  return (
    <div className="stack-2">
      {sortedGroups.length > 0 && (
        <div className="k-recipient-groups" role="group" aria-label="Valitse ryhmä">
          {sortedGroups.map((g) => (
            <button key={g.id} type="button" className={cx('planner-chip', groupOn(g) && 'is-on')} aria-pressed={groupOn(g)} onClick={() => toggleGroup(g)}>
              {g.day} {g.time} {g.name}<span className="planner-chip-sub">{g.ids.length}</span>
            </button>
          ))}
        </div>
      )}
      {students.length > 8 && <Input icon="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hae nimellä" aria-label="Hae pelaajaa" />}
      <div className={cx('k-pick-list k-recipient-list', boxed && 'is-boxed')}>
        {list.map((s) => (
          <label key={s.id} className={cx('k-pick', picked.has(s.id) && 'is-on')}>
            <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
            <Avatar person={s} size={28} /><span className="truncate">{s.name}</span>
          </label>
        ))}
        {list.length === 0 && <p className="k-quiet">Ei osumia.</p>}
      </div>
    </div>
  );
}
