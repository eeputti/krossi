// MatchHistorySheet — every logged result with edit / delete, plus "Lisää tulos".
//   <MatchHistorySheet open onClose results={MatchResult[]} onEdit={(result) => …} onDelete={(result) => Promise} onAdd={fn} />
import { useMemo, useState } from 'react';
import { Button, EmptyState, Segmented, Sheet } from '../../ui/index.js';
import { plural } from '../../lib/format.js';
import { ResultCard } from './ResultCard.jsx';
import { resultOutcome } from './matchResult.js';

const FILTERS = [
  { value: 'all', label: 'Kaikki' },
  { value: 'win', label: 'Voitot' },
  { value: 'loss', label: 'Tappiot' },
];

export function MatchHistorySheet({ open, onClose, results = [], onEdit, onDelete, onAdd }) {
  const [filter, setFilter] = useState('all');
  const [deleting, setDeleting] = useState(null);
  const wins = useMemo(() => results.filter((r) => resultOutcome(r) === 'win').length, [results]);
  const shown = filter === 'all' ? results : results.filter((r) => resultOutcome(r) === filter);

  const remove = async (result) => {
    setDeleting(result.id);
    try { await onDelete?.(result); } finally { setDeleting(null); }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title="Pelihistoria"
      subtitle={results.length ? `${plural(results.length, 'ottelu', 'ottelua')} · ${plural(wins, 'voitto', 'voittoa')}` : null}
      footer={<Button variant="lime" size="lg" block icon="plus" onClick={onAdd}>Lisää tulos</Button>}
    >
      {results.length > 0 && (
        <Segmented ariaLabel="Näytä" size="sm" options={FILTERS} value={filter} onChange={setFilter} className="profile-history-filter" />
      )}
      {results.length === 0 ? (
        <EmptyState art="trophy" title="Ei vielä tuloksia" text="Kirjaa ensimmäinen matsisi, niin voitot ja putket alkavat kertyä." />
      ) : shown.length === 0 ? (
        <EmptyState compact art="racket" title={filter === 'win' ? 'Ei vielä voittoja' : 'Ei tappioita — hyvä sinä!'} text={filter === 'win' ? 'Seuraava matsi voi olla se.' : 'Pidä tahti yllä.'} />
      ) : (
        <div className="profile-history-list stagger">
          {shown.map((r, i) => (
            <ResultCard
              key={r.id}
              result={r}
              style={{ '--i': i }}
              actions={(
                <>
                  <Button variant="ghost" size="sm" icon="edit" onClick={() => onEdit?.(r)}>Muokkaa</Button>
                  <Button variant="ghost" size="sm" icon="trash" className="profile-danger-text" loading={deleting === r.id} onClick={() => remove(r)}>Poista</Button>
                </>
              )}
            />
          ))}
        </div>
      )}
    </Sheet>
  );
}
