// ProfileScreen (player) — own details, own note to the coach, notifications, account.
// A tap on the name opens Muokkaa profiilia (/pelaaja/profiili/muokkaa); a tap on the photo
// opens Valitse kuva / Ota uusi kuva.
import { useData } from '../app/data.jsx';
import { Card, Icon, ListRow, Page, PageHeader } from '../ui/index.js';
import { replayIntro } from '../shared/intro/IntroFilm.jsx';
import { AccountSection, EmailPrefs } from '../shared/account.jsx';
import { ProfileCard } from '../shared/profileCard.jsx';
import { koutsiGroupsForStudent } from '../domain/core.js';
import { tennisFacts } from '../domain/tennisProfile.js';
import { profileProgress } from '../domain/profileCompleteness.js';
import { usePlayerActions } from './PlayerApp.jsx';
import { playerLevelView } from '../domain/levels.js';

export function ProfileScreen() {
  const { state, ownerId } = useData();
  const actions = usePlayerActions();
  const me = state.students[0];
  const groups = koutsiGroupsForStudent(state, me.id);
  const level = playerLevelView(state, me); // only 18 or more (domain/levels.js)
  return (
    <Page>
      <PageHeader title="Profiili" />
      <div className="stack-6">
        <ProfileCard person={me} uid={ownerId} editPath="/pelaaja/profiili/muokkaa"
          lines={[
            [me.ageLabel, level && (level.note ? `${level.label} (${level.note})` : level.label), me.area].filter(Boolean).join(', ') || 'Pelaaja',
            groups.length > 0 ? groups.map((g) => `${g.day} ${g.time} ${g.name}`).join(', ') : null,
            tennisFacts(me).join(', ') || null,
          ]}
          bio={me.bio} addBio="Lisää esittely itsestäsi"
          progress={profileProgress('player', me, { tennis: state.tennisProfileReady !== false })} />
        <Card interactive onClick={() => actions.openText('note')} className="goal-card">
          <div className="eyebrow"><Icon name="edit" size={13} /> Kommentti valmentajalle</div>
          {me.playerNote ? <p className="goal-text">{me.playerNote}</p> : <p className="k-faint">Kerro valmentajallesi, mitä haluat hänen tietävän — esim. mitä haluat muistaa seuraavasta treenistä.</p>}
          <p className="k-faint">Valmentajasi näkee tämän.</p>
        </Card>
        <section className="stack-2">
          <div className="eyebrow">Ilmoitukset</div>
          <Card><EmailPrefs uid={ownerId} role="player" has={state.openSlotsReady && (state.openSlots || []).length ? ['openSlots'] : []} /></Card>
        </section>
        <div className="list-group">
          <ListRow icon="play" title="Katso esittely" subtitle="Mitä on missäkin, puolessa minuutissa" onClick={() => replayIntro()} />
        </div>
        <AccountSection role="player" uid={ownerId} profileName={me.name} />
      </div>
    </Page>
  );
}
