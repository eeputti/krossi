// PlanScreen — "Suunnittele" (a side-nav tab on a computer): the coming weeks planned ahead in
// one place. Teemat = the theme grid (many groups × many weeks at once), Poissaolot = one player
// away from many sessions, Kausi = the season's end, the next season ("Uusi kausi") and the
// calendars. ?osio= keeps the part in the address.
import { useMemo, useState } from 'react';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Button, Icon, Page, Segmented } from '../ui/index.js';
import { koutsiFmtShortDate, koutsiIsoWeekOfDateStr, koutsiTodayStr } from '../domain/core.js';
import { calendarEndings, weekParam } from '../domain/week.js';
import { currentSeason, draftSummary, followingSeason, groupsOfSeason, nextSeasonPreset, seasonWord } from '../domain/season.js';
import { ThemeGrid } from './ThemeGrid.jsx';
import { AbsencePlannerPanel } from './AbsencePlanner.jsx';
import { SeasonEditSheet } from './SeasonSheet.jsx';
import { ExtendCalendarSheet } from './groupForms.jsx';
import { openSeason } from './nav.js';
import { track } from './usage.js';

const PARTS = [
  { value: 'teemat', label: 'Teemat' },
  { value: 'poissaolot', label: 'Poissaolot' },
  { value: 'kausi', label: 'Kausi' },
];
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);

function SeasonPanel() {
  const { state } = useData();
  const [editOpen, setEditOpen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const today = koutsiTodayStr();
  const season = state.seasonsReady ? currentSeason(state) : null;
  const next = season ? followingSeason(state, season) : null;
  const draft = season && state.seasonDraft && state.seasonDraft.fromSeasonId === season.id ? state.seasonDraft : null;
  const preset = next || draft || (season ? nextSeasonPreset(season) : null);
  const changes = draft ? draftSummary(state, draft).changes : 0;
  const lasts = useMemo(() => calendarEndings(state, 400).filter((e) => e.group), [state]);
  const ending = lasts.filter((e) => !e.last || daysBetween(today, e.last) <= 42);
  const weeksLeft = season && season.endsOn >= today ? Math.floor(daysBetween(today, season.endsOn) / 7) : 0;

  return (
    <div className="pl-season">
      {season && (
        <div className="pl-cards">
          <div className="pl-card">
            <div className="eyebrow">Nyt menossa</div>
            <div className="pl-card-title">{season.name}</div>
            <p className="pl-card-text t-num">{koutsiFmtShortDate(season.startsOn)}–{koutsiFmtShortDate(season.endsOn)} · {groupsOfSeason(state, season).length} ryhmää{weeksLeft > 0 ? ` · ${weeksLeft} viikkoa jäljellä` : ''}</p>
            <div className="row wrap">
              <Button variant="outline" size="sm" icon="calendar" onClick={() => setEditOpen(true)}>Muuta {seasonWord(season.startsOn, 'gen')} loppua</Button>
            </div>
          </div>
          <div className={`pl-card ${next ? '' : 'is-dark'}`}>
            <div className="eyebrow">Seuraava kausi</div>
            {next ? (
              <>
                <div className="pl-card-title"><Icon name="check" size={18} /> {next.name} on julkaistu</div>
                <p className="pl-card-text">Alkaa {koutsiFmtShortDate(next.startsOn)} · {groupsOfSeason(state, next).length} ryhmää.</p>
                <Button variant="outline" size="sm" icon="calendar" onClick={() => navigate(`/valmentaja/ryhmat?vko=${weekParam(koutsiIsoWeekOfDateStr(next.startsOn))}`)}>Kauden ensimmäinen viikko</Button>
              </>
            ) : (
              <>
                <div className="pl-card-title">{draft ? `${draft.name} · luonnos` : `${preset.name || 'Uusi kausi'}`}</div>
                <p className="pl-card-text">
                  {draft
                    ? `${changes === 1 ? '1 muutos' : `${changes} muutosta`} tallessa. Pelaajat eivät näe luonnosta ennen kuin julkaiset.`
                    : `Tee ${seasonWord(preset.startsOn, 'gen')} ryhmät valmiiksi jo nyt: ryhmät ja pelaajat jatkavat sellaisinaan, muutat vain sen mikä muuttuu. Pelaajat näkevät ${seasonWord(preset.startsOn, 'gen')} vasta kun julkaiset.`}
                </p>
                <Button variant="lime" size="md" icon={draft ? 'edit' : 'calendar-plus'} onClick={() => { track('suunnittele.uusi-kausi'); openSeason(); }}>
                  {draft ? 'Jatka suunnittelua' : `Suunnittele ${seasonWord(preset.startsOn)}`}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="pl-card">
        <div className="row-between">
          <div>
            <div className="eyebrow">Kalenterit</div>
            <div className="pl-card-title">Mihin asti treenit ovat kalenterissa</div>
          </div>
          {ending.length > 0 && <Button variant="dark" size="sm" icon="repeat" onClick={() => setExtendOpen(true)}>Jatka kalenteria</Button>}
        </div>
        <div className="pl-cal-list">
          {lasts.map((e) => (
            <div key={e.group.id} className={`pl-cal-row ${ending.includes(e) ? 'is-ending' : ''}`}>
              <span className="t-num pl-cal-when">{e.group.day} {e.group.time}</span>
              <span className="grow truncate">{e.group.name}</span>
              <span className="t-num pl-cal-last">{e.last ? `viimeinen ${koutsiFmtShortDate(e.last)}` : 'ei treenejä'}</span>
            </div>
          ))}
        </div>
        {ending.length === 0 && <p className="k-faint">Kaikkien ryhmien treenit jatkuvat yli kuusi viikkoa.</p>}
      </div>

      {season && <SeasonEditSheet open={editOpen} onClose={() => setEditOpen(false)} season={season} />}
      <ExtendCalendarSheet open={extendOpen} onClose={() => setExtendOpen(false)} groups={ending.map((e) => e.group)} />
    </div>
  );
}

export function PlanScreen({ query }) {
  const part = PARTS.some((p) => p.value === query.osio) ? query.osio : 'teemat';
  const setPart = (value) => { track(`suunnittele.${value}`); navigate(`/valmentaja/suunnittele?osio=${value}`, { replace: true }); };
  return (
    <Page width="full" className="pl-page">
      <header className="pl-head">
        <div>
          <div className="eyebrow">Suunnittele</div>
          <h1 className="pl-title">Tulevat viikot</h1>
        </div>
        <Segmented ariaLabel="Suunnittele" value={part} onChange={setPart} options={PARTS} />
      </header>
      {part === 'teemat' && <ThemeGrid />}
      {part === 'poissaolot' && <AbsencePlannerPanel />}
      {part === 'kausi' && <SeasonPanel />}
    </Page>
  );
}
