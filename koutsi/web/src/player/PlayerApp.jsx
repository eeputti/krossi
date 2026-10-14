// PlayerApp.jsx — the signed-in player: state, chrome, screens, and the sheets for the
// player's own writes (opened from anywhere through usePlayerActions()).
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { AppShell } from '../app/AppShell.jsx';
import { DataProvider, useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { GateError, Splash } from '../shared/gates.jsx';
import { Button, EmptyState, Icon, Page, Sheet } from '../ui/index.js';
import { VideoPlayerSheet, VideoShareSheet } from '../shared/videos.jsx';
import { RenewedIntro, showBetaBar } from '../shared/renewed.jsx';
import { useToast } from '../ui/index.js';
import { TABS } from './routes.js';
import { HomeScreen } from './HomeScreen.jsx';
import { ProgressScreen } from './ProgressScreen.jsx';
import { TrainingsScreen } from './TrainingsScreen.jsx';
import { GroupScreen } from './GroupScreen.jsx';
import { ExercisesScreen } from './ExercisesScreen.jsx';
import { ProfileScreen } from './ProfileScreen.jsx';
import { AbsenceSheet, MatchNoteSheet, MoodSheet, PlayerTextSheet, SelfTrainingSheet } from './sheets.jsx';

const ActionsContext = createContext(null);
/** openSelfTraining(date?), openMood(score?), openMatch({ editing?, date? }), openAbsence(training), openText(kind), openVideo(), playVideo(video) */
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

function PlayerShell({ banner }) {
  const { state, ownerId, reload } = useData();
  const toast = useToast();
  const student = state.students[0];
  const [sheet, setSheet] = useState(null);
  const [video, setVideo] = useState(null);
  const close = () => setSheet(null);
  const actions = useMemo(() => ({
    openSelfTraining: (date) => setSheet({ kind: 'self', date }),
    openMood: (score = null) => setSheet({ kind: 'mood', score }),
    openMatch: ({ editing, date } = {}) => setSheet({ kind: 'match', editing, date }),
    openAbsence: (training) => setSheet({ kind: 'absence', training }),
    openText: (kind) => setSheet({ kind: 'text', textKind: kind }),
    openVideo: () => setSheet({ kind: 'video' }),
    playVideo: (v) => setVideo(v),
  }), []);
  const saveOwnVideo = useCallback(async (payload) => {
    await api.videos.share({ ...payload, studentIds: [ownerId], addedById: ownerId });
    await reload().catch(() => {});
    toast('Video tallennettu.');
  }, [ownerId, reload, toast]);
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
      <SelfTrainingSheet open={sheet?.kind === 'self'} defaultDate={sheet?.date} onClose={close} onSwitchToMatch={(date) => setSheet({ kind: 'match', date })} />
      <MoodSheet open={sheet?.kind === 'mood'} initialScore={sheet?.score ?? null} studentId={ownerId} onClose={close} />
      <MatchNoteSheet open={sheet?.kind === 'match'} editing={sheet?.editing} defaultDate={sheet?.date} onClose={close} />
      <AbsenceSheet open={sheet?.kind === 'absence'} training={sheet?.training} onClose={close} />
      <PlayerTextSheet open={sheet?.kind === 'text'} kind={sheet?.textKind} initial={textInitial} onClose={close} />
      <VideoShareSheet open={sheet?.kind === 'video'} onClose={close} title="Lisää oma video" onSave={saveOwnVideo} />
      <VideoPlayerSheet video={video} onClose={() => setVideo(null)} />
      {!student.welcomeSeenAt && <WelcomeSheet student={student} />}
      <RenewedIntro role="player" eligible={Boolean(student.welcomeSeenAt)} />
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
