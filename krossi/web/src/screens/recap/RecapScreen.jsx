// RecapScreen — /pelaa/kooste/:period ('2026-09' or 'kausi-2026'): the month / season recap as
// full-screen story slides (StoryPlayer), ending in a shareable summary card.
import { useCallback, useMemo } from 'react';
import { Button, EmptyState, ErrorState, Page, Skeleton, TopBar, useToast } from '../../ui/index.js';
import { buildRecap, parsePeriod } from '../../features/recap.js';
import { goBack, navigate, useRoute } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { usePaywall } from '../../app/paywall.jsx';
import { useBusy } from '../../app/hooks.js';
import { openCreateGame } from '../../app/AppShell.jsx';
import { useActivity } from '../shared/useActivity.js';
import { StoryPlayer } from './StoryPlayer.jsx';
import { buildSlides } from './slides.jsx';
import { periodWords } from './copy.js';
import { shareRecapImage } from './shareCard.js';

const close = () => goBack('/pelaa/profiili');

export function RecapScreen({ params }) {
  const period = useMemo(() => parsePeriod(params.period), [params.period]);
  if (!period) {
    return (
      <>
        <TopBar title="Kooste" back="/pelaa/profiili" />
        <Page>
          <EmptyState
            art="search"
            title="Tätä koostetta ei löytynyt"
            text="Linkki voi olla vanha tai väärin kirjoitettu. Kaikki koosteesi löytyvät profiilistasi."
            action={<Button variant="dark" icon="user" onClick={() => navigate('/pelaa/profiili', { replace: true })}>Profiiliin</Button>}
          />
        </Page>
      </>
    );
  }
  return <RecapLoader period={period} />;
}

function RecapLoader({ period }) {
  const { activity, loading, error, reload } = useActivity();
  const recap = useMemo(() => (activity ? buildRecap(activity, period, new Date()) : null), [activity, period]);
  if (error) {
    return (
      <>
        <TopBar title="Kooste" back="/pelaa/profiili" />
        <Page><ErrorState error={error} onRetry={() => reload()} title="Koostetta ei saatu ladattua" /></Page>
      </>
    );
  }
  if (loading || !recap) return <RecapLoading />;
  return <RecapStory key={recap.key} recap={recap} />;
}

function RecapLoading() {
  return (
    <div className="recap recap-bg-green" aria-busy="true" aria-label="Ladataan koostetta">
      <div className="recap-backdrop" aria-hidden="true" />
      <div className="recap-story">
        <div className="recap-top">
          <div className="recap-bars">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="recap-bar" />)}</div>
        </div>
        <div className="recap-slide">
          <div className="recap-body recap-loading">
            <Skeleton w="34%" h={12} className="recap-skel" />
            <Skeleton w="82%" h={48} r={12} className="recap-skel" />
            <Skeleton w="58%" h={48} r={12} className="recap-skel" />
            <Skeleton w="72%" h={64} r={18} className="recap-skel" />
          </div>
        </div>
      </div>
    </div>
  );
}

function RecapStory({ recap }) {
  const route = useRoute();
  const toast = useToast();
  const { profile } = useSession();
  const { requirePaid } = usePaywall();
  const [sharing, runShare] = useBusy();
  const words = useMemo(() => periodWords(recap.period), [recap.period]);
  const slides = useMemo(() => buildSlides(recap), [recap]);

  const onShare = useCallback(() => runShare(async () => {
    try {
      const result = await shareRecapImage(recap, { name: profile?.name });
      if (result === 'downloaded') toast('Kuva tallennettu — jaa se vaikka storyyn!', { icon: 'download' });
    } catch (err) {
      toast('Kuvan teko ei onnistunut. Yritä uudelleen.', { tone: 'error' });
    }
  }), [runShare, recap, profile?.name, toast]);

  const ctx = {
    recap,
    words,
    sharing,
    onShare,
    onClose: close,
    onPlay: () => requirePaid(() => openCreateGame()),
    onSeason: () => navigate(`/pelaa/kooste/kausi-${recap.period.year}`, { replace: true }),
  };
  return <StoryPlayer slides={slides} ctx={ctx} label={words.name} onClose={close} blocked={route.name !== 'recap'} />;
}
