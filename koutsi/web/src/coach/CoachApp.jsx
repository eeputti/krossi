// CoachApp.jsx — the signed-in coach: state snapshot, navigation chrome, screens.
import { useEffect, useState } from 'react';
import { api, isDemo } from '../api/index.js';
import { AppShell } from '../app/AppShell.jsx';
import { DataProvider, useData } from '../app/data.jsx';
import { navigate, useRoute } from '../app/router.js';
import { useIsDesktop } from '../app/hooks.js';
import { GateError, Splash } from '../shared/gates.jsx';
import { RenewedIntro, renewedNoteDue, showBetaBar } from '../shared/renewed.jsx';
import { koutsiCurrentIsoWeek } from '../domain/core.js';
import { recapWeekDue } from '../domain/week.js';
import { markRecapSeen, previewRecap, recapSeen, WeekRecapSheet } from './WeekRecapSheet.jsx';
import { Button, EmptyState, Icon, Page, Sheet } from '../ui/index.js';
import { useCoach } from './CoachRoot.jsx';
import { PHONE_TABS, TABS } from './routes.js';
import { WeekScreen } from './WeekScreen.jsx';
import { PlannerSheet } from './PlannerSheet.jsx';
import { BoardScreen } from './BoardScreen.jsx';
import { GroupScreen } from './GroupScreen.jsx';
import { PlayersScreen } from './PlayersScreen.jsx';
import { PlayerScreen } from './PlayerScreen.jsx';
import { InvitesSheet } from './InvitesSheet.jsx';
import { SessionScreen } from './SessionScreen.jsx';
import { ExercisesScreen, ExerciseScreen } from './ExercisesScreen.jsx';
import { ProfileScreen } from './ProfileScreen.jsx';
import { AdminScreen } from './AdminScreen.jsx';
import { RecordProvider, useRecord } from './merkitse.jsx';

function LegacyRedirect({ route, query }) {
  const to = route.keepWeek && query.vko ? `${route.redirect}?vko=${encodeURIComponent(query.vko)}` : route.redirect;
  useEffect(() => { navigate(to, { replace: true }); }, [to]);
  return null;
}

function NotFound() {
  return (
    <Page>
      <EmptyState art="search" title="Tätä sivua ei löytynyt" text="Linkki voi olla vanha, tai kohde on poistettu."
        action={<Button variant="dark" onClick={() => navigate('/valmentaja/koti', { replace: true })}>Takaisin kotiin</Button>} />
    </Page>
  );
}

const SCREENS = {
  week: WeekScreen, planner: PlannerSheet, groups: BoardScreen, group: GroupScreen,
  players: PlayersScreen, player: PlayerScreen, invites: InvitesSheet,
  session: SessionScreen, exercises: ExercisesScreen, exercise: ExerciseScreen,
  profile: ProfileScreen, admin: AdminScreen,
  legacyWeek: LegacyRedirect, legacyStudents: LegacyRedirect, legacyTrainings: LegacyRedirect, legacyCalendar: LegacyRedirect,
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
    ['calendar', 'Viikkohallinta', 'Koko viikko kalenterina: ryhmät, treenit ja tapahtumat. Punertava kortti kertoo, että jotain puuttuu.'],
    ['plus', 'Merkitse', 'Iso Merkitse-nappi: huomio, kotiläksy tai video yhdelle pelaajalle tai koko ryhmälle — treenin jälkeen ryhmä on valmiina.'],
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
  const { acting, exitActing, isAdmin, adminChecked, coachId } = useCoach();
  const { openMerkinta } = useRecord();
  const route = useRoute();
  const isDesktop = useIsDesktop();
  // What opens by itself, at most one thing, decided once: the welcome for a new account > the
  // renewed-look note > "Viikko paketissa" after the week's last session (never while acting).
  const [startup] = useState(() => {
    if (acting) return null;
    if (!state.coach.welcomeSeenAt) return { kind: 'welcome' };
    if (previewRecap) return { kind: 'recap', week: koutsiCurrentIsoWeek() };
    if (renewedNoteDue()) return { kind: 'renewed' };
    const week = isDemo ? null : recapWeekDue(state, (w) => recapSeen(coachId, w));
    return week ? { kind: 'recap', week } : null;
  });
  const [recapWeek, setRecapWeek] = useState(() => (startup?.kind === 'recap' ? startup.week : null));
  const closeRecap = () => { if (recapWeek) markRecapSeen(coachId, recapWeek); setRecapWeek(null); };

  useEffect(() => {
    // Ylläpito is a real address; once the check says no (or we act as a coach), leave it.
    if (route.name === 'admin' && adminChecked && !isAdmin) navigate('/valmentaja/koti', { replace: true });
    if (acting && route.name === 'profile') navigate('/valmentaja/koti', { replace: true });
  }, [route.name, isAdmin, adminChecked, acting]);

  const extraLinks = [
    { to: '/valmentaja/harjoitteet', label: 'Harjoitepankki', icon: 'list', pages: ['exercises', 'exercise'] },
    ...(isAdmin ? [{ to: '/valmentaja/yllapito', label: 'Ylläpito', icon: 'shield', pages: ['admin'] }] : []),
  ];
  return (
    <>
      <AppShell
        tabs={isDesktop ? TABS : PHONE_TABS}
        screens={SCREENS}
        NotFound={NotFound}
        roleLabel="Valmentaja"
        cta={<Button variant="lime" size="lg" block icon="plus" className="sidenav-cta" onClick={() => openMerkinta()}>Merkitse</Button>}
        center={{ label: 'Merkitse', icon: 'plus', onClick: () => openMerkinta() }}
        extraLinks={extraLinks}
        me={acting ? null : { person: state.coach, sub: state.coach.tagline || 'Valmentaja', to: '/valmentaja/profiili' }}
        banner={acting ? <ActingBanner name={state.coach.name} onExit={exitActing} /> : null}
        signupUrl="https://koutsi.krossi.app/valmentaja?uusi=1"
        beta={showBetaBar() && !acting}
      />
      {!acting && !state.coach.welcomeSeenAt && <WelcomeSheet />}
      <RenewedIntro role="coach" eligible={startup?.kind === 'renewed'} />
      <WeekRecapSheet open={Boolean(recapWeek)} week={recapWeek} onClose={closeRecap} />
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
      <RecordProvider>
        <CoachShell />
      </RecordProvider>
    </DataProvider>
  );
}
