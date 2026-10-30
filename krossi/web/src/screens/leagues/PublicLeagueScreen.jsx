// PublicLeagueScreen — what a logged-out visitor of a league link sees (no app chrome).
// Public leagues (hallisarja "Julkinen sarjataulukko") show their groups, standings and results
// with names as "Mikko V." — e.g. linked from a tennis hall's website. Other leagues show a
// sign-in invitation. The Gate remembers the link and opens the league after sign-in.
import { api } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { navigate } from '../../app/router.js';
import { plural } from '../../lib/format.js';
import { Button, EmptyState, ErrorState, Icon, Illustration, SkeletonList } from '../../ui/index.js';
import { SeasonView } from './LeagueScreen.jsx';
import { formatLabel, isTimed, leaguePhase, levelLabel, roundOf, roundRange } from './leagueUtils.js';

export function PublicLeagueScreen({ params }) {
  const { data: league, error, loading, reload } = useAsync(() => api.leagues.publicGet(params.id), [params.id]);

  let content;
  if (loading) {
    content = <div className="leagues-public-body" aria-busy="true" aria-label="Ladataan sarjataulukkoa"><SkeletonList count={5} variant="row" /></div>;
  } else if (error) {
    content = <div className="leagues-public-body"><ErrorState error={error} onRetry={() => reload()} /></div>;
  } else if (!league) {
    content = (
      <div className="leagues-public-missing rise">
        <Illustration name="search" size={150} />
        <h1 className="leagues-public-title">Tämä liiga näkyy Krossin pelaajille</h1>
        <p className="leagues-public-lead">Kirjaudu tai luo tili, niin näet lohkot, sarjataulukon ja voit ilmoittautua mukaan.</p>
        <Button variant="lime" size="lg" icon="log-in" onClick={() => navigate('/pelaa')}>Kirjaudu Krossiin</Button>
      </div>
    );
  } else {
    const phase = leaguePhase(league);
    const current = roundOf(league, league.currentRound);
    const next = roundOf(league, (league.currentRound || 0) + 1);
    content = (
      <>
        <section className="leagues-hero court-lines on-dark leagues-public-hero rise">
          <div className="eyebrow">{formatLabel(league)}, {league.city}</div>
          <h1 className="leagues-hero-title">{league.seasonLabel}</h1>
          <div className="leagues-hero-facts">
            <span><Icon name="target" size={16} />{levelLabel(league.skillLevel)}</span>
            <span><Icon name="users" size={16} />{plural(league.memberCount, 'pelaaja', 'pelaajaa')}</span>
            <span><Icon name="clock" size={16} />{isTimed(league) ? 'Tunnin aikapeli' : 'Erät'}</span>
            {league.venue && <span><Icon name="pin" size={16} />{league.venue}</span>}
            {league.organizer?.name && <span><Icon name="shield" size={16} />Ylläpitäjä: {league.organizer.name}</span>}
          </div>
          {phase === 'round' && current && (
            <p className="leagues-public-round"><Icon name="calendar" size={15} />Kierros {current.roundNumber} käynnissä, {roundRange(current)}</p>
          )}
          {phase !== 'round' && phase !== 'finished' && next && (
            <p className="leagues-public-round"><Icon name="calendar" size={15} />{next.roundNumber === 1 ? '1. kierros' : `Kierros ${next.roundNumber}`}, {roundRange(next)}</p>
          )}
          {phase === 'finished' && <p className="leagues-public-round"><Icon name="flag" size={15} />Kausi päättynyt</p>}
        </section>

        <div className="leagues-public-body">
          {phase === 'signup'
            ? <EmptyState art="league" title="Ilmoittautuminen on auki" text="Lohkot jaetaan ennen 1. kierrosta. Ilmoittaudu Krossissa, niin pääset mukaan." />
            : <SeasonView league={league} meId={null} readOnly />}
        </div>

        <section className="leagues-public-cta rise">
          <div>
            <h2 className="leagues-public-cta-title">Pelaatko tässä sarjassa?</h2>
            <p className="leagues-public-lead">Krossissa sovit ottelut vastustajan kanssa chatissa ja ilmoitat tuloksen heti pelin jälkeen — sarjataulukko päivittyy itsestään.</p>
          </div>
          <Button variant="lime" size="lg" icon="bolt" onClick={() => navigate('/pelaa')}>Liity Krossiin</Button>
        </section>
      </>
    );
  }

  return (
    <div className="leagues-public">
      <header className="leagues-public-top">
        <a href="https://krossi.app" className="leagues-public-logo" aria-label="Krossi — etusivu">Krossi</a>
        <button type="button" className="leagues-public-toplink" onClick={() => navigate('/pelaa')}>Kirjaudu</button>
      </header>
      <main className="leagues-public-main">{content}</main>
      <footer className="leagues-public-foot">Krossi – tennispelit ja -sarjat<br />krossi.app</footer>
    </div>
  );
}
