// ProfileScreen (coach) — who the coach is, notifications, tools that aren't weekly work
// (drill bank, bulk setup, annual plans, Ylläpito), and account settings. A tap on the name opens
// Muokkaa profiilia (/valmentaja/profiili/muokkaa); a tap on the photo opens Valitse kuva / Ota uusi kuva.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Button, Card, Icon, ListRow, Page, PageHeader, Sheet, useToast } from '../ui/index.js';
import { AccountSection, EmailPrefs } from '../shared/account.jsx';
import { ProfileCard } from '../shared/profileCard.jsx';
import { useCoach } from './CoachRoot.jsx';
import { BulkSetupSheet } from './BulkSetupSheet.jsx';
import { bankSummary } from './ExercisesScreen.jsx';
import { openSeason } from './nav.js';
import { SeasonEditSheet } from './SeasonSheet.jsx';
import { JoinCodesSheet } from './JoinCodesSheet.jsx';
import { SubscriptionCard } from './SubscriptionCard.jsx';
import { joinedTotals } from '../domain/groupLinks.js';
import { currentSeason, followingSeason, seasonWord } from '../domain/season.js';
import { koutsiFmtShortDate, koutsiIsoWeekOfDateStr } from '../domain/core.js';
import { weekParam } from '../domain/week.js';

function SharedPlanSheet({ open, onClose }) {
  const { coachId } = useCoach();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState([]);
  const ref = useRef(null);
  useEffect(() => { if (open) api.plans.submissions(coachId).then(setList).catch(() => setList([])); }, [open, coachId]);
  const upload = async (file) => {
    setBusy(true);
    try {
      await api.plans.uploadShared(coachId, file);
      toast('Vuosisuunnitelma lähetetty — viemme teemat Koutsiin ja ilmoitamme, kun ne ovat valmiina.');
      setList(await api.plans.submissions(coachId));
    } catch (err) { toast(err); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Lähetä vuosisuunnitelma" subtitle="Jos sinulla on usean ryhmän viikkoteemat Excelissä, lähetä se meille — viemme teemat Koutsiin puolestasi." size="md">
      <div className="stack-4">
        <Button as="label" variant="dark" icon="download" loading={busy}>Valitse Excel (.xlsx)
          <input ref={ref} type="file" accept=".xlsx" className="sr-only" tabIndex={-1} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
        </Button>
        {list.length > 0 && (
          <div className="stack-2">
            <div className="field-label">Lähetetyt</div>
            {list.map((s) => (
              <div key={s.id} className="k-file-row"><Icon name="list" size={16} /><span className="grow truncate">{s.filename}</span><span className="chip chip-sm chip-neutral">{s.status === 'pending' ? 'Käsittelyssä' : 'Käsitelty'}</span></div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

export function ProfileScreen() {
  const { state } = useData();
  const { uid, isAdmin } = useCoach();
  const [sheet, setSheet] = useState(null);
  const c = state.coach;
  // "Uusi kausi" any time, not only when Koti's card shows up near the season's end
  const season = state.seasonsReady ? currentSeason(state) : null;
  const next = season ? followingSeason(state, season) : null;
  const draft = season && state.seasonDraft?.fromSeasonId === season.id ? state.seasonDraft : null;
  return (
    <Page>
      <PageHeader title="Profiili" />
      <div className="stack-6">
        <ProfileCard person={c} uid={uid} editPath="/valmentaja/profiili/muokkaa"
          lines={[[c.tagline || 'Valmentaja', (c.tagline || '').includes(c.area) ? null : c.area].filter(Boolean).join(' · '), `${state.students.length} pelaajaa · ${state.groups.length} ryhmää`]}
          bio={c.bio} addBio="Lisää esittely pelaajillesi"
          extra={(c.experience || (c.specialties || []).length > 0) ? (
            <>
              {c.experience && <span className="k-faint">{c.experience}</span>}
              {(c.specialties || []).length > 0 && <span className="row wrap k-profile-chips">{c.specialties.map((s) => <span key={s} className="chip chip-sm chip-neutral">{s}</span>)}</span>}
            </>
          ) : null} />
        <SubscriptionCard />
        <section className="stack-2">
          <div className="eyebrow">Ilmoitukset</div>
          <Card><EmailPrefs uid={uid} role="coach" /></Card>
        </section>
        <section className="stack-2">
          <div className="eyebrow">Työkalut</div>
          <div className="list-group">
            {season && (
              <ListRow icon="calendar-plus" title={next ? next.name : 'Uusi kausi'}
                subtitle={next ? `Julkaistu · alkaa ${koutsiFmtShortDate(next.startsOn)}` : draft ? `${draft.name} · luonnos` : `Pohjana ${season.name}`}
                onClick={next ? () => navigate(`/valmentaja/ryhmat?vko=${weekParam(koutsiIsoWeekOfDateStr(next.startsOn))}`) : openSeason} />
            )}
            {season && (
              <ListRow icon="repeat" title={season.name} subtitle={`${koutsiFmtShortDate(season.startsOn)}–${koutsiFmtShortDate(season.endsOn)} · muuta ${seasonWord(season.startsOn, 'gen')} loppua`}
                onClick={() => setSheet('season')} />
            )}
            <ListRow icon="link" title="Liittymiskoodini" subtitle={state.groups.length ? (() => {
              const t = joinedTotals(state, state.groups);
              return `${t.joined}/${t.total} pelaajaa liittynyt · ryhmien koodit ja oma koodi`;
            })() : 'Oma koodisi pelaajille'} onClick={() => setSheet('codes')} />
            <ListRow icon="book" title="Harjoitepankki" subtitle={bankSummary(state.exercises.length)} onClick={() => navigate('/valmentaja/harjoitteet')} />
            <ListRow icon="list" title="Lisää monta kerralla" subtitle="Ryhmät ja pelaajat listasta" onClick={() => setSheet('bulk')} />
            <ListRow icon="calendar" title="Lähetä vuosisuunnitelma" subtitle="Usean ryhmän teemat Excelistä" onClick={() => setSheet('plan')} />
            {isAdmin && <ListRow icon="shield" title="Ylläpito" subtitle="Käyttäjät, palaute, vuosisuunnitelmat" onClick={() => navigate('/valmentaja/yllapito')} />}
          </div>
        </section>
        <AccountSection role="coach" uid={uid} profileName={c.name} />
      </div>
      <BulkSetupSheet open={sheet === 'bulk'} onClose={() => setSheet(null)} />
      <SharedPlanSheet open={sheet === 'plan'} onClose={() => setSheet(null)} />
      <SeasonEditSheet open={sheet === 'season'} onClose={() => setSheet(null)} season={season} />
      <JoinCodesSheet open={sheet === 'codes'} onClose={() => setSheet(null)} />
    </Page>
  );
}
