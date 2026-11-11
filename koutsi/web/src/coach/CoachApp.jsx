// CoachApp.jsx — the signed-in coach: state snapshot, navigation chrome, screens.
import { useEffect, useState } from 'react';
import { api, isDemo } from '../api/index.js';
import { AppShell } from '../app/AppShell.jsx';
import { DataProvider, useData } from '../app/data.jsx';
import { navigate, useRoute } from '../app/router.js';
import { useIsDesktop } from '../app/hooks.js';
import { GateError, Splash } from '../shared/gates.jsx';
import { showBetaBar } from '../shared/renewed.jsx';
import { koutsiCurrentIsoWeek, koutsiTodayStr } from '../domain/core.js';
import { recapWeekDue } from '../domain/week.js';
import { markRecapSeen, previewRecap, recapSeen, WeekRecapSheet } from './WeekRecapSheet.jsx';
import { Button, EmptyState, Page } from '../ui/index.js';
import { useCoach } from './CoachRoot.jsx';
import { DESKTOP_TABS, PHONE_TABS } from './routes.js';
import { WeekScreen } from './WeekScreen.jsx';
import { PlannerSheet } from './PlannerSheet.jsx';
import { BoardScreen } from './BoardScreen.jsx';
import { PlanScreen } from './PlanScreen.jsx';
import { GroupListScreen } from './GroupListScreen.jsx';
import { GroupScreen } from './GroupScreen.jsx';
import { PlayersScreen } from './PlayersScreen.jsx';
import { PlayerScreen } from './PlayerScreen.jsx';
import { InvitesSheet } from './InvitesSheet.jsx';
import { SeasonSheet } from './SeasonSheet.jsx';
import { SessionScreen } from './SessionScreen.jsx';
import { ExercisesScreen, ExerciseScreen } from './ExercisesScreen.jsx';
import { SentScreen } from './SentScreen.jsx';
import { ProfileScreen } from './ProfileScreen.jsx';
import { ProfileEditScreen } from './ProfileEditScreen.jsx';
import { LevelsScreen } from './LevelsScreen.jsx';
import { AdminScreen } from './AdminScreen.jsx';
import { RecordProvider, useRecord } from './merkitse.jsx';
import { MoreSheet } from './MoreSheet.jsx';
import { JoinCodesSheet } from './JoinCodesSheet.jsx';
import { track } from './usage.js';
import { NotificationsSheet, useNotifications } from '../shared/Notifications.jsx';
import { FeedbackSheet } from '../shared/account.jsx';
import { useLoginLinkReturn } from '../shared/logins.jsx';
import { BillingProvider, useBilling } from '../shared/billing/BillingProvider.jsx';
import { BillingScreen } from './BillingScreen.jsx';
import { invoiceState } from '../domain/billing.js';
import { CoachIntro } from './CoachIntro.jsx';

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
  week: WeekScreen, planner: PlannerSheet, groups: BoardScreen, group: GroupScreen, plan: PlanScreen, groupList: GroupListScreen,
  players: PlayersScreen, player: PlayerScreen, invites: InvitesSheet, season: SeasonSheet,
  session: SessionScreen, exercises: ExercisesScreen, exercise: ExerciseScreen, sent: SentScreen,
  profile: ProfileScreen, profileEdit: ProfileEditScreen, levels: LevelsScreen, admin: AdminScreen, billing: BillingScreen,
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

function CoachShell() {
  const { state } = useData();
  const { acting, exitActing, isAdmin, adminChecked, coachId, uid } = useCoach();
  const { openMerkinta } = useRecord();
  const route = useRoute();
  useLoginLinkReturn(); // back from Google / Apple after Profiili → Liitä
  const isDesktop = useIsDesktop();
  // Phone: the tab bar's "Lisää" drawer, with the notifications in it; a computer has the bell on
  // the profile card at the foot of the side nav
  const [moreOpen, setMoreOpen] = useState(false);
  const [notifsOpen, setNotifsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [codesOpen, setCodesOpen] = useState(false);
  const openCodes = () => { track('liittymiskoodit.nappi'); setCodesOpen(true); };
  const notes = useNotifications(acting ? null : uid);
  const openNotifs = () => { setNotifsOpen(true); notes.markRead(); };
  const phoneTabs = PHONE_TABS.map((t) => (t.id === 'lisaa' ? { ...t, onClick: () => { track('lisaa.avaa'); setMoreOpen(true); } } : t));
  // Laskutus, while it is on for this coach: a side-nav link and a row in the phone's Lisää
  const billing = useBilling();
  // "En tarvitse laskutusta vielä" (billing.hidden) keeps it out of sight; Profiili brings it back
  const billingOn = billing.ready && billing.enabled && !billing.hidden && !acting;
  const billingInfo = billingOn ? {
    open: (billing.invoices || []).filter((x) => x.status === 'sent').length,
    overdue: (billing.invoices || []).filter((x) => invoiceState(x, koutsiTodayStr()) === 'myohassa').length,
  } : null;
  // What opens by itself, at most one thing, decided once: the intro film for a new account >
  // "Viikko paketissa" after the week's last session (never while acting).
  const [startup] = useState(() => {
    if (acting) return null;
    if (!state.coach.welcomeSeenAt) return { kind: 'welcome' };
    if (previewRecap) return { kind: 'recap', week: koutsiCurrentIsoWeek() };
    const week = isDemo ? null : recapWeekDue(state, (w) => recapSeen(coachId, w));
    return week ? { kind: 'recap', week } : null;
  });
  const [recapWeek, setRecapWeek] = useState(() => (startup?.kind === 'recap' ? startup.week : null));
  const closeRecap = () => { if (recapWeek) markRecapSeen(coachId, recapWeek); setRecapWeek(null); };

  useEffect(() => {
    // Ylläpito is a real address; once the check says no (or we act as a coach), leave it.
    if (route.name === 'admin' && adminChecked && !isAdmin) navigate('/valmentaja/koti', { replace: true });
    if (acting && (route.name === 'profile' || route.name === 'profileEdit' || route.name === 'levels')) navigate('/valmentaja/koti', { replace: true });
  }, [route.name, isAdmin, adminChecked, acting]);

  const extraLinks = [
    { to: '/valmentaja/harjoitteet', label: state.sendsReady ? 'Harjoitteet ja videot' : 'Harjoitepankki', icon: 'book', pages: ['exercises', 'exercise'] },
    ...(state.sendsReady ? [{ to: '/valmentaja/lahetetyt', label: 'Lähetetyt', icon: 'send', pages: ['sent'] }] : []),
    ...(billingOn ? [{ to: '/valmentaja/laskutus', label: 'Laskutus', icon: 'euro', pages: ['billing'] }] : []),
    ...(isAdmin ? [{ to: '/valmentaja/yllapito', label: 'Ylläpito', icon: 'shield', pages: ['admin'] }] : []),
  ];
  return (
    <>
      <AppShell
        tabs={isDesktop ? DESKTOP_TABS : phoneTabs}
        badges={!isDesktop && notes.unread ? { lisaa: notes.unread } : undefined}
        screens={SCREENS}
        NotFound={NotFound}
        roleLabel="Valmentaja"
        cta={<Button variant="lime" size="lg" block icon="plus" className="sidenav-cta" onClick={() => openMerkinta()}>Merkitse</Button>}
        center={{ label: 'Merkitse', icon: 'plus', onClick: () => openMerkinta() }}
        extraLinks={extraLinks}
        // the card's second line is the role only: a long title (Tennisvalmentaja …) never fit
        me={acting ? null : { person: state.coach, sub: 'Valmentaja', to: '/valmentaja/profiili', notifications: { unread: notes.unread, onOpen: openNotifs } }}
        beforeMe={acting ? null : { label: 'Liittymiskoodini', icon: 'link', onClick: openCodes }}
        feedback={acting ? null : { label: 'Anna palautetta', icon: 'mail', onClick: () => { track('palaute.avaa'); setFeedbackOpen(true); } }}
        banner={acting ? <ActingBanner name={state.coach.name} onExit={exitActing} /> : null}
        signupUrl="https://koutsi.krossi.app/valmentaja?uusi=1"
        beta={showBetaBar() && !acting}
      />
      {!acting && <CoachIntro firstVisit={startup?.kind === 'welcome'} />}
      <WeekRecapSheet open={Boolean(recapWeek)} week={recapWeek} onClose={closeRecap} />
      {!isDesktop && (
        <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} unread={notes.unread} isAdmin={isAdmin} acting={acting} billing={billingInfo}
          onNotifications={openNotifs}
          onNotice={() => openMerkinta({ kind: 'tiedote' })}
          onFeedback={() => setFeedbackOpen(true)} onCodes={openCodes} />
      )}
      <NotificationsSheet open={notifsOpen} onClose={() => setNotifsOpen(false)} items={notes.items} home="/valmentaja/koti" />
      {!acting && <JoinCodesSheet open={codesOpen} onClose={() => setCodesOpen(false)} />}
      {!acting && <FeedbackSheet open={feedbackOpen} onClose={() => setFeedbackOpen(false)} uid={uid} />}
    </>
  );
}

export function CoachApp() {
  const { coachId, acting } = useCoach();
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
        <BillingProvider role="coach" ownerId={coachId} off={acting}>
          <CoachShell />
        </BillingProvider>
      </RecordProvider>
    </DataProvider>
  );
}
