// plan.jsx — "treenin runko" on screen: a part's rows (court picture, name, minutes) and the
// player's read-only sheet, where a tap opens the drill itself. The coach's editor
// (coach/SessionPlan.jsx) draws the same rows.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../../app/data.jsx';
import { Button, Icon, Sheet } from '../../ui/index.js';
import { buildDrillList, playersLabel } from '../../domain/drills/index.js';
import { PLAN_PARTS, partItems, planMinutes, planSummary, readPlan, resolvePlanItem } from '../../domain/plan.js';
import { koutsiTimeRangeLabel } from '../../domain/core.js';
import { relativeDay } from '../../domain/week.js';
import { CourtDiagram, DrillIcon } from './art.jsx';
import { DrillDetail, DrillDetailSkeleton } from './detail.jsx';
import { useDrillLibrary } from './useLibrary.js';

const cx = (...c) => c.filter(Boolean).join(' ');

/** The drill's court picture on a dark tile, or its topic icon when it has none (or the library is loading). */
export function PlanThumb({ entry, drill, size = 'md' }) {
  const diagram = drill?.diagram || null;
  return (
    <span className={cx('tp-thumb', `is-${size}`)} aria-hidden="true">
      {diagram ? <CourtDiagram diagram={diagram} label="" className="tp-court" /> : <DrillIcon cat={drill?.cat || entry.cat} size={size === 'lg' ? 26 : 22} />}
    </span>
  );
}

/** One planned drill. */
export function PlanRow({ entry, drill, onClick, size = 'md', label }) {
  const meta = [`${entry.minutes} min`, drill ? `${playersLabel(drill.players)} pel.` : null].filter(Boolean).join(' · ');
  return (
    <button type="button" className={cx('tp-row', `is-${size}`)} onClick={onClick} aria-label={label}>
      <PlanThumb entry={entry} drill={drill} size={size} />
      <span className="tp-row-main">
        <span className="tp-row-title">{entry.name}</span>
        <span className="tp-row-meta">{meta}</span>
      </span>
      <Icon name="chevron-right" size={18} className="tp-row-chev" />
    </button>
  );
}

/** A part's heading: number, name and its minutes. */
export function PartHead({ part, n, minutes }) {
  return (
    <header className="tp-part-head">
      <span className="tp-part-n t-num">{n}</span>
      <h3 className="tp-part-title">{part.label}</h3>
      {minutes > 0 && <span className="tp-part-min t-num">{minutes} min</span>}
    </header>
  );
}

/** The parts that have drills, as the players read them (tap → onOpen(entry, drill)). */
export function PlanParts({ plan, drills, onOpen, size = 'md' }) {
  const parts = PLAN_PARTS.map((part) => ({ part, rows: partItems(plan, part.id) })).filter((p) => p.rows.length > 0);
  return (
    <div className="tp-parts">
      {parts.map(({ part, rows }, i) => (
        <section key={part.id} className="tp-part" aria-label={part.label}>
          <PartHead part={part} n={i + 1} minutes={rows.reduce((s, r) => s + r.item.minutes, 0)} />
          <div className="tp-list">
            {rows.map(({ item, index }) => {
              const drill = resolvePlanItem(item, drills);
              return <PlanRow key={`${index}-${item.ref}`} entry={item} drill={drill} size={size} onClick={() => onOpen(item, drill)} />;
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * The player's view of one session's plan. The library loads when the sheet opens, so the
 * court pictures appear a moment after the names.
 *   onPlayVideo(video) — a coach's own drill with a video
 */
export function PlanSheet({ open, training, group, onClose, onPlayVideo }) {
  const { state } = useData();
  const { library, failed, retry } = useDrillLibrary(open);
  const [picked, setPicked] = useState(null);
  const box = useRef(null);
  const listY = useRef(0);
  // A drill opens at its top; back on the plan, the plan is where it was.
  useLayoutEffect(() => {
    const body = box.current?.closest('.sheet-body');
    if (body) body.scrollTop = picked ? 0 : listY.current;
  }, [picked]);
  const pick = (entry) => {
    listY.current = box.current?.closest('.sheet-body')?.scrollTop || 0;
    setPicked(entry);
  };
  const plan = useMemo(() => readPlan(training?.notes), [training?.notes]);
  const drills = useMemo(() => buildDrillList(state.exercises, { library: library || [], dedupe: true }), [state.exercises, library]);
  const close = () => { setPicked(null); onClose(); };
  if (!training) return null;
  const drill = picked ? resolvePlanItem(picked, drills) : null;
  const when = `${relativeDay(training.date)} klo ${koutsiTimeRangeLabel(training.time, training.durationMinutes || group?.durationMinutes)}`;
  return (
    <Sheet open={open} onClose={close} size="lg" title={picked ? picked.name : 'Treenin runko'}
      subtitle={picked ? `${picked.minutes} min tässä treenissä` : `${when} · ${planSummary(plan)}`} onClosed={() => setPicked(null)}>
      {picked ? (
        <div className="stack-4" ref={box}>
          <Button variant="ghost" size="sm" icon="arrow-left" className="tp-back" onClick={() => setPicked(null)}>Takaisin runkoon</Button>
          {drill ? (
            <DrillDetail item={drill} role="player" compact
              actions={drill.video && onPlayVideo ? (
                <div className="dd-actions">
                  <Button variant="dark" icon="play" onClick={() => onPlayVideo({ ...drill.video, title: drill.video.title || drill.name })}>Katso valmentajan video</Button>
                </div>
              ) : null} />
          ) : !library && !failed ? <DrillDetailSkeleton /> : (
            <p className="k-quiet">{failed ? 'Harjoitteen ohje ei latautunut.' : 'Valmentaja kertoo tämän harjoitteen treenissä.'}</p>
          )}
          {failed && <Button variant="outline" size="sm" icon="refresh" onClick={retry}>Yritä uudelleen</Button>}
        </div>
      ) : (
        <div className="stack-4" ref={box}>
          {planMinutes(plan) > 0 && <p className="tp-lead">Valmentajasi suunnitelma tälle treenille. Napauta harjoitetta, niin näet kenttäkuvan ja ohjeen.</p>}
          <PlanParts plan={plan} drills={drills} size="lg" onOpen={pick} />
        </div>
      )}
    </Sheet>
  );
}
