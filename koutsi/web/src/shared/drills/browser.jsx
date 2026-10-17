// browser.jsx — the drill bank's list: search, own/library switch, topic tiles, the filter
// pills (Pelaajia · Taso · Kesto · Lisää) and the results, grouped by topic until one is picked.
// Coach and player use the same component; `role` only changes the wording and the actions.
import { useEffect, useMemo, useState } from 'react';
import { Button, Icon, Input, Segmented, Sheet, Spinner, Toggle } from '../../ui/index.js';
import {
  CATEGORIES, CATEGORY, LEVELS, PLAYER_FILTERS, DURATION_FILTERS, filterDrills, groupByCategory, sortDrills,
  playersLabel, levelLabel,
} from '../../domain/drills/index.js';
import { DrillIcon } from './art.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const EMPTY = { query: '', cat: '', players: '', group: '', level: '', duration: '', source: 'all', solo: false, video: false };
// Filters survive opening a drill and coming back (the screen unmounts in between); a reload resets them.
const remembered = {};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const SHELF = 4;

/**
 * DrillBrowser
 *   items   — buildDrillList(...) output
 *   role    — 'coach' | 'player'
 *   groups  — the coach's groups ({ id, name, level, memberIds }) for "fits my group"
 *   onOpen(item)
 *   track(event) — counts which filters get used (coach only); events are 'pankki.<name>'
 *   loading / failed / onRetry — the library's download (own drills show meanwhile)
 */
export function DrillBrowser({ items, role = 'coach', groups = [], onOpen, track = () => {}, loading, failed, onRetry }) {
  const [f, setF] = useState(() => ({ ...EMPTY, ...remembered[role] }));
  const [sheet, setSheet] = useState(null);
  useEffect(() => { remembered[role] = f; }, [role, f]);
  // A search counts once per visit, not per keystroke.
  const [searched, setSearched] = useState(false);
  const set = (patch) => {
    setF((x) => ({ ...x, ...patch }));
    const turnedOn = (k) => k in patch && patch[k] && patch[k] !== 'all';
    if (turnedOn('cat')) track('pankki.aihe');
    if (turnedOn('group')) track('pankki.ryhma');
    else if (turnedOn('players')) track('pankki.pelaajat');
    if (turnedOn('level') && !patch.group) track('pankki.taso');
    if (turnedOn('duration')) track('pankki.kesto');
    if (turnedOn('solo') || turnedOn('video')) track('pankki.lisaa');
    if ('source' in patch) track('pankki.lahde');
    if (turnedOn('query') && !searched) { setSearched(true); track('pankki.haku'); }
  };

  const group = groups.find((g) => g.id === f.group) || null;
  const filters = { ...f, players: group ? [group.memberIds.length, group.memberIds.length] : f.players };
  const sorted = useMemo(() => sortDrills(items), [items]);
  const list = useMemo(() => filterDrills(sorted, filters), [sorted, f, group]); // eslint-disable-line react-hooks/exhaustive-deps
  // Topic tiles count what the other filters leave, so a tile never promises drills that are not there.
  const perCat = useMemo(() => {
    const rest = filterDrills(sorted, { ...filters, cat: '' });
    return Object.fromEntries(CATEGORIES.map((c) => [c.id, rest.filter((it) => it.cat === c.id).length]).concat([['', rest.length]]));
  }, [sorted, f, group]); // eslint-disable-line react-hooks/exhaustive-deps

  const ownCount = items.filter((it) => it.saved).length;
  const libCount = items.filter((it) => !it.own).length;
  const sourceOptions = role === 'coach'
    ? [{ value: 'all', label: 'Kaikki' }, { value: 'own', label: 'Omat', badge: ownCount || null }, { value: 'library', label: 'Krossin kirjasto' }]
    : [{ value: 'all', label: 'Kaikki' }, { value: 'own', label: 'Valmentajalta', badge: ownCount || null }, { value: 'library', label: 'Krossin kirjasto' }];

  const playersValue = group ? `${group.memberIds.length} · ${group.name}` : PLAYER_FILTERS.find((p) => p.value === f.players)?.label;
  const moreCount = Number(f.solo) + Number(f.video);
  const active = Boolean(f.query || f.cat || f.players || f.group || f.level || f.duration || f.solo || f.video || f.source !== 'all');
  const grouped = !f.cat && !f.query.trim();

  return (
    <div className="dl">
      <Input icon="search" value={f.query} onChange={(e) => set({ query: e.target.value })} placeholder="Hae: esim. kakkossyöttö, lobi, kartiot" aria-label="Hae harjoitetta" type="search" />
      <Segmented ariaLabel="Mistä harjoitteet" size="sm" value={f.source} onChange={(v) => set({ source: v })} options={sourceOptions} className="dl-source" />

      <div className="dl-tiles" role="radiogroup" aria-label="Aihe">
        <TopicTile cat="" label="Kaikki" count={perCat['']} on={!f.cat} onClick={() => set({ cat: '' })} />
        {CATEGORIES.map((c) => (
          <TopicTile key={c.id} cat={c.id} label={c.short} count={perCat[c.id]} on={f.cat === c.id} onClick={() => set({ cat: f.cat === c.id ? '' : c.id })} />
        ))}
      </div>

      <div className="dl-pills" aria-label="Suodattimet">
        <FilterPill icon="users" label="Pelaajia" value={playersValue} onOpen={() => setSheet('players')} onClear={() => set({ players: '', group: '' })} />
        <FilterPill icon="sliders" label="Taso" value={f.level || null} onOpen={() => setSheet('level')} onClear={() => set({ level: '' })} />
        <FilterPill icon="clock" label="Kesto" value={DURATION_FILTERS.find((d) => d.value === f.duration)?.label} onOpen={() => setSheet('duration')} onClear={() => set({ duration: '' })} />
        <FilterPill icon="filter" label="Lisää" value={moreCount ? (moreCount === 2 ? '2 valintaa' : f.solo ? 'Omatoimiset' : 'Videolliset') : null} onOpen={() => setSheet('more')} onClear={() => set({ solo: false, video: false })} />
      </div>

      <div className="dl-count">
        <span><b className="t-num">{list.length}</b> {list.length === 1 ? 'harjoite' : 'harjoitetta'}{f.cat ? ` · ${CATEGORY[f.cat].label}` : ''}</span>
        {active && <button type="button" className="dl-clear" onClick={() => setF({ ...EMPTY })}>Tyhjennä</button>}
      </div>

      {loading && <div className="dl-notice" role="status"><Spinner size={16} />Ladataan Krossin kirjastoa…</div>}
      {failed && (
        <div className="dl-notice is-failed" role="alert">
          <Icon name="alert" size={16} /><span className="grow">Krossin kirjasto ei latautunut.</span>
          <Button variant="outline" size="sm" icon="refresh" onClick={onRetry}>Yritä uudelleen</Button>
        </div>
      )}

      {loading && list.length === 0 ? null : list.length === 0 ? (
        <div className="dl-empty">
          <span className="dl-empty-icon"><Icon name="search" size={22} /></span>
          <p className="dl-empty-title">Ei osumia näillä valinnoilla</p>
          <p className="dl-empty-text">Kokeile väljempää pelaajamäärää tai poista jokin suodatin.</p>
          <Button variant="outline" size="sm" onClick={() => setF({ ...EMPTY, query: f.query })}>Poista suodattimet</Button>
        </div>
      ) : grouped ? (
        <div className="dl-shelves">
          {groupByCategory(list).map(({ cat, items: rows }) => (
            <section key={cat.id} className="dl-shelf" aria-label={cat.label}>
              <header className="dl-shelf-head">
                <span className="dl-shelf-icon"><DrillIcon cat={cat.id} size={18} /></span>
                <h2 className="dl-shelf-title">{cat.label}</h2>
                <span className="dl-shelf-count t-num">{rows.length}</span>
                {rows.length > SHELF && <button type="button" className="dl-shelf-all" onClick={() => { set({ cat: cat.id }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Näytä kaikki</button>}
              </header>
              <div className="dl-list">
                {rows.slice(0, SHELF).map((it) => <DrillRow key={it.key} item={it} role={role} onOpen={onOpen} />)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="dl-list">
          {list.map((it) => <DrillRow key={it.key} item={it} role={role} onOpen={onOpen} />)}
        </div>
      )}

      <PlayersSheet open={sheet === 'players'} onClose={() => setSheet(null)} f={f} set={set} groups={groups} count={(patch) => filterDrills(sorted, { ...filters, ...patch }).length} />
      <ChoiceSheet open={sheet === 'level'} onClose={() => setSheet(null)} title="Taso" subtitle="Näytetään harjoitteet, jotka sopivat tälle tasolle. Kaikille tasoille sopivat ovat aina mukana."
        options={LEVELS.map((l) => ({ value: l, label: l }))} value={f.level} onChange={(v) => set({ level: v })}
        count={(v) => filterDrills(sorted, { ...filters, level: v }).length} />
      <ChoiceSheet open={sheet === 'duration'} onClose={() => setSheet(null)} title="Kesto"
        options={DURATION_FILTERS.map((d) => ({ value: d.value, label: d.label }))} value={f.duration} onChange={(v) => set({ duration: v })}
        count={(v) => filterDrills(sorted, { ...filters, duration: v }).length} />
      <Sheet open={sheet === 'more'} onClose={() => setSheet(null)} title="Lisää suodattimia" size="sm"
        footer={<Button variant="dark" size="lg" block onClick={() => setSheet(null)}>Näytä {plural(list.length, 'harjoite', 'harjoitetta')}</Button>}>
        <div className="stack-3">
          <Toggle checked={f.solo} onChange={(v) => set({ solo: v })} icon="user" label="Omatoimiset"
            hint={role === 'coach' ? 'Pelaaja voi tehdä nämä yksin tai kaverin kanssa — hyviä kotiläksyiksi.' : 'Voit tehdä nämä yksin tai kaverin kanssa ilman valmentajaa.'} />
          <Toggle checked={f.video} onChange={(v) => set({ video: v })} icon="play" label="Vain videolliset"
            hint={role === 'coach' ? 'Harjoitteet, joihin olet lisännyt videon.' : 'Harjoitteet, joihin valmentajasi on lisännyt videon.'} />
        </div>
      </Sheet>
    </div>
  );
}

function TopicTile({ cat, label, count, on, onClick }) {
  return (
    <button type="button" role="radio" aria-checked={on} className={cx('dl-tile', on && 'is-on', !count && 'is-empty')} onClick={onClick}>
      <span className="dl-tile-icon">{cat ? <DrillIcon cat={cat} size={22} /> : <Icon name="grid" size={22} />}</span>
      <span className="dl-tile-label">{label}</span>
      <span className="dl-tile-count t-num">{count}</span>
    </button>
  );
}

function FilterPill({ icon, label, value, onOpen, onClear }) {
  return (
    <span className={cx('dl-pill', value && 'is-on')}>
      <button type="button" className="dl-pill-main" onClick={onOpen} aria-haspopup="dialog">
        <Icon name={icon} size={15} />
        <span className="dl-pill-text">{value ? <><span className="dl-pill-label">{label}</span> {value}</> : label}</span>
        {!value && <Icon name="chevron-down" size={14} />}
      </button>
      {value && (
        <button type="button" className="dl-pill-clear" onClick={onClear} aria-label={`Poista suodatin ${label}`}>
          <Icon name="close" size={14} strokeWidth={2.4} />
        </button>
      )}
    </span>
  );
}

/** One drill in the list: players, minutes and (when not for everyone) the level on one line. */
export function DrillRow({ item, role, onOpen }) {
  const [min, max] = item.players;
  const meta = [
    `${playersLabel(item.players)} ${min === 1 && max === 1 ? 'pelaaja' : 'pel.'}`,
    item.minutes ? `${item.minutes} min` : null,
    item.levels?.length ? levelLabel(item.levels) : null,
  ].filter(Boolean);
  return (
    <button type="button" className="dl-row" onClick={() => onOpen(item)}>
      <span className={cx('dl-row-icon', item.saved && 'is-own')}>
        <DrillIcon cat={item.cat} size={20} />
        {item.video && <span className="dl-row-badge" aria-label="Video"><Icon name="play" size={9} strokeWidth={3} /></span>}
      </span>
      <span className="dl-row-main">
        <span className="dl-row-title">{item.name}</span>
        <span className="dl-row-meta">{meta.join(' · ')}</span>
      </span>
      {item.saved && <span className="dl-row-own">{role === 'coach' ? 'Oma' : 'Valmentajalta'}</span>}
      <Icon name="chevron-right" size={18} className="dl-row-chev" />
    </button>
  );
}

function PlayersSheet({ open, onClose, f, set, groups, count }) {
  const withPlayers = groups.filter((g) => g.memberIds?.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  const pick = (patch) => { set(patch); onClose(); };
  const n = count({});
  return (
    <Sheet open={open} onClose={onClose} title="Montako pelaajaa kentällä?" size="md"
      footer={<Button variant="dark" size="lg" block onClick={onClose}>Näytä {plural(n, 'harjoite', 'harjoitetta')}</Button>}>
      <div className="stack-5">
        <div className="dl-count-grid" role="radiogroup" aria-label="Pelaajia">
          {PLAYER_FILTERS.map((p) => {
            const on = !f.group && f.players === p.value;
            const c = count({ players: p.range, group: '' });
            return (
              <button key={p.value} type="button" role="radio" aria-checked={on} className={cx('dl-count-btn', on && 'is-on')}
                onClick={() => set(on ? { players: '', group: '' } : { players: p.value, group: '' })}>
                <span className="dl-count-num t-num">{p.label}</span>
                <span className="dl-count-sub">{c} harj.</span>
              </button>
            );
          })}
        </div>
        <p className="dl-sheet-note">Harjoite näkyy, jos se toimii tällä pelaajamäärällä yhdellä kentällä.</p>
        {withPlayers.length > 0 && (
          <div className="stack-2">
            <div className="field-label">Tai valitse ryhmä</div>
            <div className="dl-groups">
              {withPlayers.map((g) => {
                const on = f.group === g.id;
                const size = g.memberIds.length;
                return (
                  <button key={g.id} type="button" className={cx('dl-group', on && 'is-on')}
                    onClick={() => pick(on ? { group: '', players: '' } : { group: g.id, players: '', level: LEVELS.includes(g.level) ? g.level : f.level })}>
                    <span className="dl-group-size t-num">{size}</span>
                    <span className="dl-group-main">
                      <span className="dl-group-name">{g.name}</span>
                      <span className="dl-group-sub">{plural(size, 'pelaaja', 'pelaajaa')}{g.level ? ` · ${g.level}` : ''}</span>
                    </span>
                    {on ? <Icon name="check" size={18} strokeWidth={2.6} /> : <span className="dl-group-hits">{count({ players: [size, size], group: '', level: LEVELS.includes(g.level) ? g.level : f.level })}</span>}
                  </button>
                );
              })}
            </div>
            <p className="dl-sheet-note">Ryhmän valinta asettaa myös ryhmän tason, jos se on määritelty.</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function ChoiceSheet({ open, onClose, title, subtitle, options, value, onChange, count }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} subtitle={subtitle} size="sm">
      <div className="dl-choices" role="radiogroup" aria-label={title}>
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button key={o.value} type="button" role="radio" aria-checked={on} className={cx('dl-choice', on && 'is-on')}
              onClick={() => { onChange(on ? '' : o.value); onClose(); }}>
              <span className="dl-choice-label">{o.label}</span>
              <span className="dl-choice-count t-num">{count(o.value)}</span>
              {on && <Icon name="check" size={18} strokeWidth={2.6} />}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
