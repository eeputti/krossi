// CoachApp.jsx — the signed-in coach: state snapshot, navigation chrome, screens.
import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { AppShell } from '../app/AppShell.jsx';
import { DataProvider, useData } from '../app/data.jsx';
import { navigate, useRoute } from '../app/router.js';
import { GateError, Splash } from '../shared/gates.jsx';
import { RenewedIntro, showBetaBar } from '../shared/renewed.jsx';
import { Button, EmptyState, Icon, Page, Sheet } from '../ui/index.js';
import { useCoach } from './CoachRoot.jsx';
import { TABS } from './routes.js';
import { WeekScreen } from './WeekScreen.jsx';
import { PlannerSheet } from './PlannerSheet.jsx';
import { GroupsScreen } from './GroupsScreen.jsx';
import { GroupScreen } from './GroupScreen.jsx';
import { PlayersScreen } from './PlayersScreen.jsx';
import { PlayerScreen } from './PlayerScreen.jsx';
import { InvitesSheet } from './InvitesSheet.jsx';
import { CalendarScreen } from './CalendarScreen.jsx';
import { SessionScreen } from './SessionScreen.jsx';
import { ExercisesScreen, ExerciseScreen } from './ExercisesScreen.jsx';
import { ProfileScreen } from './ProfileScreen.jsx';
import { AdminScreen } from './AdminScreen.jsx';
import { openPlanner } from './nav.js';

function LegacyRedirect({ route }) {
  useEffect(() => { navigate(route.redirect, { replace: true }); }, [route.redirect]);
  return null;
}

function NotFound() {
  return (
    <Page>
      <EmptyState art="search" title="Tätä sivua ei löytynyt" text="Linkki voi olla vanha, tai kohde on poistettu."
        action={<Button variant="dark" onClick={() => navigate('/valmentaja/viikko', { replace: true })}>Takaisin viikkoon</Button>} />
    </Page>
  );
}

const SCREENS = {
  week: WeekScreen, planner: PlannerSheet, groups: GroupsScreen, group: GroupScreen,
  players: PlayersScreen, player: PlayerScreen, invites: InvitesSheet,
  calendar: CalendarScreen, session: SessionScreen, exercises: ExercisesScreen, exercise: ExerciseScreen,
  profile: ProfileScreen, admin: AdminScreen,
  legacyStudents: LegacyRedirect, legacyTrainings: LegacyRedirect,
};

function ActingBanner({ name, onExit }) {
  return (
    <div className="k-acting" role="status">
      <span className="k-acting-pill">Ylläpitotila</span>
      <span className="k-acting-text">Toimit valmentajan <strong>{name}</strong> näkymässä. Kaikki mitä lisäät, tallentuu hänen nimissään.</span>
      <Button variant="on-dark" size="sm" onClick={onExit}>Palaa omaan näkymään</Button>
    </div>
  );
}

/** First visit: what Koutsi is for, in the order a coach's week runs. */
function WelcomeSheet() {
  const { state, run, ownerId } = useData();
  const [open, setOpen] = useState(true);
  const close = () => { setOpen(false); run(() => api.coach.markWelcomeSeen(ownerId), null); };
  const steps = [
    ['sparkles', 'Viikon teemat', 'Kirjoita teema kerran ja valitse ryhmät — tai jatka viime viikon teemoilla yhdellä napautuksella.'],
    ['calendar', 'Treenit ja läsnäolo', 'Tämän päivän treenit näkyvät Viikko-sivulla. Merkitse poissaolijat napauttamalla.'],
    ['users', 'Pelaajat mukaan', 'Lähetä jokaiselle oma liittymislinkki WhatsAppiin. Pelaaja näkee teeman ja oman kehityksensä.'],
  ];
  return (
    <Sheet open={open} onClose={close} size="md" title={`Tervetuloa, ${(state.coach.name || '').split(' ')[0] || 'valmentaja'}!`} subtitle="Koutsi on valmentajan viikko yhdessä paikassa."
      footer={<Button variant="lime" size="lg" block onClick={close}>Aloitetaan</Button>}>
      <ul className="k-welcome-list">
        {steps.map(([icon, title, text]) => (
          <li key={title} className="k-welcome-item">
            <span className="k-welcome-icon"><Icon name={icon} size={20} /></span>
            <span><strong>{title}</strong><span className="k-welcome-text">{text}</span></span>
          </li>
        ))}
      </ul>
      <p className="k-fine">Jos jokin ei toimi tai tuntuu epäselvältä, kerro siitä Profiili-sivun <strong>Anna palautetta</strong> -napilla.</p>
    </Sheet>
  );
}

function CoachShell() {
  const { state } = useData();
  const { acting, exitActing, isAdmin, adminChecked } = useCoach();
  const route = useRoute();

  useEffect(() => {
    // Ylläpito is a real address; once the check says no (or we act as a coach), leave it.
    if (route.name === 'admin' && adminChecked && !isAdmin) navigate('/valmentaja/viikko', { replace: true });
    if (acting && route.name === 'profile') navigate('/valmentaja/viikko', { replace: true });
  }, [route.name, isAdmin, adminChecked, acting]);

  const tabs = acting ? TABS.filter((t) => t.id !== 'profiili') : TABS;
  const extraLinks = [
    { to: '/valmentaja/harjoitteet', label: 'Harjoitepankki', icon: 'list', pages: ['exercises', 'exercise'] },
    ...(isAdmin ? [{ to: '/valmentaja/yllapito', label: 'Ylläpito', icon: 'shield', pages: ['admin'] }] : []),
  ];
  return (
    <>
      <AppShell
        tabs={tabs}
        screens={SCREENS}
        NotFound={NotFound}
        roleLabel="Valmentaja"
        cta={<Button variant="lime" size="lg" block icon="sparkles" className="sidenav-cta" onClick={() => openPlanner()}>Viikon teemat</Button>}
        extraLinks={extraLinks}
        me={acting ? null : { person: state.coach, sub: state.coach.tagline || 'Valmentaja', to: '/valmentaja/profiili' }}
        banner={acting ? <ActingBanner name={state.coach.name} onExit={exitActing} /> : null}
        signupUrl="https://koutsi.krossi.app/valmentaja?uusi=1"
        beta={showBetaBar() && !acting}
      />
      {!acting && !state.coach.welcomeSeenAt && <WelcomeSheet />}
      <RenewedIntro role="coach" eligible={!acting && Boolean(state.coach.welcomeSeenAt)} />
    </>
  );
}

export function CoachApp() {
  const { coachId } = useCoach();
  const session = { signOut: () => api.auth.signOut() };
  return (
    <DataProvider
      ownerId={coachId}
      load={api.coach.load}
      subscribe={api.coach.subscribe}
      fallback={<Splash />}
      renderError={(error, retry) => <GateError message="Valmennustietojasi ei saatu ladattua. Tarkista verkkoyhteys ja yritä uudelleen." error={error} onRetry={retry} onSignOut={session.signOut} />}
    >
      <CoachShell />
    </DataProvider>
  );
}
