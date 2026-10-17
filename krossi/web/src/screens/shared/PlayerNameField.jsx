// PlayerNameField — a name in a logged result: type it, or tap a Krossi player (pelikaverit first).
//   <PlayerNameField id label optional icon placeholder value={{ name, person }} onChange={(next) => …}
//                    candidates={{ partners, players }|null} excludeIds={[]} linkedHint="…" />
//
// A tapped player is linked (value.person = PersonLite) and shows as a row with their face;
// × unlinks and empties the field. Typing always unlinks. Without candidates (unpaid, offline,
// nobody in the city) it is a plain text field, as before.
import { useMemo } from 'react';
import { firstName } from '../../lib/format.js';
import { rankCandidates } from '../../features/resultLinks.js';
import { Avatar, Field, IconButton, Input } from '../../ui/index.js';

const MAX_PICKS = 6;

export function PlayerNameField({ id, label, optional, icon = 'user', placeholder, value, onChange, candidates, excludeIds = [], linkedHint }) {
  const name = value?.name || '';
  const person = value?.person || null;
  const picks = useMemo(
    () => (person || !candidates ? [] : rankCandidates({ ...candidates, query: name, excludeIds, limit: MAX_PICKS })),
    // excludeIds is a fresh array on every render; its contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [person, candidates, name, excludeIds.join(',')],
  );

  if (person) {
    return (
      <Field label={label} optional={optional}>
        <div className="match-result-linked rise">
          <Avatar person={person} size={34} />
          <span className="match-result-linked-text">
            <span className="match-result-linked-name truncate">{name || person.name}</span>
            {linkedHint && <span className="match-result-linked-hint">{linkedHint}</span>}
          </span>
          <IconButton icon="close" size="sm" label={`Poista ${firstName(name || person.name)}`} onClick={() => onChange({ name: '', person: null })} />
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} optional={optional} htmlFor={id}>
      <Input id={id} icon={icon} placeholder={placeholder} value={name} maxLength={60} autoComplete="off" onChange={(e) => onChange({ name: e.target.value, person: null })} />
      {picks.length > 0 && (
        <div className="match-result-picks" role="group" aria-label={`Valitse ${label.toLocaleLowerCase('fi')} Krossista`}>
          {picks.map(({ person: p, gamesTogether }) => (
            <button key={p.id} type="button" className="match-result-pick" onClick={() => onChange({ name: p.name, person: p })}
              aria-label={gamesTogether ? `${p.name}, ${gamesTogether} yhteistä peliä` : p.name}>
              <Avatar person={p} size={24} />
              <span className="truncate">{firstName(p.name)}</span>
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}
