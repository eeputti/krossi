// CreateLeagueSheet — "Luo liiga": Krossi-liiga (city, level, season name) or a hallisarja
// (rounds with dates, group size, timed matches, venue, rules, public standings, does the
// organiser play). The creator becomes the league's admin.
//   <CreateLeagueSheet open onClose defaultCity defaultLevel onCreated={(id, format) => …} />
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { useBusy } from '../../app/hooks.js';
import { CITIES, SKILL_LEVELS } from '../../lib/constants.js';
import {
  Button, ChipSelect, Field, Icon, IconButton, Input, Segmented, Select, Sheet, Stepper, Textarea, Toggle, useToast,
} from '../../ui/index.js';
import {
  ALL_LEVELS, FORMATS, LEAGUE_LEVELS, MATCH_FORMATS, MIN_MEMBERS_TO_START, roundAfter, seasonSuggestions, suggestRounds,
} from './leagueUtils.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const MAX_ROUNDS = 8;

const LADDER_STEPS = [
  { icon: 'share', text: 'Jaa liigan linkki kavereille ja seuran porukalle.' },
  { icon: 'users', text: `Kun mukana on ${MIN_MEMBERS_TO_START} pelaajaa, voit aloittaa kauden.` },
  { icon: 'grid', text: 'Lohkot ja ottelut arvotaan automaattisesti.' },
];
const HALL_STEPS = [
  { icon: 'share', text: 'Jaa sarjan linkki hallin pelaajille — he ilmoittautuvat itse.' },
  { icon: 'grid', text: 'Jaa lohkot (Krossi ehdottaa tason mukaan) ja aloita 1. kierros.' },
  { icon: 'repeat', text: 'Kierrosten välissä voittaja nousee ja viimeinen putoaa — Krossi ehdottaa uudet lohkot.' },
  { icon: 'shield', text: 'Olet sarjan ylläpitäjä: kirjaat luovutukset ja päätät kierrokset.' },
];

export function CreateLeagueSheet({ open, onClose, defaultCity, defaultLevel, onCreated }) {
  const toast = useToast();
  const [busy, run] = useBusy();
  const [format, setFormat] = useState('ladder');
  const hall = format === 'hallisarja';
  const suggestions = useMemo(() => seasonSuggestions(new Date(), format), [format]);
  const [city, setCity] = useState(defaultCity || CITIES[0]);
  const [level, setLevel] = useState(defaultLevel || 'keskitaso');
  const [season, setSeason] = useState(suggestions[0]);
  const [matchFormat, setMatchFormat] = useState('timed');
  const [groupSize, setGroupSize] = useState(5);
  const [venue, setVenue] = useState('');
  const [description, setDescription] = useState('');
  const [rounds, setRounds] = useState(() => suggestRounds(new Date(), 3));
  const [organizerPlays, setOrganizerPlays] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState('');

  // Fresh form every time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setFormat('ladder');
    setCity(defaultCity || CITIES[0]);
    setLevel(defaultLevel || 'keskitaso');
    setSeason(seasonSuggestions(new Date(), 'ladder')[0]);
    setMatchFormat('timed');
    setGroupSize(5);
    setVenue('');
    setDescription('');
    setRounds(suggestRounds(new Date(), 3));
    setOrganizerPlays(false);
    setIsPublic(false);
    setError('');
  }, [open, defaultCity, defaultLevel]);

  const changeFormat = (f) => {
    setFormat(f);
    setSeason(seasonSuggestions(new Date(), f)[0]);
    if (f === 'hallisarja') setLevel(ALL_LEVELS);
    else if (level === ALL_LEVELS) setLevel(defaultLevel || 'keskitaso');
    setError('');
  };

  const levels = hall ? LEAGUE_LEVELS : SKILL_LEVELS;
  const levelInfo = levels.find((s) => s.value === level);
  const cityOptions = CITIES.map((c) => ({ value: c, label: c }));
  const badRound = rounds.findIndex((r) => !r.startsOn || !r.endsOn || r.endsOn < r.startsOn);
  const setRound = (i, key, value) => setRounds((list) => list.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  const submit = () => run(async () => {
    const label = season.trim();
    if (!label) { setError('Anna kaudelle nimi, esim. "Syyskausi 2026".'); return; }
    if (hall && badRound >= 0) { toast(`Tarkista ${badRound + 1}. kierroksen päivämäärät.`); return; }
    setError('');
    try {
      const id = await api.leagues.create(hall
        ? {
          format, city, skillLevel: level, seasonLabel: label, matchFormat, groupSize, venue, description, rounds, organizerPlays, isPublic,
        }
        : { city, skillLevel: level, seasonLabel: label });
      onCreated?.(id, format);
    } catch (err) {
      toast(err);
    }
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Luo liiga"
      subtitle={hall
        ? 'Hallisarja pelataan kierroksina — sinä jaat lohkot, pelaajat sopivat ajat keskenään.'
        : 'Perusta kaupunkisi liiga — kausi alkaa, kun porukka on koossa.'}
      footer={(
        <Button variant="lime" size="lg" block icon="trophy" loading={busy} onClick={submit}>{hall ? 'Luo hallisarja' : 'Luo liiga'}</Button>
      )}
    >
      <div className="leagues-create">
        <div className="leagues-create-format">
          <Segmented ariaLabel="Liigan muoto" options={FORMATS} value={format} onChange={changeFormat} />
          <p className="leagues-create-format-hint">
            {hall
              ? 'Kuten hallien hallisarjat: 4–6 pelaajan lohkot, tunnin aikapeli, nousut ja putoamiset kierrosten välissä.'
              : 'Yksi kausi, lohkot arvotaan kerran ja pelataan erät. Sopii kaveriporukalle.'}
          </p>
        </div>

        <Field label="Kaupunki" htmlFor="league-city">
          <Select id="league-city" options={cityOptions} value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>

        <Field label="Taso" hint={levelInfo?.desc}>
          <ChipSelect ariaLabel="Taso" layout="grid" columns={2} options={levels} value={level} onChange={(v) => v && setLevel(v)} />
        </Field>

        <Field label={hall ? 'Sarjan nimi' : 'Kauden nimi'} htmlFor="league-season" error={error}>
          <Input
            id="league-season"
            value={season}
            maxLength={60}
            placeholder={hall ? 'esim. Hallisarja 2026–27, yleinen' : 'esim. Syyskausi 2026'}
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

        {hall && (
          <>
            <Field label="Pelimuoto" hint={MATCH_FORMATS.find((m) => m.value === matchFormat)?.hint}>
              <ChipSelect ariaLabel="Pelimuoto" layout="grid" columns={2} options={MATCH_FORMATS.map(({ value, label }) => ({ value, label }))} value={matchFormat} onChange={(v) => v && setMatchFormat(v)} />
            </Field>

            <div className="leagues-create-size">
              <span className="leagues-create-size-text">
                <span className="leagues-create-size-label">Lohkon koko</span>
                <span className="leagues-create-size-hint">Tavoite; voit muuttaa jokaisella kierroksella.</span>
              </span>
              <Stepper value={groupSize} onChange={setGroupSize} min={3} max={8} label="Lohkon koko" />
            </div>

            <div className="leagues-create-rounds">
              <div className="leagues-create-rounds-head">
                <span className="leagues-create-size-label">Kierrokset</span>
                <span className="leagues-create-size-hint">Ehdotus: 8 viikkoa, 2 viikon tauko välissä.</span>
              </div>
              {rounds.map((r, i) => (
                <div key={i} className={cx('leagues-create-round', badRound === i && 'is-error')}>
                  <span className="leagues-create-round-num t-num">{i + 1}.</span>
                  <Input type="date" aria-label={`${i + 1}. kierros alkaa`} value={r.startsOn} onChange={(e) => setRound(i, 'startsOn', e.target.value)} />
                  <span className="leagues-create-round-dash" aria-hidden="true">–</span>
                  <Input type="date" aria-label={`${i + 1}. kierros päättyy`} value={r.endsOn} min={r.startsOn} onChange={(e) => setRound(i, 'endsOn', e.target.value)} />
                  {rounds.length > 1 && <IconButton icon="close" size="sm" label={`Poista ${i + 1}. kierros`} onClick={() => setRounds((l) => l.filter((_, j) => j !== i))} />}
                </div>
              ))}
              {rounds.length < MAX_ROUNDS && (
                <Button variant="soft" size="sm" icon="plus" onClick={() => setRounds((l) => [...l, roundAfter(l[l.length - 1])])}>Lisää kierros</Button>
              )}
            </div>

            <Field label="Pelipaikka" optional htmlFor="league-venue">
              <Input id="league-venue" value={venue} maxLength={120} placeholder="esim. Kispi-areena tai Janus-areena" onChange={(e) => setVenue(e.target.value)} />
            </Field>
            <Field label="Säännöt ja lisätiedot" optional htmlFor="league-desc" hint="Esim. kenttämaksu puoliksi, tulos 24 h kuluessa, pallot.">
              <Textarea id="league-desc" value={description} maxLength={2000} rows={3} onChange={(e) => setDescription(e.target.value)} />
            </Field>

            <Toggle checked={organizerPlays} onChange={setOrganizerPlays} icon="racket" label="Pelaan itse sarjassa" hint="Muuten olet pelkkä ylläpitäjä (sarjavastaava)." />
            <Toggle
              checked={isPublic}
              onChange={setIsPublic}
              icon="eye"
              label="Julkinen sarjataulukko"
              hint='Lohkot ja tulokset näkyvät linkillä ilman tiliä (nimet muodossa "Mikko V."), esim. hallin nettisivuilla.'
            />
          </>
        )}

        <div className="leagues-create-how">
          <div className="leagues-create-how-title">Mitä sitten?</div>
          <ol className="leagues-create-steps">
            {(hall ? HALL_STEPS : LADDER_STEPS).map((s) => (
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
