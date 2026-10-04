// PlayerScreen — /pelaa/pelaaja/:id: one player's profile with "Pyydä pelaamaan" and
// "Kutsu peliin". Own id redirects to /pelaa/profiili; unpaid users get a locked teaser.
import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';
import { openCreateGame } from '../../app/AppShell.jsx';
import { useAsync, useNow } from '../../app/hooks.js';
import { LockedPreview, usePaywall } from '../../app/paywall.jsx';
import { goBack, navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { BACKHAND_TYPES, HANDEDNESS, labelOf } from '../../lib/constants.js';
import { firstName, relativeLong } from '../../lib/format.js';
import {
  Avatar, AvatarStack, Button, Chip, EmptyState, ErrorState, Icon, IconButton, ListRow, Page, Sheet, Skeleton,
  TopBar, useConfirm, useToast,
} from '../../ui/index.js';
import { LevelTag } from '../shared/PlayerCard.jsx';
import { PlayRequestSheet } from './PlayRequestSheet.jsx';
import { ReportSheet } from './ReportSheet.jsx';
import { ageText, availabilityDetails, isPlayingNow, lockedPreviewPlayers, playerStatus, styleLabel, timeLeft } from './playerInfo.js';

const cx = (...c) => c.filter(Boolean).join(' ');

export function PlayerScreen({ params }) {
  const id = params?.id;
  const { user, profile } = useSession();
  const { paid, requirePaid } = usePaywall();
  const toast = useToast();
  const confirm = useConfirm();
  const now = useNow(30_000);
  const isMe = Boolean(user?.id && id === user.id);
  const [requestOpen, setRequestOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const [blocking, setBlocking] = useState(false);

  useEffect(() => { if (isMe) navigate('/pelaa/profiili', { replace: true }); }, [isMe]);
  useEffect(() => { setRequested(false); }, [id]);

  const active = paid && !isMe && Boolean(id);
  const { data: player, error, loading, reload } = useAsync(() => (active ? api.players.get(id) : Promise.resolve(null)), [id, active]);
  const partners = useAsync(() => (active ? api.players.listPartners() : Promise.resolve([])), [active]);

  if (isMe) return null;

  if (!paid) {
    const fake = lockedPreviewPlayers(now)[2];
    return (
      <>
        <TopBar title="Pelaaja" back="/pelaa/pelaajat" />
        <Page>
          <div className="players-detail">
            <LockedPreview
              title="Pelaajaprofiilit ovat lukittuna"
              text="Avaa Krossi, niin näet pelaajan tason, pelityylin ja milloin hän ehtii — ja voit pyytää häntä pelaamaan."
            >
              <PlayerHero player={{ ...fake, areas: ['Lahti'], playingThisWeek: true }} now={now} />
              <div className="players-panels">
                <Panel title="Pelityyli" icon="racket"><div className="players-chips"><Chip tone="neutral">Matsit</Chip><Chip tone="neutral">Treenit</Chip></div></Panel>
                <Panel title="Milloin ehtii" icon="clock"><div className="players-chips"><Chip tone="neutral">Aamuvirkku 6–9</Chip><Chip tone="neutral">Viikonloppuaamut 9–12</Chip></div></Panel>
                <Panel title="Bio" icon="chat" className="players-panel-bio"><p className="players-bio">Treenaan kisoihin ja etsin tasaisia sparrauksia aamuisin ennen töitä.</p></Panel>
              </div>
            </LockedPreview>
          </div>
        </Page>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <TopBar title="Pelaaja" back="/pelaa/pelaajat" />
        <Page><div className="players-detail"><HeroSkeleton /></div></Page>
      </>
    );
  }

  if (error || !player) {
    return (
      <>
        <TopBar title="Pelaaja" back="/pelaa/pelaajat" />
        <Page>
          {error ? (
            <ErrorState error={error} onRetry={() => reload()} />
          ) : (
            <EmptyState
              art="search"
              title="Pelaajaa ei löytynyt"
              text="Profiili on piilotettu tai poistettu, tai olet estänyt pelaajan."
              action={<Button variant="dark" icon="users" onClick={() => navigate('/pelaa/pelaajat', { replace: true })}>Selaa pelaajia</Button>}
            />
          )}
        </Page>
      </>
    );
  }

  const first = firstName(player.name);
  const together = (partners.data || []).find((p) => p.player?.id === player.id) || null;
  const slots = availabilityDetails(player.availability);
  const handed = labelOf(HANDEDNESS, player.handedness);
  const backhand = labelOf(BACKHAND_TYPES, player.backhand);

  const askToPlay = () => requirePaid(() => setRequestOpen(true), 'Pyydä pelaamaan');
  const inviteToGame = () => requirePaid(() => openCreateGame(`?kutsu=${encodeURIComponent(player.id)}`), 'Kutsu peliin');
  const openReport = () => { setMoreOpen(false); setReportOpen(true); };
  const doBlock = async () => {
    setMoreOpen(false);
    const ok = await confirm({
      title: `Estetäänkö ${first}?`,
      message: 'Hän katoaa pelaajalistaltasi, eikä hän voi lähettää sinulle pyyntöjä. Voit purkaa eston asetuksista.',
      confirmLabel: 'Estä',
      danger: true,
    });
    if (!ok) return;
    setBlocking(true);
    try {
      await api.social.block(player.id);
      toast(`${first} estetty.`, { icon: 'shield' });
      goBack('/pelaa/pelaajat');
    } catch (err) {
      toast(err);
      setBlocking(false);
    }
  };

  return (
    <>
      <TopBar
        title={player.name}
        back="/pelaa/pelaajat"
        tone="transparent"
        actions={<IconButton icon="more" label="Lisää toimintoja" onClick={() => setMoreOpen(true)} disabled={blocking} />}
      />
      <Page>
        <div className="players-detail">
          <PlayerHero player={player} now={now} />

          <TogetherCard me={profile} player={player} partner={together} loading={partners.loading} />

          <div className="players-panels stagger">
            {player.playStyles?.length > 0 && (
              <Panel title="Pelityyli" icon="racket" style={{ '--i': 0 }}>
                <div className="players-chips">
                  {player.playStyles.map((s) => <Chip key={s} tone="neutral">{styleLabel(s)}</Chip>)}
                </div>
              </Panel>
            )}
            {(handed || backhand) && (
              <Panel title="Kätisyys & rysty" icon="target" style={{ '--i': 1 }}>
                <div className="players-facts">
                  {handed && <Fact label="Kätisyys" value={handed} />}
                  {backhand && <Fact label="Rysty" value={backhand.replace(' rysty', '')} />}
                </div>
              </Panel>
            )}
            {slots.length > 0 && (
              <Panel title="Milloin ehtii" icon="clock" style={{ '--i': 2 }}>
                <div className="players-slots">
                  {slots.map((s) => (
                    <span key={s.value} className="players-slot">
                      <span className="players-slot-label">{s.label}</span>
                      {s.time && <span className="players-slot-time t-num">{s.time}</span>}
                    </span>
                  ))}
                </div>
              </Panel>
            )}
            {player.bio && (
              <Panel title="Bio" icon="chat" style={{ '--i': 3 }} className="players-panel-bio">
                <p className="players-bio">{player.bio}</p>
              </Panel>
            )}
          </div>

          <div className="players-actions">
            <Button variant="lime" size="lg" icon={requested ? 'check' : 'send'} onClick={askToPlay} disabled={requested} className="players-actions-main">
              {requested ? 'Pyyntö lähetetty' : 'Pyydä pelaamaan'}
            </Button>
            <Button variant="dark" size="lg" icon="calendar-plus" onClick={inviteToGame} className="players-actions-alt" aria-label="Kutsu peliin">
              <span className="players-actions-long">Kutsu peliin</span>
              <span className="players-actions-short">Kutsu</span>
            </Button>
          </div>
        </div>
      </Page>

      <PlayRequestSheet open={requestOpen} onClose={() => setRequestOpen(false)} player={player} onSent={() => setRequested(true)} />
      <ReportSheet open={reportOpen} onClose={() => setReportOpen(false)} player={player} />
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} size="sm" title={player.name} subtitle="Turvallisuus">
        <div className="list-group">
          <ListRow icon="flag" title="Ilmoita pelaajasta" subtitle="Ylläpito käsittelee ilmoituksen luottamuksellisesti" onClick={openReport} />
          <ListRow icon="eye-off" tone="danger" title={`Estä ${first}`} subtitle="Hän katoaa pelaajalistaltasi" onClick={doBlock} chevron={false} />
        </div>
      </Sheet>
    </>
  );
}

function PlayerHero({ player, now }) {
  const status = playerStatus(player, now);
  const playingNow = isPlayingNow(player, now);
  const age = ageText(player.ageRange);
  const cities = player.areas?.length ? player.areas : player.city ? [player.city] : [];
  return (
    <section className={cx('players-hero', 'court-lines', 'on-dark', playingNow && 'is-now')}>
      <div className={cx('players-hero-avatar', status && `is-${status}`)}>
        <Avatar person={player} size={104} className="players-hero-photo" />
      </div>
      <h1 className="players-hero-name">
        {player.name}
        {age && <span className="players-hero-age">{age}</span>}
      </h1>
      {cities.length > 0 && (
        <p className="players-hero-cities"><Icon name="pin" size={15} />{cities.join(' · ')}</p>
      )}
      <div className="players-hero-tags">
        <LevelTag player={player} short={false} tone="on-dark" />
        {!playingNow && player.playingThisWeek && <Chip tone="on-dark" dot="live">Pelaa tällä viikolla</Chip>}
      </div>
      {playingNow && (
        <div className="players-now pop">
          <span className="players-now-icon"><Icon name="bolt" size={20} strokeWidth={2.4} /></span>
          <span className="players-now-text">
            <span className="players-now-title">Pelaa nyt <span className="players-now-left">{timeLeft(player.playingNowUntil, now)}</span></span>
            {player.playingNowNote && <span className="players-now-note">“{player.playingNowNote}”</span>}
          </span>
        </div>
      )}
    </section>
  );
}

function TogetherCard({ me, player, partner, loading }) {
  if (loading) return <div className="players-together"><Skeleton w={64} h={36} r={999} /><Skeleton w="55%" h={14} /></div>;
  const n = partner?.gamesTogether || 0;
  return (
    <div className={cx('players-together', n > 0 && 'has-games')}>
      <AvatarStack people={[me || { id: 'me', name: 'Minä', avatarColor: 'green' }, player]} max={2} size={36} />
      <span className="players-together-text">
        {n > 0 ? (
          <>
            <span className="players-together-title">Olette pelanneet yhdessä {n === 1 ? 'kerran' : <><span className="t-num">{n}</span> kertaa</>}</span>
            {partner.lastPlayedAt && <span className="players-together-sub">Viimeksi {relativeLong(partner.lastPlayedAt)}</span>}
          </>
        ) : (
          <>
            <span className="players-together-title">Ette ole vielä pelanneet yhdessä</span>
            <span className="players-together-sub">Pyydä pelaamaan — eka yhteinen matsi odottaa.</span>
          </>
        )}
      </span>
      {n > 0 && <span className="players-together-badge t-num" aria-hidden="true">{n}</span>}
    </div>
  );
}

function Panel({ title, icon, children, className, style }) {
  return (
    <section className={cx('players-panel', className)} style={style}>
      <h2 className="players-panel-title"><Icon name={icon} size={16} />{title}</h2>
      {children}
    </section>
  );
}

function Fact({ label, value }) {
  return (
    <span className="players-fact">
      <span className="players-fact-label">{label}</span>
      <span className="players-fact-value">{value}</span>
    </span>
  );
}

function HeroSkeleton() {
  return (
    <div aria-busy="true" aria-label="Ladataan">
      <div className="players-hero players-hero-skeleton">
        <Skeleton w={112} h={112} r={999} />
        <Skeleton w={160} h={22} />
        <Skeleton w={110} h={14} />
        <Skeleton w={190} h={28} r={999} />
      </div>
      <div className="players-panels">
        {[0, 1].map((i) => (
          <div key={i} className="players-panel">
            <Skeleton w={110} h={14} />
            <div className="players-chips"><Skeleton w={84} h={30} r={999} /><Skeleton w={96} h={30} r={999} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
