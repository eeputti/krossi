// PartnersScreen — /pelaa/pelikaverit: people I've actually played with, most played first,
// with "Pelaa uudestaan" (opens Luo peli with the invite prefilled).
import { api } from '../../api/index.js';
import { openCreateGame } from '../../app/AppShell.jsx';
import { useAsync, useNow } from '../../app/hooks.js';
import { usePaywall } from '../../app/paywall.jsx';
import { navigate } from '../../app/router.js';
import { firstName, plural, relativeLong } from '../../lib/format.js';
import { AvatarStack, Button, Chip, CountUp, EmptyState, ErrorState, Page, SkeletonList, TopBar } from '../../ui/index.js';
import { PlayerCard } from '../shared/PlayerCard.jsx';

export function PartnersScreen() {
  const { requirePaid } = usePaywall();
  const now = useNow(60_000);
  const { data, error, loading, reload } = useAsync(() => api.players.listPartners(), []);

  const playAgain = (player) => requirePaid(() => openCreateGame(`?kutsu=${encodeURIComponent(player.id)}`), 'Pelaa uudestaan');

  let body;
  if (loading) {
    body = <><div className="players-partners-hero players-partners-hero-skeleton" aria-hidden="true" /><SkeletonList count={5} /></>;
  } else if (error) {
    body = <ErrorState error={error} onRetry={() => reload()} />;
  } else if (!data?.length) {
    body = (
      <EmptyState
        art="racket"
        title="Ei vielä pelikavereita"
        text="Pelikaverit ilmestyvät tänne, kun olet pelannut ensimmäisen pelisi."
        action={(
          <>
            <Button variant="lime" icon="plus" onClick={() => requirePaid(() => openCreateGame(), 'Luo peli')}>Luo peli</Button>
            <Button variant="outline" icon="users" onClick={() => navigate('/pelaa/pelaajat')}>Selaa pelaajia</Button>
          </>
        )}
      />
    );
  } else {
    const games = data.reduce((sum, p) => sum + (p.gamesTogether || 0), 0);
    const top = data[0];
    body = (
      <>
        <section className="players-partners-hero court-lines on-dark">
          <div className="eyebrow">Sinun porukkasi</div>
          <div className="players-partners-hero-top">
            <div className="players-partners-hero-num t-num"><CountUp value={data.length} /></div>
            <AvatarStack people={data.map((p) => p.player)} max={4} size={40} />
          </div>
          <div className="players-partners-hero-label">{data.length === 1 ? 'pelikaveri' : 'pelikaveria'} · {plural(games, 'yhteinen peli', 'yhteistä peliä')}</div>
          {top.gamesTogether > 1 && (
            <p className="players-partners-hero-mate">
              Useimmin kentällä kanssasi: <strong>{firstName(top.player.name)}</strong> · {plural(top.gamesTogether, 'peli', 'peliä')}
            </p>
          )}
        </section>

        <div className="players-list players-partners-list stagger">
          {data.map((p, i) => {
            const meta = [plural(p.gamesTogether, 'yhteinen peli', 'yhteistä peliä'), p.lastPlayedAt ? `viimeksi ${relativeLong(p.lastPlayedAt, now)}` : null].filter(Boolean).join(' · ');
            return (
              <PlayerCard
                key={p.player.id}
                player={p.player}
                style={{ '--i': i }}
                subtitle={meta}
                badge={i === 0 && p.gamesTogether > 1 ? <Chip tone="clay" size="sm" icon="crown">Eniten pelattu</Chip> : null}
                onClick={() => navigate(`/pelaa/pelaaja/${p.player.id}`)}
                right={(
                  <Button variant="soft" size="sm" icon="repeat" onClick={() => playAgain(p.player)} aria-label={`Pelaa uudestaan: ${p.player.name}`}>
                    <span className="players-again-long">Pelaa uudestaan</span>
                    <span className="players-again-short">Pelaa</span>
                  </Button>
                )}
              />
            );
          })}
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Pelikaverit" back="/pelaa/pelaajat" />
      <Page className="players-page">{body}</Page>
    </>
  );
}
