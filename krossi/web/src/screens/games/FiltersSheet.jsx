// FiltersSheet.jsx — city + match type + indoor/outdoor + surface + "Sopii tasolle".
//   <FiltersSheet open onClose value={filters} onApply={(filters) => …} homeCity countFor={(filters) => n} />
// Edits a draft; nothing changes in the list until "Näytä N peliä".
import { useEffect, useState } from 'react';
import { Button, ChipSelect, Field, Sheet } from '../../ui/index.js';
import { CITIES, COURT_SURFACES, MATCH_TYPES, SKILL_LEVELS } from '../../lib/constants.js';
import { EMPTY_FILTERS } from './gameUtils.js';

const MATCH_OPTIONS = MATCH_TYPES.map((m) => ({ value: m.value, label: m.label }));
const PLACE_OPTIONS = [
  { value: 'sisätennis', label: 'Sisällä', icon: 'home' },
  { value: 'ulkotennis', label: 'Ulkona', icon: 'sun' },
];
const SURFACE_OPTIONS = COURT_SURFACES.map((s) => ({ value: s.value, label: s.label }));
const LEVEL_OPTIONS = SKILL_LEVELS.map((s) => ({ value: s.value, label: s.label }));

export function FiltersSheet({ open, onClose, value, onApply, homeCity, countFor }) {
  const [draft, setDraft] = useState(value || EMPTY_FILTERS);
  useEffect(() => { if (open) setDraft(value || EMPTY_FILTERS); }, [open, value]);
  const set = (key, v) => setDraft((d) => ({ ...d, [key]: v }));
  const city = draft.city || homeCity;
  const count = countFor ? countFor({ ...draft, city }) : null;
  const reset = () => setDraft({ ...EMPTY_FILTERS, city: homeCity });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="md"
      title="Suodata pelejä"
      subtitle="Löydä peli, joka sopii juuri sinulle."
      className="games-filters"
      footer={(
        <div className="sheet-actions">
          <Button variant="soft" size="lg" onClick={reset}>Tyhjennä</Button>
          <Button variant="dark" size="lg" onClick={() => onApply({ ...draft, city: city === homeCity ? '' : city })}>
            {count == null ? 'Näytä pelit' : count === 0 ? 'Ei osumia' : `Näytä ${count} ${count === 1 ? 'peli' : 'peliä'}`}
          </Button>
        </div>
      )}
    >
      <div className="games-filters-body">
        <Field label="Kaupunki">
          <ChipSelect options={CITIES.map((c) => ({ value: c, label: c === homeCity ? `${c} (koti)` : c }))} value={city} onChange={(v) => set('city', v)} size="sm" ariaLabel="Kaupunki" />
        </Field>
        <Field label="Pelimuoto">
          <ChipSelect options={MATCH_OPTIONS} value={draft.matchTypes} onChange={(v) => set('matchTypes', v)} multiple ariaLabel="Pelimuoto" />
        </Field>
        <Field label="Sisällä vai ulkona">
          <ChipSelect options={PLACE_OPTIONS} value={draft.locationTypes} onChange={(v) => set('locationTypes', v)} multiple ariaLabel="Sisällä vai ulkona" />
        </Field>
        <Field label="Kenttäpinta">
          <ChipSelect options={SURFACE_OPTIONS} value={draft.surfaces} onChange={(v) => set('surfaces', v)} multiple ariaLabel="Kenttäpinta" />
        </Field>
        <Field label="Sopii tasolle" hint="Piilottaa pelit, joiden minimitaso on korkeampi kuin valitsemasi.">
          <ChipSelect options={LEVEL_OPTIONS} value={draft.level} onChange={(v) => set('level', v)} allowEmpty ariaLabel="Sopii tasolle" />
        </Field>
      </div>
    </Sheet>
  );
}
