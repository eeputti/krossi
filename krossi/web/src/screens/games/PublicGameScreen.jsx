// PublicGameScreen — what a logged-out visitor of a shared game link sees (no app chrome).
// Data: api.games.publicPreview(id). CTA goes to /pelaa; the Gate remembers this game
// (sessionStorage 'krossi_after_auth') and opens it after sign-in.
import { api } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { navigate } from '../../app/router.js';
import { Avatar, Button, Chip, ErrorState, Icon, Illustration, Skeleton, TennisBall } from '../../ui/index.js';
import { dateTile, dayDiff, formatGameTime } from '../../lib/format.js';
import { gameTitle, isFull, locationShort, matchDesc, matchLabel, placeLine, spotsLabel } from './gameUtils.js';

const cx = (...c) => c.filter(Boolean).join(' ');

const PERKS = [
  { icon: 'users', text: 'Löydä pelikaveri omalta tasoltasi' },
  { icon: 'bolt', text: 'Peli sovittu muutamalla napautuksella' },
  { icon: 'chat', text: 'Sovi loput suoraan pelin chatissa' },
];

function headline(p) {
  if (p.kind === 'event') return `${p.creatorName} järjestää tapahtuman`;
  return `${p.creatorName} hakee ${p.matchType === 'nelinpeli' ? 'pelikavereita' : 'pelikaveria'}`;
}

function Summary({ p }) {
  const tile = dateTile(p.scheduledAt);
  const today = p.scheduledAt && dayDiff(p.scheduledAt) === 0;
  const total = p.spotsLeft + p.participantCount + 1;
  const loc = locationShort(p.locationType);
  return (
    <div className="games-public-card rise">
      <div className="games-public-when">
        <span className={cx('gcard-tile', 'gcard-tile-lg', today && 'is-today', !tile && 'is-open')} aria-hidden="true">
          {tile ? (<><span className="gcard-tile-wd">{today ? 'Tänään' : tile.weekday}</span><span className="gcard-tile-day t-num">{tile.day}</span></>)
            : <Icon name="clock" size={22} />}
        </span>
        <span className="games-public-when-text">
          <span className="games-public-type">{gameTitle(p)}{p.title ? '' : matchDesc(p.matchType) ? ` · ${matchDesc(p.matchType)}` : ''}</span>
          <span className="games-public-time">{formatGameTime(p.scheduledAt)}</span>
        </span>
      </div>
      <div className="games-public-rows">
        <p className="games-public-row"><Icon name="pin" size={16} /><span>{placeLine(p)}</span></p>
        {p.title && <p className="games-public-row"><Icon name="racket" size={16} /><span>{matchLabel(p.matchType)}</span></p>}
      </div>
      <div className="games-public-spots">
        <span className="games-hero-slots" aria-hidden="true">
          {Array.from({ length: Math.min(total, 10) }, (_, i) => <span key={i} className={cx('games-hero-slot', i < total - p.spotsLeft && 'is-in')} />)}
        </span>
        {isFull(p) ? <Chip tone="on-dark" size="sm">Täynnä</Chip> : <Chip tone="lime" size="sm">{spotsLabel(p)}</Chip>}
        {loc && <Chip tone="on-dark" size="sm">{loc}</Chip>}
      </div>
    </div>
  );
}

export function PublicGameScreen({ params }) {
  const { data, error, loading, reload } = useAsync(() => api.games.publicPreview(params.id), [params.id]);
  const alive = data && data.status !== 'cancelled';

  let content;
  if (loading) {
    content = (
      <div className="games-public-skel" aria-busy="true" aria-label="Ladataan peliä">
        <Skeleton w={64} h={64} r={999} className="games-public-skel-dark" />
        <Skeleton w="70%" h={30} className="games-public-skel-dark" />
        <Skeleton w="100%" h={190} r={24} className="games-public-skel-dark" />
      </div>
    );
  } else if (error) {
    content = <div className="games-public-error"><ErrorState error={error} onRetry={() => reload()} /></div>;
  } else if (!alive) {
    content = (
      <div className="games-public-missing rise">
        <Illustration name="search" size={170} />
        <h1 className="games-public-title">Tätä peliä ei enää löydy</h1>
        <p className="games-public-lead">Peli on ehkä jo pelattu tai peruttu. Krossissa sovit uuden pelin hetkessä.</p>
        <div className="games-public-ctas">
          <Button as="a" href="https://krossi.app" variant="lime" size="lg" block iconRight="arrow-right">Tutustu Krossiin</Button>
          <Button as="a" href="/demo" variant="on-dark" size="lg" block>Kokeile demoa</Button>
        </div>
      </div>
    );
  } else {
    const full = isFull(data);
    content = (
      <>
        <div className="games-public-intro rise">
          <span className="games-public-avatar">
            <Avatar name={data.creatorName} color={data.creatorAvatarColor} size={64} ring />
            <span className="games-public-avatar-ball"><TennisBall size={24} /></span>
          </span>
          <div className="eyebrow">{data.kind === 'event' ? 'Kutsu tapahtumaan' : 'Kutsu peliin'}</div>
          <h1 className="games-public-title">{headline(data)}</h1>
          <p className="games-public-lead">{full ? 'Tämä peli ehti jo täyttyä — mutta Krossissa on muitakin pelejä lähelläsi.' : 'Liity Krossiin, niin pääset mukaan peliin yhdellä napautuksella.'}</p>
        </div>
        <Summary p={data} />
        <div className="games-public-ctas">
          <Button variant="lime" size="lg" block icon="bolt" onClick={() => navigate('/pelaa')}>{full ? 'Liity Krossiin' : 'Liity Krossiin ja peliin'}</Button>
          <Button as="a" href="/demo" variant="on-dark" size="lg" block>Kokeile demoa</Button>
        </div>
        <ul className="games-public-perks">
          {PERKS.map((p) => (
            <li key={p.text}><span className="games-public-perk-icon"><Icon name={p.icon} size={16} /></span>{p.text}</li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <div className="games-public court-lines on-dark">
      <header className="games-public-top">
        <a href="https://krossi.app" className="games-public-logo" aria-label="Krossi — etusivu">Krossi</a>
        <a href="/demo" className="games-public-toplink">Kokeile demoa</a>
      </header>
      <main className="games-public-main">{content}</main>
      <footer className="games-public-foot">Krossi · tennispelit sovittu hetkessä · krossi.app</footer>
    </div>
  );
}
