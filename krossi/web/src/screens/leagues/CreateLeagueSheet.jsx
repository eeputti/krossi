// CreateLeagueSheet — "Luo liiga": city, level and a season name (with suggestions).
//   <CreateLeagueSheet open onClose defaultCity defaultLevel onCreated={(id) => …} />
// Calls api.leagues.create; the creator is added as the first member by the backend.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { useBusy } from '../../app/hooks.js';
import { CITIES, SKILL_LEVELS } from '../../lib/constants.js';
import { Button, ChipSelect, Field, Icon, Input, Select, Sheet, useToast } from '../../ui/index.js';
import { MIN_MEMBERS_TO_START, seasonSuggestions } from './leagueUtils.js';

const STEPS = [
  { icon: 'share', text: 'Jaa liigan linkki kavereille ja seuran porukalle.' },
  { icon: 'users', text: `Kun mukana on ${MIN_MEMBERS_TO_START} pelaajaa, voit aloittaa kauden.` },
  { icon: 'grid', text: 'Lohkot ja ottelut arvotaan automaattisesti.' },
];

export function CreateLeagueSheet({ open, onClose, defaultCity, defaultLevel, onCreated }) {
  const toast = useToast();
  const [busy, run] = useBusy();
  const suggestions = useMemo(() => seasonSuggestions(new Date()), []);
  const [city, setCity] = useState(defaultCity || CITIES[0]);
  const [level, setLevel] = useState(defaultLevel || 'keskitaso');
  const [season, setSeason] = useState(suggestions[0]);
  const [error, setError] = useState('');

  // Fresh form every time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setCity(defaultCity || CITIES[0]);
    setLevel(defaultLevel || 'keskitaso');
    setSeason(suggestions[0]);
    setError('');
  }, [open, defaultCity, defaultLevel, suggestions]);

  const levelInfo = SKILL_LEVELS.find((s) => s.value === level);
  const cityOptions = CITIES.map((c) => ({ value: c, label: c }));

  const submit = () => run(async () => {
    const label = season.trim();
    if (!label) { setError('Anna kaudelle nimi, esim. "Syyskausi 2026".'); return; }
    setError('');
    try {
      const id = await api.leagues.create({ city, skillLevel: level, seasonLabel: label });
      onCreated?.(id);
    } catch (err) {
      toast(err);
    }
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Luo liiga"
      subtitle="Perusta kaupunkisi liiga — kausi alkaa, kun porukka on koossa."
      footer={(
        <Button variant="lime" size="lg" block icon="trophy" loading={busy} onClick={submit}>Luo liiga</Button>
      )}
    >
      <div className="leagues-create">
        <Field label="Kaupunki" htmlFor="league-city">
          <Select id="league-city" options={cityOptions} value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>

        <Field label="Taso" hint={levelInfo?.desc}>
          <ChipSelect ariaLabel="Taso" layout="grid" columns={2} options={SKILL_LEVELS} value={level} onChange={(v) => v && setLevel(v)} />
        </Field>

        <Field label="Kauden nimi" htmlFor="league-season" error={error}>
          <Input
            id="league-season"
            value={season}
            maxLength={40}
            placeholder="esim. Syyskausi 2026"
            onChange={(e) => { setSeason(e.target.value); if (error) setError(''); }}
          />
          <ChipSelect
            ariaLabel="Ehdotukset"
            size="sm"
            layout="scroll"
            className="leagues-create-suggest"
            options={suggestions.map((s) => ({ value: s, label: s }))}
            value={season.trim()}
            onChange={(v) => { if (v) { setSeason(v); setError(''); } }}
          />
        </Field>

        <div className="leagues-create-how">
          <div className="leagues-create-how-title">Mitä sitten?</div>
          <ol className="leagues-create-steps">
            {STEPS.map((s) => (
              <li key={s.icon}>
                <span className="leagues-create-step-icon"><Icon name={s.icon} size={16} /></span>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Sheet>
  );
}
