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
import { checkInCandidate } from '../domain/player.js';
import { useToast } from '../ui/index.js';
import { TABS } from './routes.js';
import { HomeScreen } from './HomeScreen.jsx';
import { ProgressScreen } from './ProgressScreen.jsx';
import { TrainingsScreen } from './TrainingsScreen.jsx';
import { GroupScreen } from './GroupScreen.jsx';
import { ExercisesScreen } from './ExercisesScreen.jsx';
import { ProfileScreen } from './ProfileScreen.jsx';
import { AbsenceSheet, MatchNoteSheet, MoodSheet, PlayerTextSheet, SelfTrainingSheet } from './sheets.jsx';
import { CheckInSheet } from './CheckInSheet.jsx';
import { PlanSheet } from '../shared/drills/plan.jsx';
import { markAsked, previewCheckIn, readSkipped, takePendingCheckIn, wasAsked } from './checkin.js';

const ActionsContext = createContext(null);
/** openSelfTraining(date?, { time?, editing?, activity?, homeworkId? }?), openMood(score?), openCheckIn(training?), openMatch({ editing?, date? }), openAbsence(training),
 *  openText(kind), openVideo(), playVideo(video), openPlan(training) */
export function usePlayerActions() { return useContext(ActionsContext); }

function NotFound() {
  return (
    <Page>
      <EmptyState art="search" title="Tätä sivua ei löytynyt" action={<Button variant="dark" onClick={() => navigate('/pelaaja/koti', { replace: true })}>Kotiin</Button>} />
    </Page>
  );
}

const SCREENS = { home: HomeScreen, progress: ProgressScreen, trainings: TrainingsScreen, group: GroupScreen, exercises: ExercisesScreen, profile: ProfileScreen };

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
    ['sparkles', 'Viikon teema', 'Mitä ryhmässäsi harjoitellaan nyt — ja mitä on harjoiteltu aiemmin.'],
    ['flame', 'Kehitys', 'Treenit, teemat, valmentajan huomiot, tavoitteet ja ottelut yhdellä aikajanalla.'],
    ['heart', 'Fiilis treenin jälkeen', 'Yksi napautus kertoo valmentajalle, miten meni. Voit pitää sen myös vain itselläsi.'],
  ];
  return (
    <Sheet open={open} onClose={close} size="md" title={`Moi ${(student.name || '').split(' ')[0]}!`} subtitle="Koutsi on sinun tenniskehityksesi seuranta."
      footer={<Button variant="lime" size="lg" block onClick={close}>Aloitetaan</Button>}>
      <ul className="k-welcome-list">
        {items.map(([icon, title, text]) => (
          <li key={title} className="k-welcome-item"><span className="k-welcome-icon"><Icon name={icon} size={20} /></span><span><strong>{title}</strong><span className="k-welcome-text">{text}</span></span></li>
        ))}
      </ul>
      <p className="k-fine">Jos jokin ei toimi tai tuntuu epäselvältä, kerro siitä Profiilin <strong>Anna palautetta</strong> -napilla.</p>
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

function PlayerShell({ banner }) {
  const { state, ownerId, reload } = useData();
  const toast = useToast();
  const student = state.students[0];
  const [sheet, setSheet] = useState(null);
  const [video, setVideo] = useState(null);
  const [startup] = useState(() => pickStartup(state, student));
  const [checkIn, setCheckIn] = useState(() => (startup?.kind === 'checkin' ? startup : null));
  const close = () => setSheet(null);
  const actions = useMemo(() => ({
    openSelfTraining: (date, opts = {}) => setSheet({
      kind: 'self', date, time: opts.time, editing: opts.editing || null,
      preset: opts.activity ? { activity: opts.activity, homeworkId: opts.homeworkId || null } : null,
    }),
    openMood: (score = null) => setSheet({ kind: 'mood', score }),
    openCheckIn: (training = null) => setCheckIn({ trainingId: training?.id || null, score: null }),
    openMatch: ({ editing, date } = {}) => setSheet({ kind: 'match', editing, date }),
    openAbsence: (training) => setSheet({ kind: 'absence', training }),
    openText: (kind) => setSheet({ kind: 'text', textKind: kind }),
    openVideo: () => setSheet({ kind: 'video' }),
    playVideo: (v) => setVideo(v),
    openPlan: (training) => setSheet({ kind: 'plan', trainingId: training.id }),
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
  const checkInTraining = checkIn?.trainingId ? state.trainings.find((t) => t.id === checkIn.trainingId) || null : null;
  const planTraining = sheet?.kind === 'plan' ? state.trainings.find((t) => t.id === sheet.trainingId) || null : null;
  const textInitial = sheet?.kind === 'text' ? { goal: student.goal, wish: student.playerWish, note: student.playerNote }[sheet.textKind] : '';
  return (
    <ActionsContext.Provider value={actions}>
      <AppShell
        tabs={TABS}
        screens={SCREENS}
        NotFound={NotFound}
        roleLabel="Pelaaja"
        cta={<Button variant="lime" size="lg" block icon="plus" className="sidenav-cta" onClick={() => actions.openSelfTraining()}>Kirjaa treeni</Button>}
        extraLinks={[{ to: '/pelaaja/harjoitteet', label: 'Harjoitteet ja videot', icon: 'play', pages: ['exercises'] }]}
        me={{ person: student, sub: student.level || 'Pelaaja', to: '/pelaaja/profiili' }}
        banner={banner}
        signupUrl="https://koutsi.krossi.app/pelaaja?uusi=1"
        beta={showBetaBar()}
      />
      <SelfTrainingSheet open={sheet?.kind === 'self'} defaultDate={sheet?.date} defaultTime={sheet?.time} editing={sheet?.editing} preset={sheet?.preset}
        onClose={close} onSwitchToMatch={(date) => setSheet({ kind: 'match', date })} />
      <MoodSheet open={sheet?.kind === 'mood'} initialScore={sheet?.score ?? null} studentId={ownerId} onClose={close} />
      <MatchNoteSheet open={sheet?.kind === 'match'} editing={sheet?.editing} defaultDate={sheet?.date} onClose={close} />
      <AbsenceSheet open={sheet?.kind === 'absence'} training={sheet?.training} onClose={close} />
      <PlayerTextSheet open={sheet?.kind === 'text'} kind={sheet?.textKind} initial={textInitial} onClose={close} />
      <VideoShareSheet open={sheet?.kind === 'video'} onClose={close} title="Lisää oma video" onSave={saveOwnVideo} />
      <PlanSheet open={Boolean(planTraining)} training={planTraining} group={planTraining?.groupId ? state.groups.find((g) => g.id === planTraining.groupId) : null}
        onClose={close} onPlayVideo={(v) => setVideo(v)} />
      <VideoPlayerSheet video={video} onClose={() => setVideo(null)} />
      <CheckInSheet open={Boolean(checkIn)} training={checkInTraining} initialScore={checkIn?.score ?? null}
        onClose={() => setCheckIn(null)} onWish={() => actions.openText('wish')} onSelfTraining={() => actions.openSelfTraining()} />
      {!student.welcomeSeenAt && startup?.kind !== 'checkin' && <WelcomeSheet student={student} />}
      <RenewedIntro role="player" eligible={startup?.kind === 'renewed'} />
    </ActionsContext.Provider>
  );
}

export function PlayerApp({ studentId, banner }) {
  return (
    <DataProvider
      ownerId={studentId}
      load={api.player.load}
      subscribe={api.player.subscribe}
      fallback={<Splash />}
      renderError={(error, retry) => <GateError message="Tietojasi ei saatu ladattua. Tarkista verkkoyhteys ja yritä uudelleen." error={error} onRetry={retry} onSignOut={() => api.auth.signOut()} />}
    >
      <PlayerShell banner={banner} />
    </DataProvider>
  );
}
