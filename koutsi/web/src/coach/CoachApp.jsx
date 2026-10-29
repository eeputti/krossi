// CoachApp.jsx — the signed-in coach: state snapshot, navigation chrome, screens.
import { useEffect, useState } from 'react';
import { api, isDemo } from '../api/index.js';
import { AppShell } from '../app/AppShell.jsx';
import { DataProvider, useData } from '../app/data.jsx';
import { navigate, useRoute } from '../app/router.js';
import { useIsDesktop } from '../app/hooks.js';
import { GateError, Splash } from '../shared/gates.jsx';
import { RenewedIntro, renewedNoteDue, showBetaBar } from '../shared/renewed.jsx';
import { koutsiCurrentIsoWeek, koutsiTodayStr } from '../domain/core.js';
import { recapWeekDue } from '../domain/week.js';
import { markRecapSeen, previewRecap, recapSeen, WeekRecapSheet } from './WeekRecapSheet.jsx';
import { Button, EmptyState, Icon, Page, Sheet } from '../ui/index.js';
import { useCoach } from './CoachRoot.jsx';
import { DESKTOP_TABS, MESSAGES_TAB, PHONE_TABS } from './routes.js';
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
import { AdminScreen } from './AdminScreen.jsx';
import { RecordProvider, useRecord } from './merkitse.jsx';
import { MoreSheet } from './MoreSheet.jsx';
import { JoinCodesSheet } from './JoinCodesSheet.jsx';
import { track } from './usage.js';
import { NotificationsSheet, useNotifications } from '../shared/Notifications.jsx';
import { FeedbackSheet } from '../shared/account.jsx';
import { MessagesProvider, useMessages } from '../shared/messages/MessagesProvider.jsx';
import { MessagesScreen } from './MessagesScreen.jsx';
import { ThreadScreen } from './ThreadScreen.jsx';
import { namesLine, unanswered } from '../domain/messages.js';
import { BillingProvider, useBilling } from '../shared/billing/BillingProvider.jsx';
import { BillingScreen } from './BillingScreen.jsx';
import { invoiceState } from '../domain/billing.js';

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
  profile: ProfileScreen, profileEdit: ProfileEditScreen, admin: AdminScreen, messages: MessagesScreen, thread: ThreadScreen, billing: BillingScreen,
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
      <p className="k-fine">Jos jokin ei toimi tai tuntuu epäselvältä, kerro siitä <strong>Anna palautetta</strong> -kohdassa (tietokoneella sivupalkissa, puhelimella Lisää-valikossa).</p>
    </Sheet>
  );
}

function CoachShell() {
  const { state } = useData();
  const { acting, exitActing, isAdmin, adminChecked, coachId, uid } = useCoach();
  const { openMerkinta } = useRecord();
  const route = useRoute();
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
  // Viestit, once the database has it and the coach has the feature (beta first): a computer's side nav
  // gets the tab after Pelaajat, a phone the first row of Lisää; the unread count rides on both.
  const msgs = useMessages();
  const messagesOn = msgs.ready && msgs.enabled && !acting;
  const desktopTabs = messagesOn ? [...DESKTOP_TABS.slice(0, 3), MESSAGES_TAB, ...DESKTOP_TABS.slice(3)] : DESKTOP_TABS;
  const waitingNames = messagesOn
    ? unanswered(msgs.threads).map((t) => state.students.find((s) => s.id === t.studentId)?.name).filter(Boolean)
    : [];
  const messageInfo = messagesOn ? {
    unread: msgs.unread,
    on: msgs.threads.some((t) => t.enabled),
    waiting: waitingNames.length ? `${namesLine(waitingNames)} ${waitingNames.length === 1 ? 'odottaa' : 'odottavat'} vastausta` : '',
  } : null;
  const phoneBadge = notes.unread + (messagesOn ? msgs.unread : 0);
  // Laskutus, while it is on for this coach: a side-nav link and a row in the phone's Lisää
  const billing = useBilling();
  // "En tarvitse laskutusta vielä" (billing.hidden) keeps it out of sight; Profiili brings it back
  const billingOn = billing.ready && billing.enabled && !billing.hidden && !acting;
  const billingInfo = billingOn ? {
    open: (billing.invoices || []).filter((x) => x.status === 'sent').length,
    overdue: (billing.invoices || []).filter((x) => invoiceState(x, koutsiTodayStr()) === 'myohassa').length,
  } : null;
  const badges = isDesktop ? (messagesOn && msgs.unread ? { viestit: msgs.unread } : undefined) : (phoneBadge ? { lisaa: phoneBadge } : undefined);
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
    if (acting && (route.name === 'profile' || route.name === 'profileEdit')) navigate('/valmentaja/koti', { replace: true });
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
        tabs={isDesktop ? desktopTabs : phoneTabs}
        badges={badges}
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
      {!acting && !state.coach.welcomeSeenAt && <WelcomeSheet />}
      <RenewedIntro role="coach" eligible={startup?.kind === 'renewed'} />
      <WeekRecapSheet open={Boolean(recapWeek)} week={recapWeek} onClose={closeRecap} />
      {!isDesktop && (
        <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} unread={notes.unread} isAdmin={isAdmin} acting={acting} messages={messageInfo} billing={billingInfo}
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
        <MessagesProvider role="coach" ownerId={coachId} off={acting}>
          <BillingProvider role="coach" ownerId={coachId} off={acting}>
            <CoachShell />
          </BillingProvider>
        </MessagesProvider>
      </RecordProvider>
    </DataProvider>
  );
}
