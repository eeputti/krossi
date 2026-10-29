// ThemeGrid — Suunnittele → Teemat, edited like a spreadsheet: every group (rows) × the coming
// weeks (columns), one cell = one group's theme for one week.
//   - pick many at once: drag over cells, week headers or group names; every drag adds to what is
//     already picked, a click picks or drops one cell, Esc starts over
//   - type straight into a cell (double-click or just start typing); Enter writes to every picked
//     cell, or moves down when one cell is picked; Tab moves right
//   - drag the fill handle in the picked block's corner to copy its themes right or down (a 2-week
//     pattern repeats); text dragged from elsewhere can be dropped on a cell
//   - ⌘/Ctrl+C and V copy and paste, also straight from Excel or Google Sheets
//   - Delete clears, ⌘/Ctrl+Z (or "Kumoa" in the toast) undoes the last change
// There are no "are you sure" questions on the way: every change can be undone instead.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, Field, Icon, IconButton, Input, Sheet, Textarea, useConfirm, useToast } from '../ui/index.js';
import {
  koutsiAddIsoWeeks, koutsiCompareIsoWeeks, koutsiCurrentIsoWeek, koutsiIsoWeekKey, koutsiIsoWeekRangeLabel,
  koutsiThemeKey, koutsiThemeLibrary, KOUTSI_THEME_LEAD_MAX, KOUTSI_THEME_TITLE_MAX,
} from '../domain/core.js';
import { plannerDefaultWeek } from '../domain/week.js';
import {
  boundsOf, cellsIn, changesToWrites, clipFromText, clipOf, clipToText, commonTheme, effectiveChanges, fillChanges,
  gridWeeks, pasteChanges, pickedRect, pickSummary, rectOf, snapshotOf, themeGrid, themeWritePlan, undoWrites, withLead,
  GRID_WEEKS,
} from '../domain/planning.js';
import { groupPath } from './nav.js';
import { Link } from '../app/router.js';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const summaryText = ({ groups, weeks }) => `${plural(groups, 'ryhmä', 'ryhmää')}, ${plural(weeks, 'viikko', 'viikkoa')}`;
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const MOD = isMac ? '⌘' : 'Ctrl';
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const THEME_TYPE = 'application/x-koutsi-theme';

function droppedTheme(dt) {
  try {
    const raw = dt.getData(THEME_TYPE);
    if (raw) { const t = JSON.parse(raw); if (t?.title) return { title: String(t.title), lead: String(t.lead || '') }; }
  } catch { /* fall back to plain text */ }
  const text = (dt.getData('text/plain') || '').split(/\r?\n/)[0].split('\t')[0].trim().slice(0, KOUTSI_THEME_TITLE_MAX);
  return text ? { title: text, lead: '' } : null;
}

/** The picked cells' theme with its lead (tarkennus), as a form. */
function ThemeWriteSheet({ open, cells, onClose, onApply }) {
  const { state } = useData();
  const confirm = useConfirm();
  const common = useMemo(() => commonTheme(cells), [cells]);
  const [title, setTitle] = useState('');
  const [lead, setLead] = useState('');
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState(null);
  const seedKey = open ? cells.map((c) => c.key).join(',') : null;
  if (seedKey !== seeded) {
    setSeeded(seedKey);
    setTitle(common?.title || '');
    setLead(common && !common.mixedLead ? common.lead : '');
  }
  const library = useMemo(() => koutsiThemeLibrary(state.groups).filter((t) => !common || t.key !== common.key), [state.groups, common]);
  const plan = useMemo(() => themeWritePlan(cells, title, lead, common?.key ?? null), [cells, title, lead, common]);
  const sum = pickSummary(cells);
  const cleanTitle = title.trim();

  const save = async () => {
    if (!cleanTitle || busy) return;
    let skip = new Set();
    if (plan.conflicts.length > 0) {
      const names = [...new Set(plan.conflicts.map((c) => c.theme.title))];
      const choice = await confirm({
        title: `${plural(plan.conflicts.length, 'ruudussa', 'ruudussa')} on jo toinen teema`,
        message: `${names.slice(0, 4).join(', ')}${names.length > 4 ? ` ja ${names.length - 4} muuta` : ''}. Korvataanko nekin teemalla ”${cleanTitle}”?`,
        confirmLabel: 'Korvaa nekin', secondaryLabel: 'Tallenna vain muihin', secondaryValue: 'skip', cancelLabel: 'Peruuta',
      });
      if (!choice) return;
      if (choice === 'skip') skip = new Set(plan.conflicts.map((c) => c.key));
    }
    const byKey = new Map([...plan.fresh, ...plan.replace].map((row) => [`${row.groupId}|${koutsiIsoWeekKey(row)}`, row]));
    const changes = cells.filter((c) => byKey.has(c.key) && !skip.has(c.key)).map((c) => ({ cell: c, theme: { title: byKey.get(c.key).title, lead: byKey.get(c.key).lead } }));
    setBusy(true);
    const ok = await onApply(changes, common ? 'suunnittele.teema-muokattu' : 'suunnittele.teema-tallennettu');
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="md"
      title={common ? 'Muokkaa teemaa' : 'Aseta teema'}
      subtitle={`${summaryText(sum)}, ${plural(sum.cells, 'ruutu', 'ruutua')}`}
      footer={(
        <div className="sheet-actions">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button>
          <Button variant="dark" size="lg" loading={busy} missing={!cleanTitle ? 'Kirjoita teema ensin.' : null} onClick={save}>
            {cleanTitle ? `Tallenna ${plural(plan.fresh.length + plan.replace.length, 'ruutuun', 'ruutuun')}` : 'Kirjoita teema'}
          </Button>
        </div>
      )}>
      <div className="stack-4">
        <Field label="Teema" htmlFor="tg-title">
          <Input id="tg-title" size="lg" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={KOUTSI_THEME_TITLE_MAX}
            list="tg-library" placeholder="Esim. Syöttö / smash" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
        </Field>
        {!common && library.length > 0 && !cleanTitle && (
          <div className="planner-recent">
            <div className="field-label">Aiemmat teemat</div>
            <div className="row wrap">
              {library.slice(0, 8).map((t) => (
                <button key={t.key} type="button" className="planner-chip" onClick={() => { setTitle(t.title); setLead(t.lead || ''); }}>
                  {t.title}<span className="planner-chip-sub">vko {t.week}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Tarkennus pelaajille" optional htmlFor="tg-lead" hint={common?.mixedLead ? 'Ruuduilla on eri tarkennukset. Tyhjänä jokainen pitää omansa.' : 'Näkyy pelaajan sovelluksessa teeman alla.'}>
          <Textarea id="tg-lead" rows={2} value={lead} onChange={(e) => setLead(e.target.value)} maxLength={KOUTSI_THEME_LEAD_MAX}
            placeholder="Esim. Pallon heitto samaan kohtaan ja iskulyönti liikkeestä." />
        </Field>
        {cleanTitle && plan.conflicts.length > 0 && (
          <p className="k-warn-text">{plural(plan.conflicts.length, 'ruudussa', 'ruudussa')} on jo toinen teema. Kysyn ennen kuin korvaan ne.</p>
        )}
      </div>
    </Sheet>
  );
}

export function ThemeGrid() {
  const { state, run } = useData();
  const toast = useToast();
  const now = koutsiCurrentIsoWeek();
  const first = plannerDefaultWeek();
  const [start, setStart] = useState(first);
  const wrapRef = useRef(null);
  const [cols, setCols] = useState(GRID_WEEKS);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const fit = () => setCols(clamp(Math.floor((el.clientWidth - 200) / 132), 4, 12));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const weeks = useMemo(() => gridWeeks(start, cols), [start, cols]);
  const rows = useMemo(() => themeGrid(state.groups, state.trainings, weeks), [state.groups, state.trainings, weeks]);
  const allCells = useMemo(() => rows.flatMap((r) => r.cells), [rows]);

  const [picked, setPicked] = useState(() => new Set());
  const [anchor, setAnchor] = useState(null); // { r, c } — where Shift extends from
  const [active, setActive] = useState(null); // { r, c } — the cell the keyboard is on
  const [editing, setEditing] = useState(null); // { r, c, initial }
  const [fillTo, setFillTo] = useState(null);
  const [dropKey, setDropKey] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const gridRef = useRef(null);
  const drag = useRef(null); // { mode: 'cells' | 'rows' | 'cols' | 'fill', ... }
  const editRef = useRef(null);
  const clipRef = useRef(null);
  const kbMove = useRef(false);
  const lastTouch = useRef(0); // a phone: taps pick one by one, no dragging
  const touched = () => Date.now() - lastTouch.current < 1200;
  const touchDevice = typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches;
  const latest = useRef({});
  latest.current = { state, rows, picked, active, anchor, undoStack, fillTo };

  useEffect(() => { setPicked(new Set()); setAnchor(null); setActive(null); setEditing(null); editRef.current = null; }, [start, cols]);

  const pickedCells = useMemo(() => allCells.filter((c) => picked.has(c.key)), [allCells, picked]);
  const rect = useMemo(() => pickedRect(rows, picked), [rows, picked]);
  const common = commonTheme(pickedCells);
  const withTheme = pickedCells.filter((c) => c.theme);
  const atStart = koutsiCompareIsoWeeks(start, first) <= 0;
  const fullRect = { r0: 0, r1: rows.length - 1, c0: 0, c1: weeks.length - 1 };

  // ── writing, with undo ──
  const write = useCallback(async (changes, done, event) => {
    const eff = effectiveChanges(changes);
    if (!eff.length) { toast('Ei muutoksia — ruuduissa oli jo tämä.', { tone: 'info' }); return true; }
    const snap = snapshotOf(eff);
    const { save, remove } = changesToWrites(eff);
    const res = await run(async () => {
      if (save.length) await api.themes.save(save);
      if (remove.length) await api.themes.remove(remove);
    });
    if (!res.ok) return false;
    if (event) track(event);
    setUndoStack((s) => [...s.slice(-19), snap]);
    toast(done(eff.length), { action: { label: 'Kumoa', onClick: () => undoRef.current() }, duration: 7000 });
    return true;
  }, [run, toast]);
  const writeRef = useRef(write);
  writeRef.current = write;

  const undo = async () => {
    const stack = latest.current.undoStack;
    if (!stack.length) { toast('Ei kumottavaa.', { tone: 'info' }); return; }
    const snap = stack[stack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    const { save, remove } = undoWrites(latest.current.state.groups, snap);
    if (!save.length && !remove.length) { toast('Ei kumottavaa.', { tone: 'info' }); return; }
    const res = await run(async () => {
      if (save.length) await api.themes.save(save);
      if (remove.length) await api.themes.remove(remove);
    }, 'Muutos kumottu.');
    if (res.ok) track('suunnittele.kumoa');
  };
  const undoRef = useRef(undo);
  undoRef.current = undo;

  // ── picking ──
  const keysIn = (r) => {
    const keys = new Set(cellsIn(rows, r).map((c) => c.key));
    if (r.r0 === r.r1 && r.c0 === r.c1 && rows[r.r0]) keys.add(rows[r.r0].cells[r.c0].key); // one clicked cell, even a break week
    return keys;
  };
  const pickRect = (a, b) => setPicked(keysIn(rectOf(a, b)));
  const toggleKeys = (keys) => setPicked((prev) => {
    const next = new Set(prev);
    const off = keys.length > 0 && keys.every((k) => next.has(k));
    keys.forEach((k) => (off ? next.delete(k) : next.add(k)));
    return next;
  });
  const focusGrid = () => gridRef.current?.focus({ preventScroll: true });

  // A click picks or drops one cell; a drag adds the block it covers to what is already picked,
  // so a coach can release and drag again to add more. Shift adds the block from the last cell.
  // Esc or "Tyhjennä valinta" starts over.
  const addKeys = (keys) => setPicked((prev) => new Set([...prev, ...keys]));
  const onCellDown = (e, r, c) => {
    if (e.button !== 0 || editRef.current) return;
    const key = rows[r].cells[c].key;
    if (touched()) { toggleKeys([key]); setActive(null); return; } // no keyboard cursor on a phone
    e.preventDefault();
    focusGrid();
    const p = { r, c };
    if (e.shiftKey && anchor) { addKeys(keysIn(rectOf(anchor, p))); setActive(p); return; }
    const next = new Set(picked);
    if (next.has(key)) next.delete(key); else next.add(key);
    setPicked(next);
    setAnchor(p);
    setActive(p);
    drag.current = { mode: 'cells', anchor: p, base: next, moved: false };
  };
  const onCellEnter = (r, c) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'cells') {
      if (!d.moved && r === d.anchor.r && c === d.anchor.c) return;
      d.moved = true;
      setPicked(new Set([...d.base, ...keysIn(rectOf(d.anchor, { r, c }))]));
      setActive({ r, c });
    }
    if (d.mode === 'fill') setFillTo({ r, c });
    if (d.mode === 'rows') setPicked(new Set([...d.base, ...keysIn({ ...fullRect, r0: Math.min(d.from, r), r1: Math.max(d.from, r) })]));
    if (d.mode === 'cols') setPicked(new Set([...d.base, ...keysIn({ ...fullRect, c0: Math.min(d.from, c), c1: Math.max(d.from, c) })]));
  };
  // a group name or a week header: a click picks or drops the whole row / column, a drag adds more
  const headerDown = (keys, from, mode, at) => {
    const next = new Set(picked);
    const allOn = keys.length > 0 && keys.every((k) => next.has(k));
    keys.forEach((k) => (allOn ? next.delete(k) : next.add(k)));
    setPicked(next);
    drag.current = { mode, from, base: next };
    setAnchor(at);
    setActive(at);
  };
  const onRowDown = (e, r) => {
    if (e.button !== 0) return;
    const keys = [...keysIn({ ...fullRect, r0: r, r1: r })];
    if (touched()) { toggleKeys(keys); return; }
    e.preventDefault();
    focusGrid();
    if (e.shiftKey && anchor) { addKeys(keysIn({ ...fullRect, r0: Math.min(anchor.r, r), r1: Math.max(anchor.r, r) })); setActive({ r, c: 0 }); return; }
    headerDown(keys, r, 'rows', { r, c: 0 });
  };
  const onColDown = (e, c) => {
    if (e.button !== 0) return;
    const keys = [...keysIn({ ...fullRect, c0: c, c1: c })];
    if (touched()) { toggleKeys(keys); return; }
    e.preventDefault();
    focusGrid();
    if (e.shiftKey && anchor) { addKeys(keysIn({ ...fullRect, c0: Math.min(anchor.c, c), c1: Math.max(anchor.c, c) })); setActive({ r: 0, c }); return; }
    headerDown(keys, c, 'cols', { r: 0, c });
  };

  // ── the fill handle ──
  const startFill = (e) => {
    if (e.button !== 0 || !rect) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = { mode: 'fill', src: rect };
    setFillTo(null);
  };
  useEffect(() => {
    const up = async () => {
      const d = drag.current;
      drag.current = null;
      if (d?.mode !== 'fill') return;
      const to = latest.current.fillTo;
      setFillTo(null);
      if (!to) return;
      const { rect: grown, changes } = fillChanges(latest.current.rows, d.src, to);
      setPicked(new Set(cellsIn(latest.current.rows, grown).map((c) => c.key)));
      if (!changes.length) return;
      await writeRef.current(changes, (n) => `Teemat kopioitu ${plural(n, 'ruutuun', 'ruutuun')}.`, 'suunnittele.taytto');
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);
  const fillPreview = drag.current?.mode === 'fill' && fillTo ? fillChanges(rows, drag.current.src, fillTo).rect : null;
  const inRect = (r, c, q) => q && r >= q.r0 && r <= q.r1 && c >= q.c0 && c <= q.c1;

  // ── typing ──
  // Typing writes to the picked cells: in the cell under the cursor when it is picked, else in the
  // first picked one. A double-click picks the cell (a click before it may have dropped it).
  const startEdit = (p, initial, { pick = false } = {}) => {
    let at = p;
    let cell = rows[p.r]?.cells[p.c];
    if (!cell) return;
    if (pick) setPicked((prev) => new Set([...prev, cell.key]));
    else if (!picked.has(cell.key)) {
      const first = rows.flatMap((row, r) => row.cells.map((c2, c) => ({ c2, r, c }))).find((x) => picked.has(x.c2.key));
      if (first) { at = { r: first.r, c: first.c }; cell = first.c2; } else { setPicked(new Set([cell.key])); setAnchor(p); }
    }
    setActive(at);
    editRef.current = { r: at.r, c: at.c };
    setEditing({ r: at.r, c: at.c, initial: initial ?? (cell.theme?.title || '') });
  };
  const moveActive = (from, dr, dc) => {
    const { rows: rws } = latest.current;
    const next = { r: clamp(from.r + dr, 0, rws.length - 1), c: clamp(from.c + dc, 0, weeks.length - 1) };
    kbMove.current = true;
    setActive(next);
    setAnchor(next);
    setPicked(new Set([rws[next.r].cells[next.c].key]));
  };
  const commitEdit = async (value, move) => {
    const ed = editRef.current;
    if (!ed) return;
    editRef.current = null;
    setEditing(null);
    focusGrid();
    const { rows: rws, picked: pk } = latest.current;
    const cell = rws[ed.r]?.cells[ed.c];
    if (!cell) return;
    const title = value.trim().slice(0, KOUTSI_THEME_TITLE_MAX);
    const many = pk.size > 1 && pk.has(cell.key);
    const targets = many ? rws.flatMap((r) => r.cells).filter((c) => pk.has(c.key)) : [cell];
    if (!many && move) moveActive(ed, move === 'down' ? 1 : 0, move === 'right' ? 1 : move === 'left' ? -1 : 0);
    if (!many && title === (cell.theme?.title || '')) return;
    const changes = targets.map((c) => ({ cell: c, theme: title ? withLead(c, { title, lead: '' }) : null }));
    await writeRef.current(changes, (n) => (title ? `”${title}”, ${plural(n, 'ruutu', 'ruutua')}.` : `Teema poistettu ${plural(n, 'ruudusta', 'ruudusta')}.`), 'suunnittele.kirjoitus');
  };
  const cancelEdit = () => { editRef.current = null; setEditing(null); focusGrid(); };

  const clearPicked = () => {
    const cells = latest.current.rows.flatMap((r) => r.cells).filter((c) => latest.current.picked.has(c.key) && c.theme);
    if (!cells.length) return;
    write(cells.map((cell) => ({ cell, theme: null })), (n) => `Teema poistettu ${plural(n, 'ruudusta', 'ruudusta')}.`, 'suunnittele.teema-poistettu');
  };
  const applyTheme = (theme, targets) => {
    if (!targets.length) { toast('Valitse ensin ruudut, tai vedä teema suoraan ruutuun.', { tone: 'info' }); return; }
    write(targets.map((cell) => ({ cell, theme: withLead(cell, theme) })).filter((x) => x.theme),
      (n) => `”${theme.title}”, ${plural(n, 'ruutu', 'ruutua')}.`, 'suunnittele.teema-vedetty');
  };

  // ── keys ──
  const onKeyDown = (e) => {
    if (editRef.current) {
      // letters typed in the moment before the cell's input takes focus still belong to it
      if (e.target === gridRef.current && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setEditing((ed) => (ed ? { ...ed, initial: ed.initial + e.key } : ed));
      }
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (mod && key === 'z') { e.preventDefault(); undo(); return; }
    if (mod && key === 'a') { e.preventDefault(); setPicked(new Set(cellsIn(rows, fullRect).map((c) => c.key))); return; }
    if (mod || e.altKey) return; // copy and paste arrive as their own events
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[e.key]) {
      e.preventDefault();
      const cur = active || { r: 0, c: 0 };
      if (!active) { moveActive(cur, 0, 0); return; }
      const [dr, dc] = moves[e.key];
      const next = { r: clamp(cur.r + dr, 0, rows.length - 1), c: clamp(cur.c + dc, 0, weeks.length - 1) };
      kbMove.current = true;
      setActive(next);
      if (e.shiftKey) pickRect(anchor || cur, next);
      else { setAnchor(next); setPicked(new Set([rows[next.r].cells[next.c].key])); }
      return;
    }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(active || { r: 0, c: 0 }); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearPicked(); return; }
    if (e.key === 'Escape') { setPicked(new Set()); return; }
    if (e.key.length === 1 && e.key !== ' ') { e.preventDefault(); startEdit(active || { r: 0, c: 0 }, e.key); }
  };
  useEffect(() => {
    if (!kbMove.current || !active) return;
    kbMove.current = false;
    const cell = rows[active.r]?.cells[active.c];
    if (cell) document.getElementById(`tg-${cell.key}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, rows]);

  // ── copy and paste (also from Excel / Sheets) ──
  useEffect(() => {
    const inGrid = () => gridRef.current && gridRef.current.contains(document.activeElement) && !editRef.current;
    const onCopy = (e) => {
      if (!inGrid()) return;
      const { rows: rws, picked: pk } = latest.current;
      if (!pk.size) return;
      const clip = clipOf(rws, pk);
      const text = clipToText(clip);
      e.clipboardData.setData('text/plain', text);
      e.preventDefault();
      clipRef.current = { clip, text };
      const n = clip.flat().filter(Boolean).length;
      toast(n ? `Kopioitu ${plural(n, 'teema', 'teemaa')}. Valitse kohta ja liitä (${MOD}+V).` : 'Valituissa ruuduissa ei ole teemaa.', { tone: n ? undefined : 'info' });
    };
    const onPaste = (e) => {
      if (!inGrid()) return;
      const text = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
      e.preventDefault();
      const clip = clipRef.current && clipRef.current.text === text ? clipRef.current.clip : clipFromText(text);
      if (!clip.length) return;
      const { rows: rws, picked: pk, active: act } = latest.current;
      const bounds = boundsOf(rws, pk);
      const at = bounds ? { r: bounds.r0, c: bounds.c0 } : act;
      if (!at) { toast('Valitse ensin ruutu, johon liität.', { tone: 'info' }); return; }
      const pc = rws.flatMap((r) => r.cells).filter((c) => pk.has(c.key));
      const changes = pasteChanges(rws, clip, at, pc);
      if (!changes.length) { toast('Liitettävässä ei ollut teemoja.', { tone: 'info' }); return; }
      setPicked(new Set(changes.map((x) => x.cell.key)));
      writeRef.current(changes, (n) => `Liitetty ${plural(n, 'ruutuun', 'ruutuun')}.`, 'suunnittele.liita');
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    return () => { document.removeEventListener('copy', onCopy); document.removeEventListener('paste', onPaste); };
  }, [toast]);

  const move = (n) => setStart((s) => {
    const next = koutsiAddIsoWeeks(s, n);
    return koutsiCompareIsoWeeks(next, first) < 0 ? first : next;
  });
  const pickSame = () => {
    if (!common) return;
    setPicked(new Set(allCells.filter((c) => c.theme && koutsiThemeKey(c.theme.title) === common.key).map((c) => c.key)));
  };

  if (rows.length === 0) {
    return <p className="k-quiet">Luo ensin ryhmä Viikkohallinnassa — sen viikot tulevat tähän.</p>;
  }
  const sum = pickSummary(pickedCells);
  const activeKey = active ? rows[active.r]?.cells[active.c]?.key : null;
  const dropOnPicked = dropKey && picked.has(dropKey) && picked.size > 1;
  return (
    <div className="tg-wrap" ref={wrapRef}>
      <div className="tg-toolbar">
        <div className="tg-nav">
          <IconButton icon="chevron-left" label="Aiemmat viikot" variant="soft" onClick={() => move(-Math.max(2, Math.floor(cols / 2)))} disabled={atStart} />
          <div className="tg-range">
            <span className="tg-range-title">Viikot {weeks[0].week}–{weeks[weeks.length - 1].week}</span>
            <span className="tg-range-sub t-num">{koutsiIsoWeekRangeLabel(weeks[0].year, weeks[0].week).split('–')[0]}–{koutsiIsoWeekRangeLabel(weeks[weeks.length - 1].year, weeks[weeks.length - 1].week).split('–')[1]}</span>
          </div>
          <IconButton icon="chevron-right" label="Seuraavat viikot" variant="soft" onClick={() => move(Math.max(2, Math.floor(cols / 2)))} />
          {!atStart && <button type="button" className="wb-today-btn" onClick={() => setStart(first)}>Tämä viikko</button>}
        </div>
        {undoStack.length > 0 && <Button variant="outline" size="sm" icon="undo" onClick={undo}>Kumoa</Button>}
      </div>

      <div className="tg-scroll">
        <div ref={gridRef} className={cx('tg', editing && 'is-editing')} role="grid" tabIndex={0} aria-label="Teemat viikoittain" aria-multiselectable="true"
          aria-activedescendant={activeKey ? `tg-${activeKey}` : undefined}
          onKeyDown={onKeyDown} onTouchStart={() => { lastTouch.current = Date.now(); }} style={{ '--tg-weeks': weeks.length }}>
          <div className="tg-row tg-head" role="row">
            <div className="tg-corner" role="columnheader">Ryhmä</div>
            {weeks.map((week, i) => {
              const pool = rows.filter((r) => r.cells[i].sessions);
              const covered = pool.filter((r) => r.cells[i].theme).length;
              const keys = pool.map((r) => r.cells[i].key);
              const on = keys.length > 0 && keys.every((k) => picked.has(k));
              const isNow = koutsiCompareIsoWeeks(week, now) === 0;
              return (
                <div key={koutsiIsoWeekKey(week)} role="columnheader" aria-selected={on}
                  className={cx('tg-week', on && 'is-on', isNow && 'is-now')}
                  onMouseDown={(e) => onColDown(e, i)} onMouseEnter={() => onCellEnter(0, i)} title={`Valitse viikko ${week.week} — vedä valitaksesi monta viikkoa`}>
                  {/* its own line above the number: beside it, the tag broke in two in a narrow column */}
                  {isNow && <span className="tg-week-now">Tämä viikko</span>}
                  <span className="tg-week-num">Vko {week.week}</span>
                  <span className="tg-week-dates t-num">{koutsiIsoWeekRangeLabel(week.year, week.week)}</span>
                  <span className={cx('tg-week-cov', pool.length > 0 && covered === pool.length && 'is-full')}>{pool.length ? `${covered}/${pool.length} teema` : 'ei treenejä'}</span>
                </div>
              );
            })}
          </div>
          {rows.map((row, r) => {
            const keys = cellsIn(rows, { r0: r, r1: r, c0: 0, c1: weeks.length - 1 }).map((c) => c.key);
            const rowOn = keys.length > 0 && keys.every((k) => picked.has(k));
            return (
              <div key={row.group.id} className="tg-row" role="row">
                <div className={cx('tg-group', rowOn && 'is-on')} role="rowheader">
                  <div className="tg-group-pick" onMouseDown={(e) => onRowDown(e, r)} onMouseEnter={() => onCellEnter(r, 0)} title="Valitse ryhmän viikot — vedä valitaksesi monta ryhmää">
                    <span className="tg-group-when t-num">{row.group.day} {row.group.time}</span>
                    <span className="tg-group-name truncate">{row.group.name}</span>
                  </div>
                  <Link to={groupPath(row.group.id)} className="tg-group-open" aria-label={`Avaa ryhmä ${row.group.name}`} title="Avaa ryhmä"><Icon name="chevron-right" size={16} /></Link>
                </div>
                {row.cells.map((c, ci) => {
                  const on = picked.has(c.key);
                  const isActive = c.key === activeKey;
                  const isEditing = editing && editing.r === r && editing.c === ci;
                  const corner = rect && !editing && !fillPreview && r === rect.r1 && ci === rect.c1;
                  const filling = fillPreview && inRect(r, ci, fillPreview) && !inRect(r, ci, drag.current?.src);
                  const dropping = dropKey === c.key || (dropOnPicked && on);
                  return (
                    <div key={c.key} id={`tg-${c.key}`} role="gridcell" aria-selected={on}
                      className={cx('tg-cell', on && 'is-on', isActive && 'is-active', c.theme && 'has-theme', !c.sessions && 'is-off', filling && 'is-fill', dropping && 'is-drop')}
                      onMouseDown={(e) => onCellDown(e, r, ci)} onMouseEnter={() => onCellEnter(r, ci)}
                      onDoubleClick={() => { if (!touched()) startEdit({ r, c: ci }, undefined, { pick: true }); }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (dropKey !== c.key) setDropKey(c.key); }}
                      onDragLeave={() => setDropKey((k) => (k === c.key ? null : k))}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDropKey(null);
                        const theme = droppedTheme(e.dataTransfer);
                        if (!theme) return;
                        applyTheme(theme, on && picked.size > 1 ? pickedCells : [c]);
                      }}
                      title={c.theme ? `${c.theme.title}${c.theme.lead ? ` — ${c.theme.lead}` : ''}` : c.sessions ? 'Ei teemaa — kirjoita tai vedä teema tähän' : c.gap === 'break' ? 'Ei treeniä tällä viikolla' : 'Kalenteri ei jatku tähän asti'}>
                      {isEditing ? (
                        <input className="tg-input" autoFocus defaultValue={editing.initial} list="tg-library" maxLength={KOUTSI_THEME_TITLE_MAX}
                          aria-label={`Teema: ${row.group.name}, viikko ${c.week.week}`}
                          onFocus={(e) => { const v = e.currentTarget.value; e.currentTarget.setSelectionRange(v.length, v.length); }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') { e.preventDefault(); commitEdit(e.currentTarget.value, 'down'); }
                            else if (e.key === 'Tab') { e.preventDefault(); commitEdit(e.currentTarget.value, e.shiftKey ? 'left' : 'right'); }
                            else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                          }}
                          onBlur={(e) => commitEdit(e.currentTarget.value, null)} />
                      ) : c.theme
                        ? <span className="tg-theme"><span className="tg-theme-text">{c.theme.title}</span></span>
                        : c.sessions ? <span className="tg-empty">Ei teemaa</span>
                          : <span className="tg-gap">{c.gap === 'break' ? 'Tauko' : 'Ei kalenterissa'}</span>}
                      {corner && <span className="tg-handle" onMouseDown={startFill} title="Vedä oikealle tai alas: teemat kopioituvat" />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <datalist id="tg-library">{koutsiThemeLibrary(state.groups).map((t) => <option key={t.key} value={t.title} />)}</datalist>

      {touchDevice ? (
        <p className="tg-help"><strong>Vinkki:</strong> napauta ruutuja valitaksesi monta (viikon tai ryhmän nimi valitsee koko sarakkeen tai rivin), sitten Aseta teema. Vieritä taulukkoa sivuttain.</p>
      ) : (
        <p className="tg-help">
          <strong>Vinkit:</strong> vedä hiirellä valitaksesi monta (uusi veto lisää valintaan). Klikkaus valitsee tai poistaa yhden ruudun.
          Esc tyhjentää valinnan. Kirjoita suoraan (Enter tallentaa kaikkiin valittuihin). Vedä valinnan kulmasta kopioidaksesi.
          {' '}{MOD}+C / {MOD}+V kopioi ja liittää (myös Excelistä). Delete poistaa. {MOD}+Z kumoaa.
        </p>
      )}

      {pickedCells.length > 0 && (
        <div className="tg-bar" role="region" aria-label="Valitut ruudut">
          <span className="tg-bar-info">
            <span className="tg-bar-count"><strong>{plural(pickedCells.length, 'ruutu', 'ruutua')}</strong><span className="k-faint">, {summaryText(sum)}</span></span>
            {common && <span className="tg-bar-theme truncate"><Icon name="sparkles" size={14} />{common.title}</span>}
          </span>
          <span className="tg-bar-actions">
            {common && <Button variant="ghost" size="sm" className="tg-same" onClick={pickSame} title={`Valitse kaikki ruudut, joissa on ”${common.title}”`}>Valitse samat</Button>}
            <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>Tyhjennä valinta</Button>
            {withTheme.length > 0 && <Button variant="outline" size="sm" icon="trash" onClick={clearPicked}>Poista teema</Button>}
            <Button variant="lime" size="md" icon={common ? 'edit' : 'sparkles'} onClick={() => setSheetOpen(true)}>{common ? 'Muokkaa teemaa' : 'Aseta teema'}</Button>
          </span>
        </div>
      )}

      <ThemeWriteSheet open={sheetOpen} cells={pickedCells} onClose={() => setSheetOpen(false)}
        onApply={(changes, event) => write(changes, (n) => `Teema tallennettu ${plural(n, 'ruutuun', 'ruutuun')}.`, event)} />
    </div>
  );
}
