// SessionPlan.jsx — "treenin runko" on the coach's session page: the four parts (Lämmittely →
// Harjoitteet → Peli → Loppu), each with its drills and a button that opens the drill bank as a
// picker, and the total minutes against the session's length. Every change saves at once, like
// an attendance tap: it shows immediately and is written in the background, one write at a time.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, Icon, Sheet, Stepper, useToast } from '../ui/index.js';
import { Block } from '../shared/bits.jsx';
import { buildDrillList } from '../domain/drills/index.js';
import {
  MAX_ITEM_MINUTES, MAX_PLAN_ITEMS, MINUTES_STEP, PLAN_PART, PLAN_PARTS, addToPlan, canMove, movePlanItem, partItems,
  pickerFilters, planFit, planSummary, readPlan, removeFromPlan, resolvePlanItem, setPlanMinutes, writePlan,
} from '../domain/plan.js';
import { DrillBrowser } from '../shared/drills/browser.jsx';
import { DrillDetail, DrillDetailSkeleton } from '../shared/drills/detail.jsx';
import { PartHead, PlanRow } from '../shared/drills/plan.jsx';
import { useDrillLibrary } from '../shared/drills/useLibrary.js';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');

/** Saves plans in order: a tap during a write waits for it, and only the newest plan is sent next. */
function usePlanSaver(trainingId) {
  const { mutate, reload } = useData();
  const toast = useToast();
  const queue = useRef({ busy: false, next: null });
  return useCallback((plan) => {
    const notes = writePlan(plan) || '';
    mutate((s) => ({ ...s, trainings: s.trainings.map((t) => (t.id === trainingId ? { ...t, notes } : t)) }));
    const q = queue.current;
    q.next = plan;
    if (q.busy) return;
    q.busy = true;
    (async () => {
      while (q.next) {
        const next = q.next;
        q.next = null;
        try {
          await api.trainings.setPlan(trainingId, next);
        } catch (err) {
          toast(err);
          q.next = null;
        }
      }
      q.busy = false;
      reload().catch(() => {});
    })();
  }, [trainingId, mutate, reload, toast]);
}

// Minutes move in fives, from wherever the drill's own minutes start (8 → 10 → 15, 8 → 5);
// a drill shorter than five minutes can only grow.
const minMinutes = (prev) => Math.min(prev, MINUTES_STEP);
const stepMinutes = (prev, wanted) => (wanted > prev
  ? Math.min(MAX_ITEM_MINUTES, Math.floor(prev / MINUTES_STEP) * MINUTES_STEP + MINUTES_STEP)
  : Math.max(minMinutes(prev), Math.ceil(prev / MINUTES_STEP) * MINUTES_STEP - MINUTES_STEP));

export function SessionPlan({ training, group }) {
  const { state } = useData();
  const toast = useToast();
  const save = usePlanSaver(training.id);
  const plan = useMemo(() => readPlan(training.notes), [training.notes]);
  // Two taps before a re-render still build on each other.
  const latest = useRef(plan);
  useEffect(() => { latest.current = plan; }, [plan]);
  const [picker, setPicker] = useState(null); // { part, n }
  const [editing, setEditing] = useState(null); // index into plan.items
  const { library, failed, retry } = useDrillLibrary(plan.items.length > 0 || Boolean(picker));
  const drills = useMemo(() => buildDrillList(state.exercises, { library: library || [] }), [state.exercises, library]);

  const change = (next) => { latest.current = next; save(next); };
  const sessionMinutes = training.durationMinutes || group?.durationMinutes || null;
  const fit = planFit(plan, sessionMinutes);
  const full = plan.items.length >= MAX_PLAN_ITEMS;

  const add = (part, drill) => {
    change(addToPlan(latest.current, part, drill));
    track('runko.lisaa');
    setPicker(null);
  };
  const remove = (index) => {
    const before = latest.current;
    const gone = before.items[index];
    change(removeFromPlan(before, index));
    setEditing(null);
    track('runko.poista');
    toast(`Poistettu rungosta: ${gone.name}`, { action: { label: 'Kumoa', onClick: () => change(before) }, duration: 6000 });
  };

  return (
    <Block eyebrow="Treenin runko" title={planSummary(plan)} className="tp" id="runko">
      <p className={cx('field-msg', fit?.diff > 0 && 'tp-over')}>
        {fit ? `${fit.text}. ` : ''}Näkyy ryhmän pelaajille uudessa Koutsissa.
      </p>
      <div className="tp-parts">
        {PLAN_PARTS.map((part, i) => {
          const rows = partItems(plan, part.id);
          return (
            <section key={part.id} className="tp-part" aria-label={part.label}>
              <PartHead part={part} n={i + 1} minutes={rows.reduce((s, r) => s + r.item.minutes, 0)} />
              {rows.length > 0 && (
                <div className="tp-list">
                  {rows.map(({ item, index }) => (
                    <PlanRow key={`${index}-${item.ref}`} entry={item} drill={resolvePlanItem(item, drills)}
                      label={`${item.name}, ${item.minutes} min. Muokkaa.`} onClick={() => setEditing(index)} />
                  ))}
                </div>
              )}
              {!full && (
                <button type="button" className="tp-add" onClick={() => { track('runko.avaa'); setPicker({ part: part.id, n: Date.now() }); }}>
                  <Icon name="plus" size={16} strokeWidth={2.6} />{part.add}
                </button>
              )}
            </section>
          );
        })}
      </div>
      {full && <p className="field-msg">Runkoon mahtuu {MAX_PLAN_ITEMS} harjoitetta.</p>}

      <PlanItemSheet plan={plan} index={editing} drills={drills} loading={!library && !failed}
        onClose={() => setEditing(null)} onRemove={remove}
        onMinutes={(index, minutes) => { change(setPlanMinutes(latest.current, index, minutes)); track('runko.kesto'); }}
        onMove={(index, dir) => {
          const before = latest.current;
          const sameNeighbour = before.items[index + dir]?.part === before.items[index].part;
          change(movePlanItem(before, index, dir));
          // a swap moves the row to the next index; crossing into the next part keeps its index
          if (sameNeighbour) setEditing(index + dir);
          track('runko.siirra');
        }} />
      <PlanPickerSheet picker={picker} group={group} training={training} drills={drills}
        loading={!library && !failed} failed={failed} onRetry={retry}
        onClose={() => setPicker(null)} onAdd={add} />
    </Block>
  );
}

/** One planned drill: its minutes in this session, move up/down, remove, and the drill itself. */
function PlanItemSheet({ plan, index, drills, loading, onClose, onRemove, onMinutes, onMove }) {
  const entry = index != null ? plan.items[index] : null;
  // Keep the last entry drawn while the sheet slides away.
  const shown = useRef(null);
  if (entry) shown.current = { entry, index };
  const cur = shown.current;
  const drill = cur ? resolvePlanItem(cur.entry, drills) : null;
  return (
    <Sheet open={Boolean(entry)} onClose={onClose} size="lg" title={cur?.entry.name}
      subtitle={cur ? PLAN_PART[cur.entry.part].label : ''}>
      {cur && (
        <div className="stack-5">
          <div className="tp-controls">
            <div className="tp-control">
              <span className="field-label">Kesto tässä treenissä</span>
              <div className="tp-minutes">
                <Stepper value={cur.entry.minutes} min={minMinutes(cur.entry.minutes)} max={MAX_ITEM_MINUTES} step={MINUTES_STEP} label="Kesto minuutteina" size="sm"
                  onChange={(v) => onMinutes(cur.index, stepMinutes(cur.entry.minutes, v))} />
                <span className="tp-minutes-unit">min</span>
              </div>
            </div>
            <div className="tp-control">
              <span className="field-label">Järjestys</span>
              <div className="row">
                <Button variant="outline" size="sm" icon="chevron-up" disabled={!canMove(plan, cur.index, -1)} onClick={() => onMove(cur.index, -1)}>Ylös</Button>
                <Button variant="outline" size="sm" icon="chevron-down" disabled={!canMove(plan, cur.index, 1)} onClick={() => onMove(cur.index, 1)}>Alas</Button>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" icon="trash" className="tp-remove" onClick={() => onRemove(cur.index)}>Poista rungosta</Button>
          {drill ? <DrillDetail item={drill} role="coach" compact />
            : loading ? <DrillDetailSkeleton />
              : <p className="k-quiet">Tätä harjoitetta ei enää löydy harjoitepankista. Se pysyy rungossa nimellä.</p>}
        </div>
      )}
    </Sheet>
  );
}

/**
 * The drill bank as a picker for one part: filters start from the part's topic and the
 * session's group (its size on one court and its level). A tap shows the drill; "Lisää
 * runkoon" adds it, "Takaisin" returns to the list as it was (filters and scroll kept).
 */
function PlanPickerSheet({ picker, group, training, drills, loading, failed, onRetry, onClose, onAdd }) {
  const [preview, setPreview] = useState(null);
  const last = useRef(null);
  if (picker) last.current = picker;
  const cur = last.current;
  const box = useRef(null);
  const listY = useRef(0);
  useEffect(() => { setPreview(null); }, [picker?.n]);
  // The drill opens at its top; back on the list, the list is where it was.
  useLayoutEffect(() => {
    const body = box.current?.closest('.sheet-body');
    if (body) body.scrollTop = preview ? 0 : listY.current;
  }, [preview]);
  const open = (item) => {
    listY.current = box.current?.closest('.sheet-body')?.scrollTop || 0;
    setPreview(item);
  };
  const part = cur ? PLAN_PART[cur.part] : null;
  const initial = useMemo(() => (cur ? pickerFilters(cur.part, { group, training }) : null), [cur?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = group ? [group] : [];
  return (
    <Sheet open={Boolean(picker)} onClose={onClose} size="lg"
      title={preview ? preview.name : part?.add} subtitle={preview ? `${part?.label} · ${preview.minutes ? `${preview.minutes} min` : 'kesto vapaa'}` : null}
      footer={preview ? (
        <div className="sheet-actions">
          <Button variant="soft" size="lg" onClick={() => setPreview(null)}>Takaisin</Button>
          <Button variant="dark" size="lg" icon="plus" onClick={() => onAdd(cur.part, preview)}>Lisää runkoon</Button>
        </div>
      ) : null}>
      {cur && (
        <div ref={box}>
          {preview && <DrillDetail item={preview} role="coach" compact />}
          <div hidden={Boolean(preview)}>
            <DrillBrowser key={cur.n} items={drills} role="coach" groups={groups} initial={initial}
              loading={loading} failed={failed} onRetry={onRetry} onOpen={open} />
          </div>
        </div>
      )}
    </Sheet>
  );
}
