// PlayerIntro.jsx — the player's first-visit film (shared/intro): Koti, Viikko, Merkitse, Kehitys
// and Lisää, then "Aloitetaan" with the first thing worth doing: a goal for the season (the coach
// sees it). Opens by itself once (until welcome_seen_at is set), again from Profiili → Katso
// esittely, or with ?esittely.
import { useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { useIsDesktop } from '../app/hooks.js';
import { dropQueryParam } from '../app/router.js';
import { Button, Illustration } from '../ui/index.js';
import { WelcomeHelp } from '../shared/welcome.jsx';
import { IntroFilm, IntroSteps, introAskedInUrl, useIntroReplay } from '../shared/intro/IntroFilm.jsx';
import { playerScenes } from '../shared/intro/scenes.jsx';
import { usePlayerActions } from './PlayerApp.jsx';

const track = (name) => { api.account.trackEvent(name).catch(() => {}); };

export function PlayerIntro({ firstVisit }) {
  const { state, run, ownerId } = useData();
  const actions = usePlayerActions();
  const isDesktop = useIsDesktop();
  const student = state.students[0];
  // ?esittely opens it too (?esittely=3 on the third scene), once
  const [[asked, start], setAsked] = useState(introAskedInUrl);
  const [open, setOpen] = useState(() => Boolean(firstVisit) || asked);
  useIntroReplay(() => { track('pelaaja.esittely.uudelleen'); setOpen(true); });
  const close = () => {
    setOpen(false);
    if (asked) { dropQueryParam('esittely'); setAsked([false, 0]); }
    // the old Koutsi reads this key: it doesn't show its own "what is Koutsi" screen again
    try { localStorage.setItem(`koutsi_purpose_seen_${ownerId}`, '1'); } catch { /* private mode */ }
    if (!student.welcomeSeenAt) run(() => api.player.markWelcomeSeen(ownerId), null);
  };
  const scenes = useMemo(() => playerScenes({ name: student.name, desktop: isDesktop }), [student.name, isDesktop]);
  const hasGoal = Boolean((student.goal || '').trim());
  const steps = [
    { title: 'Aseta tavoite', text: 'Mitä haluat oppia tällä kaudella? Valmentajasi näkee sen.', done: hasGoal },
    { title: 'Katso seuraava treeni', text: 'Kodista näet sen teeman jo ennen treeniä.', done: false },
    { title: 'Kerro, miten meni', text: 'Treenin jälkeen Merkitse-nappi kysyy fiiliksen.', done: false },
  ];
  const finale = (
    <div className="ki-fin">
      <Illustration name="celebrate" size={112} className="ki-fin-art" />
      <h2 id="k-intro-title" className="ki-fin-title">Aloitetaan!</h2>
      <p className="ki-fin-text">Näillä pääset hyvin alkuun:</p>
      <IntroSteps steps={steps} />
      <div className="ki-fin-actions">
        {hasGoal ? (
          <Button variant="dark" size="lg" block onClick={() => { track('pelaaja.esittely.koti'); close(); }}>Siirry Kotiin</Button>
        ) : (
          <>
            <Button variant="lime" size="lg" block icon="target" onClick={() => { track('pelaaja.esittely.tavoite'); close(); actions.openGoals(); }}>Aseta tavoite</Button>
            <Button variant="ghost" size="md" block onClick={close}>Myöhemmin</Button>
          </>
        )}
        <WelcomeHelp place={isDesktop ? 'sivupalkin alaosassa' : 'Lisää-valikossa'} />
        <p className="ki-fin-fine">Esittelyn voi katsoa uudelleen Profiilista.</p>
      </div>
    </div>
  );
  return (
    <IntroFilm open={open} onClose={close} scenes={scenes} role="player" desktop={isDesktop} me={student}
      start={start} finale={finale} onEvent={(e) => track(`pelaaja.esittely.${e}`)} />
  );
}
