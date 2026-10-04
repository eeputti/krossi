// GameScreen — /pelaa/peli/:id. Dark hero (date, time, venue, countdown), details, players with
// empty slots, and a floating action bar: join / waitlist / chat / invite + share + calendar.
import { useState } from 'react';
import { api } from '../../api/index.js';
import { openCreateGame } from '../../app/AppShell.jsx';
import { useAsync, useBusy, useNow } from '../../app/hooks.js';
import { LockedPreview, usePaywall } from '../../app/paywall.jsx';
import { appUrl, navigate, goBack } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import {
  Avatar, Button, Card, Chip, EmptyState, ErrorState, Icon, IconButton, ListRow, Page, Section, Skeleton, TopBar,
  confetti, useConfirm, useShare, useToast,
} from '../../ui/index.js';
import { dayLabel, firstName, formatTime } from '../../lib/format.js';
import { downloadIcs } from '../../lib/ics.js';
import { SKILL_LEVELS, labelOf } from '../../lib/constants.js';
import {
  countdownRelative, gameTitle, isFull, isOver, levelLabel, levelShort, locationShort, mapsUrl, matchDesc, matchLabel,
  notifyGamesChanged, placeLine, playersIn, priceLabel, shareText, spotsLabel, surfaceLabel, totalPlayers, venueName,
} from './gameUtils.js';
import { InviteToGameSheet } from './InviteToGameSheet.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

/** Unpaid visitors may not be able to read the full row — fall back to the public preview. */
async function loadGame(id, paid) {
  const game = await api.games.get(id).catch((err) => { if (paid) throw err; return null; });
  if (game) return { game, preview: false };
  if (paid) return null;
  const p = await api.games.publicPreview(id);
  if (!p) return null;
  const capacity = p.spotsLeft + p.participantCount;
  return {
    preview: true,
    game: {
      ...p,
      creator: { id: null, name: p.creatorName, avatarUrl: null, avatarColor: p.creatorAvatarColor },
      participants: Array.from({ length: p.participantCount }, (_, i) => ({ id: `x${i}`, name: 'Pelaaja', avatarColor: 'blue' })),
      capacity,
      courtSurface: null,
      minSkillLevel: null,
      isMine: false,
      iJoined: false,
      onWaitlist: false,
    },
  };
}

function Hero({ game, now, popJoined }) {
  const dayText = game.scheduledAt ? dayLabel(game.scheduledAt) : 'Aika sovitaan';
  const countdown = countdownRelative(game.scheduledAt, now);
  const filled = playersIn(game);
  const total = totalPlayers(game);
  const loc = locationShort(game.locationType);
  const surface = surfaceLabel(game.courtSurface);
  return (
    <header className="games-hero court-lines on-dark">
      <div className="games-hero-inner">
        <div className="games-hero-badges">
          {game.kind === 'event' && <Chip tone="lime" size="sm" icon="flag">Tapahtuma</Chip>}
          {game.isMine && <Chip tone="on-dark" size="sm" icon="star">Sinä järjestät</Chip>}
          {game.iJoined && <Chip tone="lime" size="sm" icon="check" className={cx(popJoined && 'pop')}>Olet mukana</Chip>}
          {game.onWaitlist && <Chip tone="on-dark" size="sm">Olet jonossa</Chip>}
        </div>
        <div className="eyebrow games-hero-eyebrow">{matchLabel(game.matchType)}{matchDesc(game.matchType) ? ` · ${matchDesc(game.matchType)}` : ''}</div>
        <h1 className="games-hero-day">{dayText}</h1>
        {game.scheduledAt
          ? <div className="games-hero-time t-num">klo {formatTime(game.scheduledAt)}</div>
          : <div className="games-hero-time is-open">Sovitaan chatissa</div>}
        {game.title && <p className="games-hero-title">{game.title}</p>}
        <p className="games-hero-place"><Icon name="pin" size={16} /><span>{placeLine(game)}</span></p>
        <div className="games-hero-chips">
          {loc && <Chip tone="on-dark" size="sm">{loc}</Chip>}
          {surface && <Chip tone="on-dark" size="sm">{surface}</Chip>}
          {game.minSkillLevel && <Chip tone="on-dark" size="sm">Taso {levelShort(game.minSkillLevel)}+</Chip>}
        </div>
        <div className="games-hero-foot">
          {countdown && <span className="games-hero-countdown"><span className="gcard-countdown-dot" aria-hidden="true" />{countdown}</span>}
          <span className="games-hero-slots" aria-label={`${filled}/${total} pelaajaa`}>
            {Array.from({ length: Math.min(total, 12) }, (_, i) => <span key={i} className={cx('games-hero-slot', i < filled && 'is-in')} />)}
            <span className="games-hero-slots-text">{spotsLabel(game)}</span>
          </span>
        </div>
      </div>
    </header>
  );
}

function HeroSkeleton() {
  return (
    <header className="games-hero court-lines on-dark" aria-busy="true">
      <div className="games-hero-inner">
        <span className="games-hero-skel"><span /><span /><span /><span /></span>
      </div>
    </header>
  );
}

function Fact({ icon, label, value }) {
  return (
    <div className="games-fact">
      <span className="games-fact-icon"><Icon name={icon} size={17} /></span>
      <span className="games-fact-label">{label}</span>
      <span className="games-fact-value">{value}</span>
    </div>
  );
}

function PlayerRow({ person, tag, isMe, onOpen, index, fresh }) {
  return (
    <ListRow
      className={cx('games-player', fresh && 'pop')}
      style={{ '--i': index }}
      leading={<Avatar person={person} size={42} />}
      title={isMe ? `${firstName(person.name)} (sinä)` : person.name}
      subtitle={[tag, person.skillLevel ? labelOf(SKILL_LEVELS, person.skillLevel) : null].filter(Boolean).join(' · ') || null}
      onClick={!isMe && onOpen ? onOpen : undefined}
    />
  );
}

export function GameScreen({ params }) {
  const id = params.id;
  const { user, paid } = useSession();
  const { requirePaid, openPaywall } = usePaywall();
  const toast = useToast();
  const confirm = useConfirm();
  const shareLink = useShare();
  const now = useNow(30_000);
  const [busy, run] = useBusy();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [justJoined, setJustJoined] = useState(false);
  const { data, error, loading, reload } = useAsync(() => loadGame(id, paid), [id, paid]);

  const back = '/pelaa/pelit';
  if (loading) {
    return (
      <>
        <TopBar title="Peli" tone="transparent" back={back} className="games-topbar" />
        <HeroSkeleton />
        <Page className="games-detail">
          <div className="games-facts"><Skeleton h={78} r={16} /><Skeleton h={78} r={16} /><Skeleton h={78} r={16} /><Skeleton h={78} r={16} /></div>
          <Skeleton h={180} r={18} className="games-skel-block" />
        </Page>
      </>
    );
  }
  if (error) {
    return (
      <>
        <TopBar title="Peli" back={back} />
        <Page><ErrorState error={error} onRetry={() => reload()} /></Page>
      </>
    );
  }
  if (!data || data.game.status === 'cancelled') {
    const cancelled = data?.game?.status === 'cancelled';
    return (
      <>
        <TopBar title="Peli" back={back} />
        <Page>
          <EmptyState
            art={cancelled ? 'calendar' : 'search'}
            title={cancelled ? 'Tämä peli on peruttu' : 'Peliä ei löytynyt'}
            text={cancelled
              ? `${data.game.isMine ? 'Peruit tämän pelin' : `${firstName(data.game.creator?.name)} perui pelin`}. Etsitäänkö uusi?`
              : 'Peli on ehkä jo pelattu, peruttu tai linkki on vanha.'}
            action={(
              <>
                <Button variant="outline" icon="list" onClick={() => navigate('/pelaa/pelit')}>Selaa avoimia pelejä</Button>
                <Button variant="lime" icon="plus" onClick={() => openCreateGame()}>Luo peli</Button>
              </>
            )}
          />
        </Page>
      </>
    );
  }

  const { game, preview } = data;
  const over = isOver(game, now);
  const full = isFull(game);
  const url = appUrl(`/pelaa/peli/${game.id}`);
  const price = priceLabel(game);
  const isMeId = (pid) => pid && pid === user?.id;
  const changed = () => { notifyGamesChanged(); return reload({ silent: true }); };

  const share = () => shareLink({ title: gameTitle(game), text: shareText(game), url });
  const addToCalendar = () => {
    if (!game.scheduledAt) { toast('Aika sovitaan vielä — lisää kalenteriin, kun aika on lyöty lukkoon.', { tone: 'info', icon: 'calendar' }); return; }
    if (downloadIcs(game, url)) toast('Kalenteritiedosto ladattu 📅', { icon: 'calendar' });
  };
  const openChat = () => {
    if (game.conversationId) navigate(`/pelaa/viestit/${game.conversationId}`);
    else toast('Pelin chat aukeaa, kun joku liittyy mukaan.', { tone: 'info', icon: 'chat' });
  };

  const join = () => requirePaid(() => run(async () => {
    try {
      const conversationId = await api.games.join(game.id);
      const fresh = await changed();
      setJustJoined(true);
      confetti();
      const chatId = conversationId || fresh?.game?.conversationId;
      toast('Olet mukana! 🎾', { icon: 'check-circle', action: chatId ? { label: 'Avaa chat', onClick: () => navigate(`/pelaa/viestit/${chatId}`) } : undefined });
      if (fresh?.game && isFull(fresh.game)) setTimeout(() => toast('Peli on täynnä — nähdään kentällä!', { icon: 'sparkles' }), 1100);
    } catch (err) {
      toast(err);
      reload({ silent: true });
    }
  }), 'Liity peliin');

  const leave = async () => {
    const ok = await confirm({ title: 'Poistutaanko pelistä?', message: 'Paikkasi vapautuu muille. Voit liittyä uudelleen, jos tilaa vielä on.', confirmLabel: 'Poistu pelistä', danger: true });
    if (!ok) return;
    run(async () => {
      try { await api.games.leave(game.id); setJustJoined(false); toast('Poistuit pelistä', { icon: 'check' }); await changed(); } catch (err) { toast(err); }
    });
  };
  const cancel = async () => {
    const ok = await confirm({ title: 'Perutaanko peli?', message: 'Mukana olevat saavat ilmoituksen. Peruttua peliä ei voi palauttaa.', confirmLabel: 'Peru peli', cancelLabel: 'Ei sittenkään', danger: true });
    if (!ok) return;
    run(async () => {
      try { await api.games.cancel(game.id); notifyGamesChanged(); toast('Peli peruttu', { icon: 'check' }); goBack('/pelaa/pelit'); } catch (err) { toast(err); }
    });
  };
  const waitlist = () => requirePaid(() => run(async () => {
    try {
      if (game.onWaitlist) { await api.games.leaveWaitlist(game.id); toast('Poistuit jonosta', { icon: 'check' }); }
      else { await api.games.joinWaitlist(game.id); toast('Olet jonossa — saat ilmoituksen, jos paikka vapautuu.', { icon: 'bell' }); }
      await changed();
    } catch (err) { toast(err); }
  }), 'Liity jonoon');

  let primary;
  if (!paid) primary = <Button variant="lime" size="lg" block icon="lock" onClick={() => openPaywall('Liity peliin')}>Avaa Krossi ja liity</Button>;
  else if (over) primary = <Button variant="soft" size="lg" block disabled>Peli on päättynyt</Button>;
  else if (game.isMine) primary = <Button variant="lime" size="lg" block icon="users" onClick={() => setInviteOpen(true)}>Kutsu pelikavereita</Button>;
  else if (game.iJoined) primary = <Button variant="lime" size="lg" block icon="chat" onClick={openChat}>Avaa chat</Button>;
  // A queued player whose spot opened up joins directly (join() also clears the queue row).
  else if (game.onWaitlist && full) primary = <Button variant="outline" size="lg" block loading={busy} onClick={waitlist}>Poistu jonosta</Button>;
  else if (full) primary = <Button variant="dark" size="lg" block icon="clock" loading={busy} onClick={waitlist}>Liity jonoon</Button>;
  else primary = <Button variant="lime" size="lg" block icon="plus" loading={busy} onClick={join}>{game.onWaitlist ? 'Paikka vapautui — liity!' : 'Liity peliin'}</Button>;

  const emptySlots = Math.max(0, game.spotsLeft || 0);
  const shownSlots = Math.min(emptySlots, 4);
  const showWaitlist = (game.isMine || game.iJoined) && game.waitlistCount > 0;
  const details = (
    <>
      <div className="games-facts stagger">
        <div style={{ '--i': 0 }}><Fact icon="racket" label="Pelimuoto" value={matchLabel(game.matchType)} /></div>
        <div style={{ '--i': 1 }}><Fact icon="users" label="Pelaajia" value={`${playersIn(game)}/${totalPlayers(game)}`} /></div>
        <div style={{ '--i': 2 }}><Fact icon="target" label="Taso" value={game.minSkillLevel ? `${levelLabel(game.minSkillLevel)} tai parempi` : 'Kaikki tasot'} /></div>
        <div style={{ '--i': 3 }}><Fact icon="euro" label={game.kind === 'event' ? 'Maksu' : 'Hinta'} value={price || 'Sovitaan'} /></div>
      </div>

      <Section title="Paikka">
        <Card className="games-venue">
          <span className="games-venue-icon"><Icon name="pin" size={20} /></span>
          <span className="games-venue-text">
            <span className="games-venue-name">{venueName(game) || 'Paikka sovitaan'}</span>
            <span className="games-venue-sub">{[game.city, labelOf([{ value: 'sisätennis', label: 'Sisäkenttä' }, { value: 'ulkotennis', label: 'Ulkokenttä' }, { value: 'missä vain', label: 'Sisällä tai ulkona' }], game.locationType)].filter(Boolean).join(' · ')}</span>
          </span>
          {(venueName(game) || game.lat != null) && (
            <Button as="a" href={mapsUrl(game)} target="_blank" rel="noopener noreferrer" variant="outline" size="sm" iconRight="arrow-up-right">Avaa kartassa</Button>
          )}
        </Card>
      </Section>

      {game.description && (
        <Section title="Lisätietoja">
          <Card className="games-desc">
            <Avatar person={game.creator} size={32} />
            <div>
              <div className="games-desc-who">{game.isMine ? 'Sinä' : firstName(game.creator?.name)} kirjoitti</div>
              <p className="games-desc-text">{game.description}</p>
            </div>
          </Card>
        </Section>
      )}

      <Section title={`Pelaajat · ${playersIn(game)}/${totalPlayers(game)}`}>
        <div className="list-group games-players stagger">
          <PlayerRow index={0} person={game.creator} tag="Järjestäjä" isMe={isMeId(game.creator?.id)} onOpen={() => navigate(`/pelaa/pelaaja/${game.creator.id}`)} />
          {game.participants.map((p, i) => (
            <PlayerRow key={p.id} index={i + 1} person={p} isMe={isMeId(p.id)} fresh={justJoined && isMeId(p.id)} onOpen={() => navigate(`/pelaa/pelaaja/${p.id}`)} />
          ))}
          {Array.from({ length: shownSlots }, (_, i) => (
            <div key={`slot-${i}`} className="list-row games-slot" style={{ '--i': game.participants.length + 1 + i }}>
              <span className="games-slot-circle"><Icon name="plus" size={18} /></span>
              <span className="games-slot-text">Vapaa paikka</span>
              {game.isMine && i === 0 && !over && <Button variant="ghost" size="sm" onClick={() => setInviteOpen(true)}>Kutsu</Button>}
            </div>
          ))}
          {emptySlots > shownSlots && <div className="list-row games-slot-more">+ {emptySlots - shownSlots} vapaata paikkaa</div>}
        </div>
        {showWaitlist && <p className="games-waitlist"><Icon name="clock" size={15} />{game.waitlistCount === 1 ? '1 pelaaja jonossa' : `${game.waitlistCount} pelaajaa jonossa`} — saa paikan, jos joku peruu.</p>}
      </Section>

      {(game.isMine || game.iJoined) && !over && (
        <Section title="Hallinta">
          <div className="list-group">
            {game.conversationId && <ListRow icon="chat" title="Pelin chat" subtitle="Sovi yksityiskohdat porukalla" onClick={openChat} />}
            {game.isMine && <ListRow icon="users" title="Kutsu pelikavereita" subtitle="Kutsu suoraan tai jaa linkki" onClick={() => setInviteOpen(true)} />}
            {game.iJoined && <ListRow icon="logout" title="Poistu pelistä" tone="danger" onClick={leave} chevron={false} />}
            {game.isMine && <ListRow icon="trash" title="Peru peli" subtitle="Mukana olevat saavat ilmoituksen" tone="danger" onClick={cancel} chevron={false} />}
          </div>
        </Section>
      )}
    </>
  );

  return (
    <>
      <TopBar title={gameTitle(game)} tone="transparent" back={back} className="games-topbar" />
      <Hero game={game} now={now} popJoined={justJoined} />
      <Page className="games-detail">
        {paid && !preview ? details : (
          <LockedPreview title="Avaa peli ja liity mukaan" text="Näet pelaajat, tarkan paikan ja hinnan — ja pääset liittymään yhdellä napautuksella.">
            <div className="games-facts">
              <Fact icon="racket" label="Pelimuoto" value={matchLabel(game.matchType)} />
              <Fact icon="users" label="Pelaajia" value={`${playersIn(game)}/${totalPlayers(game)}`} />
              <Fact icon="target" label="Taso" value="Keskitaso tai parempi" />
              <Fact icon="euro" label="Hinta" value="7 € / pelaaja" />
            </div>
            <div className="list-group games-players games-locked-players">
              {['Mikko', 'Laura', 'Joonas'].map((n, i) => (
                <ListRow key={n} leading={<Avatar name={n} color={['blue', 'red', 'yellow'][i]} size={42} />} title={n} subtitle="Keskitaso · Lahti" />
              ))}
            </div>
          </LockedPreview>
        )}
        <div className="games-actionbar">
          <IconButton icon="share" label="Jaa peli" variant="soft" size="lg" onClick={share} />
          <IconButton icon="calendar-plus" label="Lisää kalenteriin" variant="soft" size="lg" onClick={addToCalendar} />
          <div className="games-actionbar-main">{primary}</div>
        </div>
      </Page>
      {game.isMine && paid && (
        <InviteToGameSheet
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          gameId={game.id}
          city={game.city}
          excludeIds={[game.creator?.id, ...game.participants.map((p) => p.id)]}
          shareText={shareText(game)}
        />
      )}
    </>
  );
}
