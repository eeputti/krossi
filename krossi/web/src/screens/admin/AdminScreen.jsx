// AdminScreen — Ylläpito (/pelaa/yllapito, admins only; the shell redirects everyone else).
// Overview of krossi_admin_stats + a searchable, sortable user list with event rights and deletion.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync, useBusy } from '../../app/hooks.js';
import { useSession } from '../../app/session.jsx';
import {
  Button, Card, Chip, ChipSelect, CountUp, EmptyState, ErrorState, IconButton, Input, Page, ProgressBar,
  Section, Segmented, Skeleton, SkeletonList, StatTile, TopBar, useConfirm, useToast,
} from '../../ui/index.js';
import { AdminUserCard } from './AdminUserCard.jsx';
import { FILTERS, SORTS, STAT_GROUPS, countActive, fmtNum, selectUsers, statValues } from './adminData.js';

const PAGE_SIZE = 40;

export function AdminScreen() {
  const { user: me } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const stats = useAsync(() => api.admin.stats(), []);
  const users = useAsync(() => api.admin.users(), []);
  const [refreshing, runRefresh] = useBusy();

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('joined');
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [openId, setOpenId] = useState(null);

  useEffect(() => { setLimit(PAGE_SIZE); }, [query, sort, filter]);

  const list = useMemo(() => selectUsers(users.data, { query, filter, sort }), [users.data, query, filter, sort]);
  const active30d = users.data ? countActive(users.data) : null;
  const narrowed = Boolean(query.trim() || filter);

  const refresh = () => runRefresh(async () => {
    // reload() never rejects: it resolves to undefined when the fetch failed.
    const [s, u] = await Promise.all([stats.reload({ silent: true }), users.reload({ silent: true })]);
    if (s === undefined || u === undefined) toast('Päivitys ei onnistunut. Yritä hetken päästä uudelleen.', { tone: 'error' });
    else toast('Tiedot päivitetty', { icon: 'refresh' });
  });

  const saveCities = async (u, cities) => {
    try {
      await api.admin.setCityAdmin(u.id, cities);
      users.setData((prev) => (prev || []).map((x) => (x.id === u.id ? { ...x, adminCities: cities } : x)));
      toast(cities.length ? `Tapahtuma-oikeudet: ${cities.join(', ')}` : 'Tapahtuma-oikeudet poistettu');
      return true;
    } catch (err) {
      toast(err);
      return false;
    }
  };

  const deleteUser = async (u) => {
    const who = u.name || 'Nimetön pelaaja';
    const ok = await confirm({
      title: 'Poistetaanko tili?',
      message: `${who}${u.email ? ` (${u.email})` : ''} poistetaan pysyvästi: profiili, pelit, viestit ja tulokset. Tätä ei voi perua.`,
      confirmLabel: 'Poista tili',
      danger: true,
    });
    if (!ok) return false;
    try {
      await api.admin.deleteUser(u.id);
      users.setData((prev) => (prev || []).filter((x) => x.id !== u.id));
      stats.setData((prev) => {
        if (!prev) return prev;
        const dec = (n, when = true) => (typeof n === 'number' && when ? Math.max(0, n - 1) : n);
        return {
          ...prev,
          total_players: dec(prev.total_players),
          paid_players: dec(prev.paid_players, Boolean(u.paidAt)),
          hidden_players: dec(prev.hidden_players, u.hiddenFromFeed),
        };
      });
      setOpenId(null);
      toast(`${who} poistettu`, { icon: 'trash' });
      return true;
    } catch (err) {
      toast(err);
      return false;
    }
  };

  const clearSearch = () => { setQuery(''); setFilter(''); };

  return (
    <>
      <TopBar
        title="Ylläpito"
        back="/pelaa/profiili"
        className="admin-topbar"
        actions={<IconButton icon="refresh" label="Päivitä tiedot" onClick={refresh} disabled={refreshing} className={refreshing ? 'admin-refresh is-spinning' : 'admin-refresh'} />}
      />
      <Page width="wide" className="admin">
        <div className="admin-layout">
          <div className="admin-overview">
            <Overview stats={stats} users={users.data} active30d={active30d} />
          </div>

          <Section
            className="admin-users"
            title={(
              <span className="admin-users-title">
                Käyttäjät
                {users.data && <Chip size="sm" tone="neutral" className="t-num">{fmtNum(users.data.length)}</Chip>}
              </span>
            )}
          >
            {(users.loading || users.data?.length > 0) && (
              <div className="admin-toolbar">
                <Input
                  icon="search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Hae nimi, sähköposti tai kaupunki"
                  aria-label="Hae käyttäjiä"
                  autoComplete="off"
                  enterKeyHint="search"
                />
                <div className="admin-toolbar-row">
                  <span className="admin-toolbar-label" aria-hidden="true">Järjestys</span>
                  <Segmented size="sm" options={SORTS} value={sort} onChange={setSort} ariaLabel="Järjestys" className="admin-sort" />
                </div>
                <ChipSelect options={FILTERS} value={filter} onChange={setFilter} allowEmpty size="sm" layout="scroll" ariaLabel="Suodata käyttäjiä" className="admin-filters" />
              </div>
            )}

            {users.loading ? (
              <SkeletonList count={6} />
            ) : users.error && !users.data ? (
              <ErrorState error={users.error} onRetry={() => users.reload()} />
            ) : !users.data || users.data.length === 0 ? (
              <EmptyState art="players" title="Ei vielä käyttäjiä" text="Kun ensimmäiset pelaajat liittyvät, he näkyvät tässä." />
            ) : list.length === 0 ? (
              <EmptyState
                compact
                art="search"
                title="Ei osumia"
                text="Kokeile toista hakusanaa tai suodatinta."
                action={<Button variant="outline" size="sm" icon="close" onClick={clearSearch}>Tyhjennä haku</Button>}
              />
            ) : (
              <>
                {narrowed && (
                  <p className="admin-results" aria-live="polite">
                    <span className="t-num">{fmtNum(list.length)}</span> / <span className="t-num">{fmtNum(users.data.length)}</span> käyttäjää
                  </p>
                )}
                <div className="admin-user-list stagger">
                  {list.slice(0, limit).map((u, i) => (
                    <AdminUserCard
                      key={u.id}
                      user={u}
                      sort={sort}
                      index={i % PAGE_SIZE}
                      isSelf={u.id === me?.id}
                      open={openId === u.id}
                      onToggle={() => setOpenId((cur) => (cur === u.id ? null : u.id))}
                      onSaveCities={saveCities}
                      onDelete={deleteUser}
                    />
                  ))}
                </div>
                {list.length > limit && (
                  <Button variant="soft" block className="admin-more" iconRight="chevron-down" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                    Näytä lisää ({fmtNum(list.length - limit)})
                  </Button>
                )}
              </>
            )}
          </Section>
        </div>
      </Page>
    </>
  );
}

/** Hero (players + paid share) and the grouped stat tiles. */
function Overview({ stats, users, active30d }) {
  if (stats.loading) {
    return (
      <div className="admin-overview-skeleton" aria-busy="true" aria-label="Ladataan">
        <Skeleton h={188} r={24} />
        <div className="admin-stat-grid">
          {Array.from({ length: 9 }, (_, i) => <Skeleton key={i} h={96} r={18} />)}
        </div>
      </div>
    );
  }
  if (stats.error && !stats.data) {
    return <ErrorState compact error={stats.error} onRetry={() => stats.reload()} />;
  }
  const s = stats.data || {};
  const values = statValues(s, users);
  const total = typeof s.total_players === 'number' ? s.total_players : 0;
  const paid = typeof s.paid_players === 'number' ? s.paid_players : 0;
  const share = total ? paid / total : 0;

  return (
    <>
      <Card tone="dark" padding="lg" className="admin-hero court-lines">
        <div className="eyebrow">Krossi nyt</div>
        <div className="admin-hero-total">
          <CountUp value={total} format={fmtNum} className="admin-hero-value" />
          <span className="admin-hero-unit">pelaajaa</span>
        </div>
        <div className="admin-hero-chips">
          <Chip tone="lime" size="sm" icon="sparkles">+{fmtNum(s.new_players_7d ?? 0)} viikossa</Chip>
          {active30d != null && <Chip tone="on-dark" size="sm" icon="bolt">{fmtNum(active30d)} aktiivista</Chip>}
        </div>
        <div className="admin-hero-paid">
          <div className="admin-hero-paid-row">
            <span>Maksaneita</span>
            <strong className="t-num">{fmtNum(paid)} · {Math.round(share * 100)} %</strong>
          </div>
          <ProgressBar value={share} tone="lime" label="Maksaneiden osuus" />
        </div>
      </Card>

      {STAT_GROUPS.map((g) => (
        <Section key={g.title} title={g.title} className="admin-stat-section">
          <div className="admin-stat-grid stagger">
            {g.items.map((it, i) => {
              const v = values[it.key];
              const hot = it.alert && typeof v === 'number' && v > 0;
              return (
                <div key={it.key} className="admin-stat" style={{ '--i': i }}>
                  <StatTile
                    label={it.label}
                    icon={it.icon}
                    tone={hot ? 'clay' : 'default'}
                    value={typeof v === 'number' ? <CountUp value={v} format={(n) => (it.unit ? `${fmtNum(n)} ${it.unit}` : fmtNum(n))} /> : '–'}
                  />
                </div>
              );
            })}
          </div>
        </Section>
      ))}
    </>
  );
}
