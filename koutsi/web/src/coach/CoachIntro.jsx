// CoachIntro.jsx — the coach's first-visit film (shared/intro) and what gets a new coach going:
//   CoachIntro   the film; its last card has the three first steps, and "Luo ensimmäinen ryhmä"
//                opens the group form the moment the film closes. Opens by itself once (until
//                welcome_seen_at is set), again from Profiili → Katso esittely, or with ?esittely.
//   FirstSteps   the same three steps as a card on Koti while the coach has no players yet
//                (an existing coach always has players, so they never see it).
import { useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { useIsDesktop } from '../app/hooks.js';
import { dropQueryParam } from '../app/router.js';
import { Button, Card, Illustration } from '../ui/index.js';
import { WelcomeHelp } from '../shared/welcome.jsx';
import { IntroFilm, IntroSteps, introAskedInUrl, replayIntro, useIntroReplay } from '../shared/intro/IntroFilm.jsx';
import { coachScenes } from '../shared/intro/scenes.jsx';
import { BulkSetupSheet } from './BulkSetupSheet.jsx';
import { GroupFormSheet } from './groupForms.jsx';
import { openInvites, openPlanner } from './nav.js';
import { plannerDefaultWeek } from '../domain/week.js';
import { track } from './usage.js';
import { ScaleQuestionSheet, useNeedsLevelAnswer } from './levels.jsx';


/** The three first steps and which are done: a group, players, a theme. */
export function coachFirstSteps(state) {
  const groups = state.groups.length > 0;
  return [
    { id: 'ryhma', title: 'Luo ryhmä', text: 'Valitse päivä ja kellonaika, niin treenit tulevat kalenteriin.', done: groups },
    { id: 'pelaajat', title: 'Kutsu pelaajat', text: 'Lähetä ryhmän linkki vaikka WhatsAppiin, tai lisää pelaajat itse.', done: state.students.length > 0 },
    { id: 'teema', title: 'Aseta viikon teema', text: 'Kirjoita teema kerran, niin pelaajat näkevät sen ennen treeniä.', done: state.groups.some((g) => (g.themes || []).length > 0) },
  ];
}

export function CoachIntro({ firstVisit }) {
  const { state, run, ownerId } = useData();
  const isDesktop = useIsDesktop();
  // ?esittely opens it too (?esittely=3 on the third scene), once
  const [[asked, start], setAsked] = useState(introAskedInUrl);
  const [open, setOpen] = useState(() => Boolean(firstVisit) || asked);
  const [then, setThen] = useState(null); // 'group' | 'bulk': opens when the film has closed
  // a new coach's first close asks how they mark levels, then opens what the film's last card chose
  const [levelsThen, setLevelsThen] = useState(undefined); // undefined = not asking; null | 'group' | 'bulk' after it
  const needsLevels = useNeedsLevelAnswer();
  useIntroReplay(() => { track('esittely.uudelleen'); setOpen(true); });
  const close = (next = null) => {
    setOpen(false);
    if (asked) { dropQueryParam('esittely'); setAsked([false, 0]); }
    const first = !state.coach.welcomeSeenAt;
    if (first) run(() => api.coach.markWelcomeSeen(ownerId), null);
    if (needsLevels) { setLevelsThen(next); return; }
    if (next) setThen(next);
  };
  const levelsDone = () => { const next = levelsThen; setLevelsThen(undefined); if (next) setThen(next); };
  const scenes = useMemo(() => coachScenes({ name: state.coach.name, desktop: isDesktop }), [state.coach.name, isDesktop]);
  const steps = coachFirstSteps(state);
  const hasGroups = state.groups.length > 0;
  const finale = (
    <div className="ki-fin">
      <Illustration name="celebrate" size={112} className="ki-fin-art" />
      <h2 id="k-intro-title" className="ki-fin-title">Aloitetaan!</h2>
      <p className="ki-fin-text">Kolme askelta, niin viikko pyörii:</p>
      <IntroSteps steps={steps} />
      <div className="ki-fin-actions">
        {hasGroups ? (
          <Button variant="dark" size="lg" block onClick={() => { track('esittely.koti'); close(); }}>Siirry Kotiin</Button>
        ) : (
          <>
            <Button variant="lime" size="lg" block icon="plus" onClick={() => { track('esittely.luo-ryhma'); close('group'); }}>Luo ensimmäinen ryhmä</Button>
            <Button variant="outline" size="lg" block icon="list" onClick={() => { track('esittely.monta'); close('bulk'); }}>Lisää monta ryhmää kerralla</Button>
            <Button variant="ghost" size="md" block onClick={() => close()}>Katson ensin itse</Button>
          </>
        )}
        <WelcomeHelp place={isDesktop ? 'sivupalkin alaosassa' : 'Lisää-valikossa'} />
        <p className="ki-fin-fine">Esittelyn voi katsoa uudelleen Profiilista.</p>
      </div>
    </div>
  );
  return (
    <>
      <IntroFilm open={open} onClose={() => close()} scenes={scenes} role="coach" desktop={isDesktop} me={state.coach}
        start={start} finale={finale} onEvent={(e) => track(`esittely.${e}`)} />
      <ScaleQuestionSheet open={levelsThen !== undefined} onDone={levelsDone} onCancel={() => setLevelsThen(undefined)} />
      <GroupFormSheet open={then === 'group'} onClose={() => setThen(null)} />
      <BulkSetupSheet open={then === 'bulk'} onClose={() => setThen(null)} />
    </>
  );
}

/** Koti's "Aloitetaan" card while there are no players: the steps and a button for the next one. */
export function FirstSteps() {
  const { state } = useData();
  const [sheet, setSheet] = useState(null);
  const steps = coachFirstSteps(state);
  const next = steps.find((s) => !s.done);
  const done = steps.filter((s) => s.done).length;
  return (
    <Card className="k-first-steps ki-first">
      <div className="ki-first-head">
        <h2 className="k-block-title">Aloitetaan</h2>
        <span className="ki-first-count">{done}/{steps.length} valmiina</span>
      </div>
      <IntroSteps steps={steps} />
      <div className="row wrap">
        {next?.id === 'ryhma' && (
          <>
            <Button variant="dark" icon="plus" onClick={() => setSheet('group')}>Luo ryhmä</Button>
            <Button variant="outline" icon="list" onClick={() => setSheet('bulk')}>Lisää monta kerralla</Button>
          </>
        )}
        {next?.id === 'pelaajat' && <Button variant="dark" icon="send" onClick={() => { track('aloitus.kutsu'); openInvites(); }}>Kutsu pelaajat</Button>}
        {next?.id === 'teema' && <Button variant="dark" icon="sparkles" onClick={() => { track('aloitus.teema'); openPlanner({ week: plannerDefaultWeek() }); }}>Aseta teema</Button>}
        <Button variant="ghost" icon="play" onClick={() => replayIntro()}>Katso esittely</Button>
      </div>
      <GroupFormSheet open={sheet === 'group'} onClose={() => setSheet(null)} />
      <BulkSetupSheet open={sheet === 'bulk'} onClose={() => setSheet(null)} />
    </Card>
  );
}
