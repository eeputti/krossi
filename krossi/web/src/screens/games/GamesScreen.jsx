// GamesScreen — /pelaa/pelit. Avoimet (day sections, filters, nearest first) | Omat pelit
// (Tulevat / Menneet) | Kartta (MapLibre). View synced to ?nakyma=omat|kartta.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { openCreateGame } from '../../app/AppShell.jsx';
import { useAsync, useLocalState } from '../../app/hooks.js';
import { usePaywall } from '../../app/paywall.jsx';
import { navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import {
  Button, Chip, EmptyState, ErrorState, Icon, IconButton, Page, PageHeader, Segmented, Skeleton, Spinner, useToast,
} from '../../ui/index.js';
import { CITIES, COURT_SURFACES, MATCH_TYPES, SKILL_LEVELS, labelOf } from '../../lib/constants.js';
import { formatGameTime } from '../../lib/format.js';
import { cityCenter, requestPosition, withDistance } from '../../lib/geo.js';
import { GameCard, GameDateTile } from '../shared/GameCard.jsx';
import { FiltersSheet } from './FiltersSheet.jsx';
import { GamesMap } from './MapView.jsx';
import {
  EMPTY_FILTERS, GAMES_CHANGED, activeFilterCount, applyFilters, gameTitle, groupByDay, inCity, placeLine,
} from './gameUtils.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const VIEWS = ['avoimet', 'omat', 'kartta'];
const PAST_PREVIEW = 6;

function CardSkeletons({ count = 3 }) {
  return (
    <div className="games-skel" aria-busy="true" aria-label="Ladataan pelejä">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="games-skel-card">
          <Skeleton w={56} h={60} r={14} />
          <div className="games-skel-lines">
            <Skeleton w={`${62 - i * 9}%`} h={16} />
            <Skeleton w="78%" h={12} />
            <div className="games-skel-chips"><Skeleton w={58} h={22} r={999} /><Skeleton w={46} h={22} r={999} /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function outcomeChip(game) {
  if (game.status === 'cancelled') return <Chip tone="danger" size="sm">Peruttu</Chip>;
  if (game.outcome === 'played') return <Chip tone="success" size="sm" icon="check">Pelattu</Chip>;
  if (game.outcome === 'not_played') return <Chip tone="neutral" size="sm">Ei pelattu</Chip>;
  return <Chip tone="warn" size="sm">Pelasitteko?</Chip>;
}

function PastRow({ game, onClick, index }) {
  return (
    <button type="button" className="games-past-row" onClick={onClick} style={{ '--i': index }}>
      <GameDateTile iso={game.scheduledAt} size="sm" />
      <span className="games-past-text">
        <span className="games-past-title truncate">{gameTitle(game)}</span>
        <span className="games-past-meta truncate">{formatGameTime(game.scheduledAt)} · {placeLine(game)}</span>
      </span>
      {outcomeChip(game)}
    </button>
  );
}

function filterChips(filters, homeCity) {
  const chips = [];
  filters.matchTypes?.forEach((v) => chips.push({ key: `m-${v}`, label: labelOf(MATCH_TYPES, v), remove: (f) => ({ ...f, matchTypes: f.matchTypes.filter((x) => x !== v) }) }));
  filters.locationTypes?.forEach((v) => chips.push({ key: `l-${v}`, label: v === 'sisätennis' ? 'Sisällä' : 'Ulkona', remove: (f) => ({ ...f, locationTypes: f.locationTypes.filter((x) => x !== v) }) }));
  filters.surfaces?.forEach((v) => chips.push({ key: `s-${v}`, label: labelOf(COURT_SURFACES, v), remove: (f) => ({ ...f, surfaces: f.surfaces.filter((x) => x !== v) }) }));
  if (filters.level) chips.push({ key: 'lvl', label: `Sopii: ${labelOf(SKILL_LEVELS, filters.level).toLowerCase()}`, remove: (f) => ({ ...f, level: '' }) });
  return chips;
}

export function GamesScreen({ query }) {
  const view = VIEWS.includes(query.nakyma) ? query.nakyma : 'avoimet';
  const setView = (v) => navigate(v === 'avoimet' ? '/pelaa/pelit' : `/pelaa/pelit?nakyma=${v}`, { replace: true });
  const { profile } = useSession();
  const { paid, requirePaid, openPaywall } = usePaywall();
  const toast = useToast();

  const homeCity = profile?.city || profile?.areas?.[0] || 'Lahti';
  const [storedFilters, setFilters] = useLocalState('krossi_games_filters', EMPTY_FILTERS);
  const filters = { ...EMPTY_FILTERS, ...(storedFilters || {}) };
  const city = filters.city && CITIES.includes(filters.city) ? filters.city : homeCity;
  const activeCount = activeFilterCount(filters, homeCity);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [nearest, setNearest] = useState(false);
  const [origin, setOrigin] = useState(null); // { pos, mine }
  const [locating, setLocating] = useState(false);
  const originPos = origin ? (origin.mine ? origin.pos : cityCenter(city)) : null;

  const open = useAsync(() => api.games.listOpen(), []);
  const [mineWanted, setMineWanted] = useState(view === 'omat');
  useEffect(() => { if (view === 'omat') setMineWanted(true); }, [view]);
  const mine = useAsync(() => (mineWanted ? api.games.listMine() : Promise.resolve(null)), [mineWanted]);

  useEffect(() => {
    const refresh = () => { open.reload({ silent: true }); if (mineWanted) mine.reload({ silent: true }); };
    window.addEventListener(GAMES_CHANGED, refresh);
    return () => window.removeEventListener(GAMES_CHANGED, refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineWanted]);

  const inMyCity = useMemo(() => (open.data || []).filter((g) => !g.city || g.city === city), [open.data, city]);
  const visible = useMemo(() => {
    let list = applyFilters(inMyCity, filters);
    if (originPos) list = withDistance(list, originPos);
    if (nearest) list = [...list].sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inMyCity, storedFilters, nearest, originPos?.[0], originPos?.[1]]);
  const countFor = (f) => applyFilters((open.data || []).filter((g) => !g.city || g.city === (f.city || homeCity)), f).length;

  const openGame = (game) => requirePaid(() => navigate(`/pelaa/peli/${game.id}`), 'Avaa peli ja liity mukaan');

  const toggleNearest = async () => {
    if (nearest) { setNearest(false); return; }
    setLocating(true);
    const pos = await requestPosition();
    setLocating(false);
    setOrigin(pos ? { pos, mine: true } : { pos: null, mine: false });
    if (!pos) toast('Sijaintia ei saatu — etäisyydet lasketaan keskustasta.', { tone: 'info', icon: 'compass' });
    setNearest(true);
  };

  const clearFilters = () => setFilters({ ...EMPTY_FILTERS });
  const chips = filterChips(filters, homeCity);

  const toolbar = (
    <div className="games-toolbar" role="toolbar" aria-label="Pelien suodattimet">
      <button type="button" className={cx('games-tool', city !== homeCity && 'is-on')} onClick={() => setFiltersOpen(true)}>
        <Icon name="pin" size={15} />{city}<Icon name="chevron-down" size={15} />
      </button>
      <button type="button" className={cx('games-tool', nearest && 'is-on')} aria-pressed={nearest} onClick={toggleNearest} disabled={locating}>
        {locating ? <Spinner size={14} /> : <Icon name="compass" size={15} />}Lähin ensin
      </button>
      {chips.map((c) => (
        <button key={c.key} type="button" className="games-tool is-filter" onClick={() => setFilters(c.remove(filters))} aria-label={`Poista suodatin ${c.label}`}>
          {c.label}<Icon name="close" size={14} />
        </button>
      ))}
    </div>
  );

  let body;
  if (view === 'avoimet') {
    if (open.loading) body = <CardSkeletons count={4} />;
    else if (open.error) body = <ErrorState error={open.error} onRetry={() => open.reload()} />;
    else if (inMyCity.length === 0) {
      body = (
        <EmptyState
          art="court"
          title={`Ei vielä avoimia pelejä ${inCity(city)}`}
          text="Luo eka peli ja jaa linkki kavereille — pelikaveri löytyy nopeammin kuin luulet."
          action={<Button variant="lime" icon="plus" onClick={() => openCreateGame()}>Luo peli</Button>}
        />
      );
    } else if (visible.length === 0) {
      body = (
        <EmptyState
          art="search"
          title="Ei osumia näillä suodattimilla"
          text="Kokeile väljempiä suodattimia — tai luo juuri sellainen peli kuin haluat."
          action={<><Button variant="outline" icon="refresh" onClick={clearFilters}>Tyhjennä suodattimet</Button><Button variant="lime" icon="plus" onClick={() => openCreateGame()}>Luo peli</Button></>}
        />
      );
    } else {
      const sections = nearest ? [{ key: 'near', label: origin?.mine ? 'Lähimmät ensin' : 'Lähimmät keskustasta', games: visible }] : groupByDay(visible);
      let i = 0;
      body = (
        <>
          <p className="games-count">
            <strong>{visible.length}</strong> {visible.length === 1 ? 'avoin peli' : 'avointa peliä'} {inCity(city)}
          </p>
          {sections.map((sec) => (
            <section key={sec.key} className="games-day">
              <h2 className={cx('games-day-title', sec.key === 'd0' && 'is-today')}>
                {sec.label}<span className="games-day-count">{sec.games.length}</span>
              </h2>
              <div className="games-list stagger">
                {sec.games.map((g) => (
                  <div key={g.id} style={{ '--i': i++ }}>
                    <GameCard game={g} onClick={() => openGame(g)} showDistance={!!originPos} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      );
    }
  } else if (view === 'omat') {
    body = <MyGames state={mine} onOpen={(g) => navigate(`/pelaa/peli/${g.id}`)} onBrowse={() => setView('avoimet')} />;
  } else {
    body = open.loading ? <div className="games-map-skel"><Skeleton w="100%" h="100%" r={24} /></div>
      : open.error ? <ErrorState error={open.error} onRetry={() => open.reload()} />
        : (
          <GamesMap
            games={visible}
            center={originPos || cityCenter(city)}
            userPos={origin?.mine ? origin.pos : null}
            onOpen={openGame}
            onShowList={() => setView('avoimet')}
          />
        );
  }

  const upcomingCount = mine.data?.upcoming?.length || 0;
  return (
    <Page className={cx('games-page', `games-view-${view}`)}>
      <PageHeader
        title="Pelit"
        actions={(
          <>
            <IconButton icon="sliders" label="Suodattimet" variant="soft" badge={activeCount} onClick={() => setFiltersOpen(true)} />
            <Button variant="soft" size="sm" icon="trophy" onClick={() => navigate('/pelaa/liigat')}>Liigat</Button>
          </>
        )}
      />
      <Segmented
        className="games-segmented"
        ariaLabel="Näkymä"
        value={view}
        onChange={setView}
        options={[
          { value: 'avoimet', label: 'Avoimet', icon: 'list' },
          { value: 'omat', label: 'Omat pelit', icon: 'calendar', badge: upcomingCount || null },
          { value: 'kartta', label: 'Kartta', icon: 'map' },
        ]}
      />
      {view !== 'omat' && toolbar}
      {!paid && view === 'avoimet' && (
        <button type="button" className="games-unlock" onClick={() => openPaywall('Liity peleihin ja luo omia')}>
          <span className="games-unlock-icon"><Icon name="lock" size={17} /></span>
          <span className="games-unlock-text"><strong>Avaa Krossi</strong> ja pääse mukaan peleihin</span>
          <Icon name="chevron-right" size={18} />
        </button>
      )}
      <div className="games-body" key={view}>{body}</div>
      {view !== 'kartta' && (
        <button type="button" className="games-fab hide-desktop" aria-label="Luo peli" onClick={() => openCreateGame()}>
          <Icon name="plus" size={28} strokeWidth={2.6} />
        </button>
      )}
      <FiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        value={filters}
        homeCity={homeCity}
        countFor={countFor}
        onApply={(f) => { setFilters(f); setFiltersOpen(false); }}
      />
    </Page>
  );
}

function MyGames({ state, onOpen, onBrowse }) {
  const [showAll, setShowAll] = useState(false);
  if (state.loading || state.data === null) return <CardSkeletons count={3} />;
  if (state.error) return <ErrorState error={state.error} onRetry={() => state.reload()} />;
  const { upcoming = [], past = [] } = state.data || {};
  const pastShown = showAll ? past : past.slice(0, PAST_PREVIEW);
  return (
    <>
      <section className="games-day">
        <h2 className="games-day-title">Tulevat<span className="games-day-count">{upcoming.length}</span></h2>
        {upcoming.length === 0 ? (
          <EmptyState
            compact
            art="calendar"
            title="Ei tulevia pelejä"
            text="Liity avoimeen peliin tai luo oma — se vie alle minuutin."
            action={<><Button variant="outline" icon="list" onClick={onBrowse}>Selaa avoimia</Button><Button variant="lime" icon="plus" onClick={() => openCreateGame()}>Luo peli</Button></>}
          />
        ) : (
          <div className="games-list stagger">
            {upcoming.map((g, i) => <div key={g.id} style={{ '--i': i }}><GameCard game={g} onClick={() => onOpen(g)} /></div>)}
          </div>
        )}
      </section>
      {past.length > 0 && (
        <section className="games-day">
          <h2 className="games-day-title">Menneet<span className="games-day-count">{past.length}</span></h2>
          <div className="games-past stagger">
            {pastShown.map((g, i) => <PastRow key={g.id} game={g} index={i} onClick={() => onOpen(g)} />)}
          </div>
          {past.length > PAST_PREVIEW && (
            <Button variant="ghost" size="sm" className="games-past-more" iconRight={showAll ? 'chevron-up' : 'chevron-down'} onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Näytä vähemmän' : `Näytä kaikki ${past.length}`}
            </Button>
          )}
        </section>
      )}
    </>
  );
}
