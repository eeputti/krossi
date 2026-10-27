// PlayerApp.jsx — the signed-in player: state, chrome, screens, and the sheets for the
// player's own writes (opened from anywhere through usePlayerActions()).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, isDemo } from '../api/index.js';
import { AppShell } from '../app/AppShell.jsx';
import { DataProvider, useData } from '../app/data.jsx';
import { dropQueryParam, navigate, useRoute } from '../app/router.js';
import { GateError, Splash } from '../shared/gates.jsx';
import { Button, EmptyState, Icon, Page, Sheet } from '../ui/index.js';
import { VideoPlayerSheet, VideoShareSheet } from '../shared/videos.jsx';
import { RenewedIntro, renewedNoteDue, showBetaBar } from '../shared/renewed.jsx';
import { NotificationsSheet, useNotifications } from '../shared/Notifications.jsx';
import { FeedbackSheet } from '../shared/account.jsx';
import { useIsDesktop } from '../app/hooks.js';
import { checkInCandidate } from '../domain/player.js';
import { useToast } from '../ui/index.js';
import { PHONE_TABS, TABS } from './routes.js';
import { MoreSheet } from './MoreSheet.jsx';
import { JoinGroupSheet } from './JoinGroupSheet.jsx';
import { HomeScreen } from './HomeScreen.jsx';
import { ProgressScreen } from './ProgressScreen.jsx';
import { TrainingsScreen } from './TrainingsScreen.jsx';
import { GroupScreen } from './GroupScreen.jsx';
import { ExercisesScreen } from './ExercisesScreen.jsx';
import { ProfileScreen } from './ProfileScreen.jsx';
import { ProfileEditScreen } from './ProfileEditScreen.jsx';
import { AbsenceSheet, MatchNoteSheet, MoodSheet, PlayerTextSheet, SelfTrainingSheet } from './sheets.jsx';
import { EntrySheet } from './EntrySheet.jsx';
import { MerkitseSheet } from './MerkitseSheet.jsx';
import { GoalsSheet } from './GoalsSheet.jsx';
import { CheckInSheet } from './CheckInSheet.jsx';
import { PlanSheet } from '../shared/drills/plan.jsx';
import { MessagesProvider, useMessages } from '../shared/messages/MessagesProvider.jsx';
import { MessagesScreen, ThreadScreen, visibleThreads } from './MessagesScreen.jsx';
import { markAsked, previewCheckIn, readSkipped, takePendingCheckIn, wasAsked } from './checkin.js';

const ActionsContext = createContext(null);
/** openMerkitse(), openSelfTraining(date?, { time?, editing?, activity?, homeworkId?, locked? }?), openMood(score?),
 *  openCheckIn(training?, { all? }?), openMatch({ editing?, date? }), openAbsence(training), openText(kind), openGoals(),
 *  openEntry(editing?), openVideo(), playVideo(video), openPlan(training), openJoin(code?) */
export function usePlayerActions() { return useContext(ActionsContext); }

function NotFound() {
  return (
    <Page>
      <EmptyState art="search" title="Tätä sivua ei löytynyt" action={<Button variant="dark" onClick={() => navigate('/pelaaja/koti', { replace: true })}>Kotiin</Button>} />
    </Page>
  );
}

const SCREENS = { home: HomeScreen, progress: ProgressScreen, trainings: TrainingsScreen, group: GroupScreen, exercises: ExercisesScreen, profile: ProfileScreen, profileEdit: ProfileEditScreen, messages: MessagesScreen, thread: ThreadScreen };

/** First visit: what Koutsi is for (players took the old app for a video box). */
function WelcomeSheet({ student }) {
  const { run, ownerId } = useData();
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    try { localStorage.setItem(`koutsi_purpose_seen_${ownerId}`, '1'); } catch { /* private mode */ }
    run(() => api.player.markWelcomeSeen(ownerId), null);
  };
  const items = [
    ['home', 'Koti', 'Seuraava treeni teemoineen, juuri päättynyt treeni ja mitä valmentaja on kertonut.'],
    ['flame', 'Kehitys', 'Tavoitteesi ja kaikki treenisi teemoineen yhdellä aikajanalla.'],
    ['plus', 'Merkitse', 'Iso nappi keskellä: treeni, ottelu, fiilis tai tavoite yhdellä napautuksella. Treenin jälkeen se kysyy, miten meni.'],
  ];
  return (
    <Sheet open={open} onClose={close} size="md" title={`Moi ${(student.name || '').split(' ')[0]}!`} subtitle="Koutsi on sinun tenniskehityksesi seuranta."
      footer={<Button variant="lime" size="lg" block onClick={close}>Aloitetaan</Button>}>
      <ul className="k-welcome-list">
        {items.map(([icon, title, text]) => (
          <li key={title} className="k-welcome-item"><span className="k-welcome-icon"><Icon name={icon} size={20} /></span><span><strong>{title}</strong><span className="k-welcome-text">{text}</span></span></li>
        ))}
      </ul>
      <p className="k-fine">Jos jokin ei toimi tai tuntuu epäselvältä, kerro siitä <strong>Anna palautetta</strong> -kohdassa (puhelimella Lisää-valikossa, tietokoneella sivupalkissa).</p>
    </Sheet>
  );
}

// What opens by itself when the app starts, at most one thing, decided once:
// the e-mail's link (a wish, or "Treenit ohi! Miten meni?") > the welcome for a new account >
// the renewed-look note > "Miten meni?" for a session that just ended (once per session).
function pickStartup(state, student) {
  const pending = takePendingCheckIn();
  if (pending?.wish) return { kind: 'wish' };
  if (pending) return { kind: 'checkin', trainingId: pending.training, score: pending.score };
  if (!student.welcomeSeenAt) return { kind: 'welcome' };
  const candidate = (!isDemo || previewCheckIn) ? checkInCandidate(state, student, readSkipped(student.id)) : null;
  const ask = candidate && (previewCheckIn || !wasAsked(student.id, candidate.id)) ? { kind: 'checkin', trainingId: candidate.id } : null;
  if (previewCheckIn && ask) return ask;
  if (renewedNoteDue()) return { kind: 'renewed' };
  return ask;
}

function PlayerShell({ banner, joinCode = null }) {
  const { state, ownerId, reload } = useData();
  const toast = useToast();
  const student = state.students[0];
  const [sheet, setSheet] = useState(null);
  const [video, setVideo] = useState(null);
  const [startup] = useState(() => pickStartup(state, student));
  const [checkIn, setCheckIn] = useState(() => (startup?.kind === 'checkin' ? startup : null));
  // "Liity ryhmään": a group link opened while signed in brings its code (PlayerRoot)
  const [join, setJoin] = useState(() => (joinCode ? { code: joinCode } : null));
  useEffect(() => { if (joinCode) setJoin({ code: joinCode }); }, [joinCode]);
  const close = () => setSheet(null);
  // Phone: the tab bar's "Lisää" drawer, with the notifications in it (Koti keeps its bell too);
  // a computer has the bell on the profile card at the foot of the side nav
  const isDesktop = useIsDesktop();
  const [moreOpen, setMoreOpen] = useState(false);
  const [notifsOpen, setNotifsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const notes = useNotifications(ownerId);
  const openNotifs = () => { setNotifsOpen(true); notes.markRead(); };
  const phoneTabs = PHONE_TABS.map((t) => (t.id === 'lisaa' ? { ...t, onClick: () => setMoreOpen(true) } : t));
  const extraLinks = [
    { to: '/pelaaja/ryhma', label: 'Ryhmäsi', icon: 'users', pages: ['group'] },
    { to: '/pelaaja/harjoitteet', label: 'Harjoitteet ja videot', icon: 'play', pages: ['exercises'] },
    { key: 'liity', label: 'Liity ryhmään', icon: 'plus', onClick: () => setJoin({ code: null }) },
  ];
  const actions = useMemo(() => ({
    openMerkitse: () => setSheet({ kind: 'merkitse' }),
    openSelfTraining: (date, opts = {}) => setSheet({
      kind: 'self', date, time: opts.time, editing: opts.editing || null,
      preset: opts.activity ? { activity: opts.activity, homeworkId: opts.homeworkId || null, locked: Boolean(opts.locked) } : null,
    }),
    openMood: (score = null) => setSheet({ kind: 'mood', score }),
    // The words for one session, or one feeling for several (`all`); Merkitse closes under it.
    openCheckIn: (training = null, { all = null } = {}) => {
      setSheet((s) => (s?.kind === 'merkitse' ? null : s));
      setCheckIn({ trainingId: training?.id || null, score: null, all });
    },
    openGoals: () => setSheet({ kind: 'goals' }),
    openMatch: ({ editing, date } = {}) => setSheet({ kind: 'match', editing, date }),
    openAbsence: (training) => setSheet({ kind: 'absence', training }),
    openText: (kind) => setSheet({ kind: 'text', textKind: kind }),
    openEntry: (editing = null) => setSheet({ kind: 'entry', editing }),
    openVideo: () => setSheet({ kind: 'video' }),
    playVideo: (v) => setVideo(v),
    openPlan: (training) => setSheet({ kind: 'plan', trainingId: training.id }),
    openJoin: (code = null) => setJoin({ code }),
  }), []);
  const saveOwnVideo = useCallback(async (payload) => {
    await api.videos.share({ ...payload, studentIds: [ownerId], addedById: ownerId });
    await reload().catch(() => {});
    toast('Video tallennettu.');
  }, [ownerId, reload, toast]);
  useEffect(() => {
    if (startup?.kind === 'wish') actions.openText('wish');
    if (startup?.kind === 'checkin' && startup.trainingId) markAsked(student.id, startup.trainingId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The same pop-up from inside the app: the bell's "Treenit ohi! Miten meni?" item.
  const route = useRoute();
  useEffect(() => {
    const { fiilis, toive } = route.query;
    if (!fiilis && !toive) return;
    if (fiilis) setCheckIn({ trainingId: fiilis, score: null });
    if (toive) actions.openText('wish');
    dropQueryParam('fiilis');
    dropQueryParam('toive');
  }, [route.query.fiilis, route.query.toive]); // eslint-disable-line react-hooks/exhaustive-deps
  // Viestit on a computer: a side-nav link with the unread count (a phone has the icon on Koti)
  const msgs = useMessages();
  const messageLinks = msgs.ready && visibleThreads(msgs.threads).length
    ? [{ to: '/pelaaja/viestit', label: 'Viestit', icon: 'chat', pages: ['messages', 'thread'], badge: msgs.unread }]
    : [];
  const checkInTraining = checkIn?.trainingId ? state.trainings.find((t) => t.id === checkIn.trainingId) || null : null;
  const planTraining = sheet?.kind === 'plan' ? state.trainings.find((t) => t.id === sheet.trainingId) || null : null;
  const textInitial = sheet?.kind === 'text' ? { goal: student.goal, wish: student.playerWish, note: student.playerNote }[sheet.textKind] : '';
  return (
    <ActionsContext.Provider value={actions}>
      <AppShell
        tabs={isDesktop ? TABS : phoneTabs}
        badges={!isDesktop && notes.unread + (messageLinks.length ? msgs.unread : 0) ? { lisaa: notes.unread + (messageLinks.length ? msgs.unread : 0) } : undefined}
        screens={SCREENS}
        NotFound={NotFound}
        roleLabel="Pelaaja"
        cta={<Button variant="lime" size="lg" block icon="plus" className="sidenav-cta" onClick={() => actions.openMerkitse()}>Merkitse</Button>}
        center={{ label: 'Merkitse', icon: 'plus', onClick: () => actions.openMerkitse() }}
        extraLinks={[...messageLinks, ...extraLinks]}
        me={{ person: student, sub: student.level || 'Pelaaja', to: '/pelaaja/profiili', notifications: { unread: notes.unread, onOpen: openNotifs } }}
        feedback={{ label: 'Anna palautetta', icon: 'mail', onClick: () => setFeedbackOpen(true) }}
        banner={banner}
        signupUrl="https://koutsi.krossi.app/pelaaja?uusi=1"
        beta={showBetaBar()}
      />
      {!isDesktop && (
        <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} unread={notes.unread} messages={messageLinks.length ? { unread: msgs.unread } : null}
          onNotifications={openNotifs} onFeedback={() => setFeedbackOpen(true)} onJoin={() => setJoin({ code: null })} />
      )}
      <NotificationsSheet open={notifsOpen} onClose={() => setNotifsOpen(false)} items={notes.items} home="/pelaaja/koti" />
      <JoinGroupSheet open={Boolean(join)} initialCode={join?.code || null} onClose={() => setJoin(null)} />
      <FeedbackSheet open={feedbackOpen} onClose={() => setFeedbackOpen(false)} uid={ownerId} />
      <MerkitseSheet open={sheet?.kind === 'merkitse'} onClose={close} />
      <GoalsSheet open={sheet?.kind === 'goals'} onClose={close} />
      <SelfTrainingSheet open={sheet?.kind === 'self'} defaultDate={sheet?.date} defaultTime={sheet?.time} editing={sheet?.editing} preset={sheet?.preset}
        onClose={close} onSwitchToMatch={(date) => setSheet({ kind: 'match', date })} />
      <MoodSheet open={sheet?.kind === 'mood'} initialScore={sheet?.score ?? null} studentId={ownerId} onClose={close} />
      <MatchNoteSheet open={sheet?.kind === 'match'} editing={sheet?.editing} defaultDate={sheet?.date} onClose={close} />
      <AbsenceSheet open={sheet?.kind === 'absence'} training={sheet?.training} onClose={close} />
      <PlayerTextSheet open={sheet?.kind === 'text'} kind={sheet?.textKind} initial={textInitial} onClose={close} />
      <EntrySheet open={sheet?.kind === 'entry'} editing={sheet?.editing} onClose={close} />
      <VideoShareSheet open={sheet?.kind === 'video'} onClose={close} title="Lisää oma video" onSave={saveOwnVideo} />
      <PlanSheet open={Boolean(planTraining)} training={planTraining} group={planTraining?.groupId ? (state.allGroups || state.groups).find((g) => g.id === planTraining.groupId) : null}
        onClose={close} onPlayVideo={(v) => setVideo(v)} />
      <VideoPlayerSheet video={video} onClose={() => setVideo(null)} />
      <CheckInSheet open={Boolean(checkIn)} training={checkInTraining} all={checkIn?.all || null} initialScore={checkIn?.score ?? null}
        onClose={() => setCheckIn(null)} onWish={() => actions.openText('wish')} onSelfTraining={() => actions.openSelfTraining()} />
      {!student.welcomeSeenAt && startup?.kind !== 'checkin' && <WelcomeSheet student={student} />}
      <RenewedIntro role="player" eligible={startup?.kind === 'renewed'} />
    </ActionsContext.Provider>
  );
}

export function PlayerApp({ studentId, banner, joinCode = null }) {
  return (
    <DataProvider
      ownerId={studentId}
      load={api.player.load}
      subscribe={api.player.subscribe}
      fallback={<Splash />}
      renderError={(error, retry) => <GateError message="Tietojasi ei saatu ladattua. Tarkista verkkoyhteys ja yritä uudelleen." error={error} onRetry={retry} onSignOut={() => api.auth.signOut()} />}
    >
      <MessagesProvider role="player" ownerId={studentId}>
        <PlayerShell banner={banner} joinCode={joinCode} />
      </MessagesProvider>
    </DataProvider>
  );
}
