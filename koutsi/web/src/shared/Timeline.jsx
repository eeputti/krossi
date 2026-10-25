// Timeline.jsx — the Kehitys timeline: one newest-first stream, grouped by month, filterable
// by kind and searchable. The builder is domain/timeline.js (unchanged from the old app).
import { useEffect, useMemo, useState } from 'react';
import { Button, Icon, IconButton, Input } from '../ui/index.js';
import {
  koutsiBuildTimeline, koutsiTlDay, koutsiTlMonthLabel, koutsiTlDayLabel, KOUTSI_TL_KINDS, KOUTSI_TL_KIND_ORDER, KOUTSI_TL_PREVIOUS_LABELS,
} from '../domain/timeline.js';
import { KOUTSI_TAG_LABELS, koutsiTodayStr } from '../domain/core.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const PAGE = 40;
// The player's timeline filters in four plain groups (the coach keeps one chip per kind).
// "Treenit" is every session with its theme — the player's theme history, week by week.
const isOwnVideo = (e) => e.kind === 'video' && e.video?.addedBy === 'player';
const PLAYER_FILTERS = [
  { id: 'kaikki', label: 'Kaikki', test: () => true },
  { id: 'treenit', label: 'Treenit', test: (e) => e.kind === 'training' },
  { id: 'valmentaja', label: 'Valmentajalta', test: (e) => e.kind === 'diary' || e.kind === 'homework' || (e.kind === 'video' && !isOwnVideo(e)) },
  { id: 'omat', label: 'Omat', test: (e) => ['entry', 'mood', 'match', 'goal', 'wish', 'note'].includes(e.kind) || (e.kind === 'training' && e.own) || isOwnVideo(e) },
];
const KIND_ICON = { goal: 'target', entry: 'check', diary: 'edit', homework: 'check-circle', mood: 'heart', match: 'trophy', video: 'play', wish: 'chat', note: 'edit', event: 'flag', training: 'ball', start: 'flag' };

/** A change of goal or aim, one small line: when it changed and from what to what. */
function GoalChange({ event, side }) {
  return (
    <div className="tl-goalchange">
      <div className="tl-goalchange-head">
        <span className="tl-goalchange-icon"><Icon name="target" size={12} /></span>
        <span className="tl-goalchange-title">{event.title}</span>
        {side}
      </div>
      <p className="tl-goalchange-line">
        {event.previous && <><span className="tl-goalchange-old">{event.previous}</span><Icon name="arrow-right" size={12} className="tl-goalchange-arrow" /></>}
        <span className="tl-goalchange-new">{event.body}</span>
      </p>
    </div>
  );
}

function Event({ event, onOpenVideo, renderActions, onArchive }) {
  const kind = KOUTSI_TL_KINDS[event.kind];
  // "Muokkaa": every row offers "Piilota" (to the archive) instead of its usual buttons.
  const actions = onArchive
    ? <button type="button" className="tl-hide" onClick={() => onArchive(event)} aria-label={`Siirrä arkistoon: ${event.title}`}><Icon name="archive" size={14} /> Piilota</button>
    : renderActions ? renderActions(event) : null;
  if (event.kind === 'goal') return <GoalChange event={event} side={<span className="tl-event-side">{actions}</span>} />;
  return (
    <div className={cx('tl-event', `tl-kind-${event.kind}`, event.absent && 'is-absent')}>
      <div className="tl-event-head">
        <span className="tl-badge"><Icon name={KIND_ICON[event.kind] || 'info'} size={12} />{kind.short}</span>
        <span className="tl-event-title">{event.title}</span>
        <span className="tl-event-side">{event.time && <span className="k-faint">{event.time}</span>}{actions}</span>
      </div>
      {event.kind === 'mood' ? (
        <div className="tl-mood">
          <span className="tl-mood-score t-num">{event.score}</span>
          <div className="grow">
            {event.body && <p className="tl-body">{event.body}</p>}
            {event.hidden && <span className="chip chip-sm chip-neutral"><Icon name="lock" size={12} /> Vain sinulle</span>}
          </div>
        </div>
      ) : event.body ? <p className={cx('tl-body', event.done && 'is-done')}>{event.body}</p> : null}
      {event.theme && <p className="tl-theme"><Icon name="sparkles" size={13} />{event.theme}</p>}
      {event.how && (
        <div className="tl-previous">
          <span className="tl-previous-label">Miten meni</span>
          <p>{event.how}</p>
        </div>
      )}
      {event.previous && (
        <div className="tl-previous">
          <span className="tl-previous-label">{KOUTSI_TL_PREVIOUS_LABELS[event.kind] || 'Aiempi'}</span>
          <p>{event.previous}</p>
        </div>
      )}
      {event.kind === 'video' && (
        <div className="row wrap tl-video">
          {(event.tags || []).map((t) => <span key={t} className="chip chip-sm chip-neutral">{KOUTSI_TAG_LABELS[t] || t}</span>)}
          {onOpenVideo && (event.video.storagePath || event.video.externalUrl) && (
            <Button variant="outline" size="sm" icon="play" onClick={() => onOpenVideo(event.video)}>Katso</Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Timeline
 *   student, trainings (already narrowed to this student, with themeTitle/groupName), clubEvents
 *   onOpenVideo(video), renderActions(event) → node, actions: node above the search,
 *   emptyText, showStats, viewer: 'player' (own history) | 'coach'
 *   isHidden(event) → true leaves an event out (the archive, domain/archive.js)
 *   onArchive(event) — set while the player edits: each row shows "Piilota"
 *   initialKind — the filter to start on (e.g. 'valmentaja' from Koti's "Kaikki huomiot")
 */
export function Timeline({ student, trainings, clubEvents, onOpenVideo, renderActions, actions, emptyText, showStats = true, viewer = 'player', isHidden, onArchive, initialKind }) {
  const [kind, setKind] = useState(initialKind || 'kaikki');
  useEffect(() => { if (initialKind) setKind(initialKind); }, [initialKind]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const grouped = viewer === 'player';
  const [limit, setLimit] = useState(PAGE);
  const all = useMemo(() => {
    const built = koutsiBuildTimeline(student, trainings, clubEvents, { viewer });
    return isHidden ? built.filter((e) => !isHidden(e)) : built;
  }, [student, trainings, clubEvents, viewer, isHidden]);
  const counts = useMemo(() => {
    const c = {};
    all.forEach((e) => { c[e.kind] = (c[e.kind] || 0) + 1; });
    return c;
  }, [all]);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('fi');
    const filter = grouped ? (PLAYER_FILTERS.find((f) => f.id === kind) || PLAYER_FILTERS[0]).test : (e) => kind === 'kaikki' || e.kind === kind;
    return all.filter((e) => filter(e) && (!q || (e.search || '').toLocaleLowerCase('fi').includes(q)));
  }, [all, kind, query, grouped]);
  const groupCounts = useMemo(() => Object.fromEntries(PLAYER_FILTERS.map((f) => [f.id, all.filter(f.test).length])), [all]);
  useEffect(() => { setLimit(PAGE); }, [kind, query]);
  const shown = filtered.slice(0, limit);
  const months = useMemo(() => {
    const out = [];
    let current = null;
    let lastDay = null;
    shown.forEach((e) => {
      const day = koutsiTlDay(e.at);
      const key = day.slice(0, 7);
      if (!current || current.key !== key) { current = { key, label: koutsiTlMonthLabel(day), events: [] }; out.push(current); lastDay = null; }
      current.events.push({ event: e, day, showDay: day !== lastDay });
      lastDay = day;
    });
    return out;
  }, [shown]);

  const attended = (trainings || []).filter((t) => t.loggedBy !== 'player' && t.date <= koutsiTodayStr() && !(t.absences || []).some((a) => a.studentId === student.id)).length;
  const own = (trainings || []).filter((t) => t.loggedBy === 'player').length;
  const matches = student.matchNotes || [];
  const wins = matches.filter((n) => n.result === 'voitto').length;
  const losses = matches.filter((n) => n.result === 'tappio').length;
  const activeKinds = KOUTSI_TL_KIND_ORDER.filter((k) => counts[k]);

  return (
    <div className="tl">
      {showStats && (
        <div className="tl-stats">
          <div className="stat-tile"><div className="stat-tile-value t-num">{attended}</div><div className="stat-tile-label">Treenejä</div></div>
          <div className="stat-tile"><div className="stat-tile-value t-num">{own}</div><div className="stat-tile-label">Omia treenejä</div></div>
          <div className="stat-tile"><div className="stat-tile-value t-num">{matches.length}</div><div className="stat-tile-label">Otteluita</div>{(wins || losses) ? <div className="stat-tile-sub">{wins} V – {losses} T</div> : null}</div>
        </div>
      )}
      {(actions || (grouped && all.length > 6)) && (
        <div className="row wrap tl-actions">
          {actions}
          {grouped && all.length > 6 && (
            <IconButton icon={searching ? 'close' : 'search'} label={searching ? 'Sulje haku' : 'Hae merkinnöistä'} variant="soft" size="sm"
              onClick={() => { if (searching) setQuery(''); setSearching((v) => !v); }} />
          )}
        </div>
      )}
      {grouped && all.length > 0 && (
        <div className="tl-filters tl-filters-four" role="group" aria-label="Suodata">
          {PLAYER_FILTERS.filter((f) => f.id === 'kaikki' || groupCounts[f.id] > 0).map((f) => (
            <button key={f.id} type="button" className={cx('planner-chip', kind === f.id && 'is-on')} aria-pressed={kind === f.id} onClick={() => setKind(f.id)}>{f.label}</button>
          ))}
        </div>
      )}
      {grouped && searching && <Input icon="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hae merkinnöistä" aria-label="Hae aikajanalta" autoFocus />}
      {!grouped && all.length > 6 && <Input icon="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hae merkinnöistä" aria-label="Hae aikajanalta" />}
      {!grouped && activeKinds.length > 1 && (
        <div className="tl-filters" role="group" aria-label="Suodata">
          <button type="button" className={cx('planner-chip', kind === 'kaikki' && 'is-on')} onClick={() => setKind('kaikki')}>Kaikki <span className="planner-chip-sub">{all.length}</span></button>
          {activeKinds.map((k) => (
            <button key={k} type="button" className={cx('planner-chip', kind === k && 'is-on')} onClick={() => setKind(k)}>{KOUTSI_TL_KINDS[k].label} <span className="planner-chip-sub">{counts[k]}</span></button>
          ))}
        </div>
      )}
      {filtered.length === 0 ? (
        <p className="k-quiet">{all.length === 0 ? (emptyText || 'Aikajana on vielä tyhjä. Tänne kertyvät teemat, treenit, valmentajan huomiot, tavoitteet ja ottelut.') : 'Ei osumia — kokeile toista hakusanaa tai suodatinta.'}</p>
      ) : months.map((month) => (
        <section key={month.key} className="tl-month">
          <div className="tl-month-head"><span>{month.label}</span><span className="tl-month-line" /><span className="k-faint">{month.events.length}</span></div>
          <div className="tl-rail">
            {month.events.map(({ event, day, showDay }) => (
              <div key={event.id} className="tl-row">
                <div className={cx('tl-day', !showDay && 'is-hidden')}>{koutsiTlDayLabel(day)}</div>
                <div className="tl-dot-col"><span className={cx('tl-dot', `tl-dot-${event.kind}`)} /></div>
                <Event event={event} onOpenVideo={onOpenVideo} renderActions={renderActions} onArchive={onArchive} />
              </div>
            ))}
          </div>
        </section>
      ))}
      {filtered.length > shown.length && (
        <Button variant="outline" block onClick={() => setLimit((n) => n + PAGE)}>Näytä lisää ({filtered.length - shown.length})</Button>
      )}
    </div>
  );
}
