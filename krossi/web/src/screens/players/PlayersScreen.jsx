// PlayersScreen — /pelaa/pelaajat: players in my city, grouped by who plays now / this week,
// with name search, a level scroller and more filters in a sheet. Unpaid users see a teaser.
// In the demo the list is ordered by how well each player fits me (features/matching.js), with
// the reasons on the card: who plays now first, then the best fits.
import { useState } from 'react';
import { api, isDemo } from '../../api/index.js';
import { openCreateGame } from '../../app/AppShell.jsx';
import { useAsync, useLocalState, useNow } from '../../app/hooks.js';
import { LockedPreview, usePaywall } from '../../app/paywall.jsx';
import { navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { rankPlayers, reasonLine } from '../../features/matching.js';
import { AVAILABILITY_SLOTS, CITIES, GENDERS, PLAY_STYLES, SKILL_LEVELS } from '../../lib/constants.js';
import { plural } from '../../lib/format.js';
import {
  AvatarStack, Button, Card, ChipSelect, EmptyState, ErrorState, Field, Icon, IconButton, Input, Page, PageHeader,
  Select, Sheet, Skeleton, SkeletonList, Toggle,
} from '../../ui/index.js';
import { InviteSheet } from '../shared/InviteSheet.jsx';
import { PlayerCard } from '../shared/PlayerCard.jsx';
import { cityIn, isPlayingNow, lockedPreviewPlayers, normalize } from './playerInfo.js';

const DEFAULT_FILTERS = { level: '', styles: [], gender: '', slots: [], thisWeek: false, city: '' };
const LEVEL_OPTIONS = [{ value: '', label: 'Kaikki' }, ...SKILL_LEVELS.map((s) => ({ value: s.value, label: s.label }))];
const GENDER_OPTIONS = [{ value: '', label: 'Kaikki' }, ...GENDERS];
const SLOT_OPTIONS = AVAILABILITY_SLOTS.map((s) => ({
  value: s.value,
  label: s.time ? <>{s.label} <span className="players-slot-hint t-num">{s.time}</span></> : s.label,
}));

function matches(p, f, q, now) {
  if (q && !normalize(p.name).includes(q)) return false;
  if (f.level && p.skillLevel !== f.level) return false;
  const styles = p.playStyles || [];
  if (f.styles.length && !styles.includes('kaikki käy') && !f.styles.some((s) => styles.includes(s))) return false;
  if (f.gender && p.gender !== f.gender) return false;
  const slots = p.availability || [];
  if (f.slots.length && !slots.includes('joustavasti') && !f.slots.some((s) => slots.includes(s))) return false;
  if (f.thisWeek && !(p.playingThisWeek || isPlayingNow(p, now))) return false;
  return true;
}

export function PlayersScreen() {
  const { profile } = useSession();
  const { paid, requirePaid } = usePaywall();
  const now = useNow(60_000);
  const [stored, setStored] = useLocalState('krossi.players.filters.v1', DEFAULT_FILTERS);
  const filters = { ...DEFAULT_FILTERS, ...(stored || {}) };
  const setFilters = (patch) => setStored({ ...filters, ...patch });
  const [query, setQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const homeCity = profile?.city || profile?.areas?.[0] || CITIES[0];
  const city = filters.city || homeCity;
  const cityOptions = (CITIES.includes(city) ? CITIES : [city, ...CITIES]).map((c) => ({ value: c, label: c }));

  const list = useAsync(() => (paid ? api.players.list({ city }) : Promise.resolve([])), [city, paid]);
  const partners = useAsync(() => api.players.listPartners(), []);

  const q = normalize(query);
  const all = list.data || [];
  const filtered = all.filter((p) => matches(p, filters, q, now));
  // Best fits first — demo only until it is approved for real players. (isDemo is set when the
  // backend is installed, after this module loads, so it is read here and not at the top.)
  const byFit = isDemo;
  const ranked = byFit
    ? rankPlayers(profile, filtered, { now, partners: partners.data })
    : filtered.map((player) => ({ player, reasons: [] }));
  const sheetCount = (filters.styles.length ? 1 : 0) + (filters.gender ? 1 : 0) + (filters.slots.length ? 1 : 0)
    + (filters.thisWeek ? 1 : 0) + (city !== homeCity ? 1 : 0);
  const anyFilter = sheetCount > 0 || !!filters.level || !!q;
  const clearFilters = () => { setStored({ ...DEFAULT_FILTERS }); setQuery(''); };

  const createOpenGame = () => requirePaid(() => openCreateGame(), 'Luo avoin peli');

  const header = (
    <PageHeader
      title="Pelaajat"
      subtitle={(
        <button type="button" className="players-city" onClick={() => setSheetOpen(true)} aria-label={`Kaupunki: ${city}. Vaihda`}>
          <Icon name="pin" size={15} />
          <span>{city}</span>
          {paid && !list.loading && !list.error && all.length > 0 && <span className="players-city-count">· {plural(all.length, 'pelaaja', 'pelaajaa')}</span>}
          <Icon name="chevron-down" size={15} />
        </button>
      )}
      actions={paid ? <IconButton icon="sliders" label="Suodattimet" variant="soft" badge={sheetCount || undefined} onClick={() => setSheetOpen(true)} /> : null}
    />
  );

  if (!paid) {
    return (
      <Page>
        {header}
        <LockedPreview
          title="Pelaajat ovat lukittuna"
          text={`Avaa Krossi, niin näet ketkä pelaavat ${cityIn(city, { midSentence: true })} — tasot, pelityylit ja milloin he ehtivät.`}
        >
          <div className="players-list">
            {lockedPreviewPlayers(now).map((p) => <PlayerCard key={p.id} player={p} />)}
          </div>
        </LockedPreview>
        <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} />
      </Page>
    );
  }

  let body;
  if (list.loading) {
    body = <SkeletonList count={6} />;
  } else if (list.error) {
    body = <ErrorState error={list.error} onRetry={() => list.reload()} />;
  } else if (all.length === 0) {
    body = (
      <EmptyState
        art="players"
        title={`${cityIn(city)} ei vielä muita pelaajia`}
        text="Kutsu kaveri mukaan tai luo avoin peli — kun uusia pelaajia liittyy, he näkevät sen heti."
        action={(
          <>
            <Button variant="lime" icon="gift" onClick={() => setInviteOpen(true)}>Kutsu kaveri</Button>
            <Button variant="outline" icon="plus" onClick={createOpenGame}>Luo avoin peli</Button>
          </>
        )}
      />
    );
  } else if (filtered.length === 0) {
    body = (
      <EmptyState
        art="search"
        compact
        title={q ? `Ei osumia haulle “${query.trim()}”` : 'Kukaan ei osu suodattimiin'}
        text="Kokeile väljempiä suodattimia tai toista tasoa."
        action={<Button variant="outline" icon="refresh" onClick={clearFilters}>Tyhjennä suodattimet</Button>}
      />
    );
  } else {
    body = <PlayerGroups ranked={ranked} grouped={!q} byFit={byFit} now={now} />;
  }

  return (
    <Page className="players-page">
      {header}

      <div className="players-controls">
        <Input
          icon="search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Hae nimellä"
          aria-label="Hae pelaajaa nimellä"
          enterKeyHint="search"
          className="players-search"
        />
        <ChipSelect
          options={LEVEL_OPTIONS}
          value={filters.level}
          onChange={(level) => setFilters({ level })}
          layout="scroll"
          size="sm"
          ariaLabel="Taso"
          className="players-levels"
        />
      </div>

      <PartnersEntry state={partners} />

      {body}

      {anyFilter && !list.loading && filtered.length > 0 && (
        <div className="players-clear">
          <button type="button" className="players-clear-btn" onClick={clearFilters}>
            <Icon name="refresh" size={15} />Tyhjennä suodattimet
          </button>
        </div>
      )}

      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={filters}
        setFilters={setFilters}
        city={city}
        homeCity={homeCity}
        cityOptions={cityOptions}
        count={list.loading ? null : filtered.length}
        onClear={() => setStored({ ...DEFAULT_FILTERS, level: filters.level })}
      />
      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </Page>
  );
}

function PlayerGroups({ ranked, grouped, byFit, now }) {
  const open = (p) => navigate(`/pelaa/pelaaja/${p.id}`);
  // Why this player fits me, in place of the availability line; a Pelaan nyt note still wins.
  const card = ({ player: p, reasons }, i) => {
    const why = isPlayingNow(p, now) && p.playingNowNote ? '' : reasonLine(reasons);
    return <PlayerCard key={p.id} player={p} onClick={() => open(p)} subtitle={why || undefined} style={{ '--i': i }} />;
  };
  if (!grouped) {
    return (
      <section className="players-group">
        <h2 className="players-group-title">{plural(ranked.length, 'osuma', 'osumaa')}</h2>
        <div className="players-list stagger">{ranked.map(card)}</div>
      </section>
    );
  }
  const live = (r) => isPlayingNow(r.player, now);
  const nowList = ranked.filter(live);
  const groups = byFit
    ? [
      { key: 'now', title: 'Pelaa nyt', live: true, items: nowList },
      { key: 'fit', title: 'Sopivimmat sinulle', items: ranked.filter((r) => !live(r)) },
    ]
    : [
      { key: 'now', title: 'Pelaa nyt', live: true, items: nowList },
      { key: 'week', title: 'Pelaa tällä viikolla', items: ranked.filter((r) => !live(r) && r.player.playingThisWeek) },
      { key: 'rest', title: 'Muut pelaajat', items: ranked.filter((r) => !live(r) && !r.player.playingThisWeek) },
    ];
  const shown = groups.filter((g) => g.items.length);
  if (!byFit && shown.length === 1 && shown[0].key === 'rest') shown[0].title = 'Kaikki pelaajat';
  let i = 0;
  return shown.map((g) => (
    <section key={g.key} className={`players-group players-group-${g.key}`}>
      <h2 className="players-group-title">
        {g.live && <span className="players-live" aria-hidden="true"><Icon name="bolt" size={13} strokeWidth={2.6} /></span>}
        {g.title}
        <span className="players-group-count t-num">{g.items.length}</span>
      </h2>
      <div className="players-list stagger">{g.items.map((r) => card(r, i++))}</div>
    </section>
  ));
}

function PartnersEntry({ state }) {
  const partners = state.data || [];
  const n = partners.length;
  const games = partners.reduce((sum, p) => sum + (p.gamesTogether || 0), 0);
  let sub;
  if (state.loading) sub = <Skeleton w={150} h={12} />;
  else if (n) sub = `${plural(n, 'pelikaveri', 'pelikaveria')} · ${plural(games, 'yhteinen peli', 'yhteistä peliä')}`;
  else sub = 'Kenen kanssa olet pelannut — pelaa uudestaan';
  return (
    <Card interactive padding="none" className="players-entry" onClick={() => navigate('/pelaa/pelikaverit')}>
      <span className="players-entry-art">
        {n ? <AvatarStack people={partners.map((p) => p.player)} max={3} size={34} /> : <span className="players-entry-icon"><Icon name="repeat" size={20} /></span>}
      </span>
      <span className="players-entry-text">
        <span className="players-entry-title">Pelikaverit</span>
        <span className="players-entry-sub">{sub}</span>
      </span>
      <Icon name="chevron-right" size={20} className="players-entry-chevron" />
    </Card>
  );
}

function FilterSheet({ open, onClose, filters, setFilters, city, homeCity, cityOptions, count, onClear }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="md"
      title="Suodata pelaajia"
      subtitle="Löydä juuri sinulle sopiva pelikaveri."
      footer={(
        <div className="sheet-actions">
          <Button variant="soft" size="lg" onClick={onClear}>Tyhjennä</Button>
          <Button variant="dark" size="lg" onClick={onClose}>
            {count == null ? 'Näytä pelaajat' : count === 0 ? 'Ei osumia' : `Näytä ${plural(count, 'pelaaja', 'pelaajaa')}`}
          </Button>
        </div>
      )}
    >
      <div className="players-filters">
        <Field label="Kaupunki" htmlFor="players-city-select" hint={city !== homeCity ? `Kotikaupunkisi on ${homeCity}.` : undefined}>
          <Select id="players-city-select" options={cityOptions} value={city} onChange={(e) => setFilters({ city: e.target.value === homeCity ? '' : e.target.value })} />
        </Field>
        <Field label="Pelityyli">
          <ChipSelect options={PLAY_STYLES} value={filters.styles} onChange={(styles) => setFilters({ styles })} multiple size="sm" ariaLabel="Pelityyli" />
        </Field>
        <Field label="Milloin ehtii">
          <ChipSelect options={SLOT_OPTIONS} value={filters.slots} onChange={(slots) => setFilters({ slots })} multiple size="sm" ariaLabel="Milloin ehtii" />
        </Field>
        <Field label="Sukupuoli">
          <ChipSelect options={GENDER_OPTIONS} value={filters.gender} onChange={(gender) => setFilters({ gender })} size="sm" ariaLabel="Sukupuoli" />
        </Field>
        <div className="players-filter-toggle">
          <Toggle
            icon="calendar"
            label="Vain tällä viikolla pelaavat"
            hint="Näytä ne, jotka ovat kertoneet ehtivänsä pelaamaan."
            checked={filters.thisWeek}
            onChange={(thisWeek) => setFilters({ thisWeek })}
          />
        </div>
      </div>
    </Sheet>
  );
}
