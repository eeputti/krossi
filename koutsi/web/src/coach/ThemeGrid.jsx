// ThemeGrid — Suunnittele → Teemat: every group (rows) × the coming weeks (columns), one cell =
// one group's theme for one week. The coach picks cells — one by one, a whole week from its
// header, a whole group from its name — and writes one theme to all of them at once, or edits
// a theme across many weeks (pick its cells, "Muokkaa"). A cell with another theme is replaced
// only after the coach's OK, like in Viikon teemat.
import { useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, Field, Icon, IconButton, Input, Sheet, Textarea, useConfirm, useToast } from '../ui/index.js';
import {
  koutsiAddIsoWeeks, koutsiCompareIsoWeeks, koutsiCurrentIsoWeek, koutsiIsoWeekKey, koutsiIsoWeekRangeLabel,
  koutsiThemeKey, koutsiThemeLibrary, KOUTSI_THEME_LEAD_MAX, KOUTSI_THEME_TITLE_MAX,
} from '../domain/core.js';
import { plannerDefaultWeek } from '../domain/week.js';
import { commonTheme, gridWeeks, pickSummary, themeGrid, themeWritePlan, trainingCells, GRID_WEEKS } from '../domain/planning.js';
import { useSaveThemes } from './themeActions.js';
import { groupPath } from './nav.js';
import { Link } from '../app/router.js';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const summaryText = ({ groups, weeks }) => `${plural(groups, 'ryhmä', 'ryhmää')} · ${plural(weeks, 'viikko', 'viikkoa')}`;

/** Writes one theme to the picked cells (or edits the theme they share). */
function ThemeWriteSheet({ open, cells, onClose, onSaved }) {
  const { state } = useData();
  const confirm = useConfirm();
  const toast = useToast();
  const saveThemes = useSaveThemes();
  const common = useMemo(() => commonTheme(cells), [cells]);
  const [title, setTitle] = useState('');
  const [lead, setLead] = useState('');
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState(null);
  // fill the form once per opening: the shared theme to edit, or empty
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
    let { fresh, replace } = plan;
    if (plan.conflicts.length > 0) {
      const names = [...new Set(plan.conflicts.map((c) => c.theme.title))];
      const choice = await confirm({
        title: `${plural(plan.conflicts.length, 'ruudussa', 'ruudussa')} on jo toinen teema`,
        message: `${names.slice(0, 4).join(', ')}${names.length > 4 ? ` ja ${names.length - 4} muuta` : ''}. Korvataanko nekin teemalla ”${cleanTitle}”?`,
        confirmLabel: 'Korvaa nekin', secondaryLabel: 'Tallenna vain muihin', secondaryValue: 'skip', cancelLabel: 'Peruuta',
      });
      if (!choice) return;
      if (choice === 'skip') {
        const skip = new Set(plan.conflicts.map((c) => c.key));
        replace = replace.filter((r) => !skip.has(`${r.groupId}|${koutsiIsoWeekKey(r)}`));
      }
    }
    if (fresh.length + replace.length === 0) {
      toast('Valituissa ruuduissa on jo tämä teema.', { tone: 'info' });
      return;
    }
    setBusy(true);
    const written = await saveThemes({ fresh, replace });
    setBusy(false);
    if (written == null) return;
    track(common ? 'suunnittele.teema-muokattu' : 'suunnittele.teema-tallennettu');
    toast(written === 0 ? 'Ruuduissa oli jo teema, eikä sitä muutettu.' : `Teema ”${cleanTitle}” tallennettu ${plural(written, 'ruutuun', 'ruutuun')}.`, { tone: written === 0 ? 'info' : undefined });
    onSaved();
  };

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="md"
      title={common ? 'Muokkaa teemaa' : 'Aseta teema'}
      subtitle={`${summaryText(sum)} · ${plural(sum.cells, 'ruutu', 'ruutua')}`}
      footer={(
        <div className="sheet-actions">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button>
          <Button variant="dark" size="lg" loading={busy} disabled={!cleanTitle} onClick={save}>
            {cleanTitle ? `Tallenna ${plural(plan.fresh.length + plan.replace.length, 'ruutuun', 'ruutuun')}` : 'Kirjoita teema'}
          </Button>
        </div>
      )}>
      <div className="stack-4">
        <Field label="Teema" htmlFor="tg-title">
          <Input id="tg-title" size="lg" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={KOUTSI_THEME_TITLE_MAX}
            list="tg-library" placeholder="Esim. Syöttö / smash" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
          <datalist id="tg-library">{library.map((t) => <option key={t.key} value={t.title} />)}</datalist>
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
  const confirm = useConfirm();
  const now = koutsiCurrentIsoWeek();
  const first = plannerDefaultWeek();
  const [start, setStart] = useState(first);
  const [picked, setPicked] = useState(() => new Set());
  const [writing, setWriting] = useState(false);
  const weeks = useMemo(() => gridWeeks(start, GRID_WEEKS), [start]);
  const rows = useMemo(() => themeGrid(state.groups, state.trainings, weeks), [state.groups, state.trainings, weeks]);
  const allCells = useMemo(() => rows.flatMap((r) => r.cells), [rows]);
  const pickedCells = allCells.filter((c) => picked.has(c.key));
  const common = commonTheme(pickedCells);
  const withTheme = pickedCells.filter((c) => c.theme);
  const atStart = koutsiCompareIsoWeeks(start, first) <= 0;

  const toggleKeys = (keys) => setPicked((prev) => {
    const next = new Set(prev);
    const off = keys.length > 0 && keys.every((k) => prev.has(k));
    keys.forEach((k) => (off ? next.delete(k) : next.add(k)));
    return next;
  });
  const toggleCell = (c) => toggleKeys([c.key]);
  const toggleRow = (row) => toggleKeys(trainingCells(row.cells).map((c) => c.key));
  const toggleWeek = (i) => toggleKeys(rows.flatMap((r) => (r.cells[i].sessions ? [r.cells[i].key] : [])));
  const pickSame = () => {
    if (!common) return;
    setPicked(new Set(allCells.filter((c) => c.theme && koutsiThemeKey(c.theme.title) === common.key).map((c) => c.key)));
  };
  const move = (n) => setStart((s) => {
    const next = koutsiAddIsoWeeks(s, n);
    return koutsiCompareIsoWeeks(next, first) < 0 ? first : next;
  });

  const removeThemes = async () => {
    if (!withTheme.length) return;
    const ok = await confirm({
      title: `Poista teema ${plural(withTheme.length, 'ruudusta', 'ruudusta')}?`,
      message: `${[...new Set(withTheme.map((c) => c.theme.title))].slice(0, 4).join(', ')}. Muiden viikkojen teemat säilyvät.`,
      confirmLabel: 'Poista', danger: true,
    });
    if (!ok) return;
    const res = await run(() => api.themes.remove(withTheme.map((c) => c.theme.id)), `Teema poistettu ${plural(withTheme.length, 'ruudusta', 'ruudusta')}.`);
    if (res.ok) { track('suunnittele.teema-poistettu'); setPicked(new Set()); }
  };

  if (rows.length === 0) {
    return <p className="k-quiet">Luo ensin ryhmä Viikkohallinnassa — sen viikot tulevat tähän.</p>;
  }
  const sum = pickSummary(pickedCells);
  return (
    <div className="tg-wrap">
      <div className="tg-toolbar">
        <div className="tg-nav">
          <IconButton icon="chevron-left" label="Aiemmat viikot" variant="soft" onClick={() => move(-4)} disabled={atStart} />
          <div className="tg-range">
            <span className="tg-range-title">Viikot {weeks[0].week}–{weeks[weeks.length - 1].week}</span>
            <span className="tg-range-sub t-num">{koutsiIsoWeekRangeLabel(weeks[0].year, weeks[0].week).split('–')[0]}–{koutsiIsoWeekRangeLabel(weeks[weeks.length - 1].year, weeks[weeks.length - 1].week).split('–')[1]}</span>
          </div>
          <IconButton icon="chevron-right" label="Seuraavat viikot" variant="soft" onClick={() => move(4)} />
          {!atStart && <button type="button" className="wb-today-btn" onClick={() => setStart(first)}>Tämä viikko</button>}
        </div>
        <p className="tg-hint">Valitse ruudut: napauta ruutua, viikkoa tai ryhmän nimeä. Sitten kirjoitat teeman kerran.</p>
      </div>

      <div className="tg-scroll">
        <div className="tg" role="grid" aria-label="Teemat viikoittain" style={{ '--tg-weeks': weeks.length }}>
          <div className="tg-row tg-head" role="row">
            <div className="tg-corner" role="columnheader">Ryhmä</div>
            {weeks.map((week, i) => {
              const pool = rows.filter((r) => r.cells[i].sessions);
              const covered = pool.filter((r) => r.cells[i].theme).length;
              const keys = pool.map((r) => r.cells[i].key);
              const on = keys.length > 0 && keys.every((k) => picked.has(k));
              return (
                <button key={koutsiIsoWeekKey(week)} type="button" role="columnheader" aria-pressed={on}
                  className={cx('tg-week', on && 'is-on', koutsiCompareIsoWeeks(week, now) === 0 && 'is-now')}
                  onClick={() => toggleWeek(i)} title={`Valitse koko viikko ${week.week}`}>
                  <span className="tg-week-num">Vko {week.week}</span>
                  <span className="tg-week-dates t-num">{koutsiIsoWeekRangeLabel(week.year, week.week)}</span>
                  <span className={cx('tg-week-cov', pool.length > 0 && covered === pool.length && 'is-full')}>{pool.length ? `${covered}/${pool.length} teema` : 'ei treenejä'}</span>
                </button>
              );
            })}
          </div>
          {rows.map((row) => {
            const keys = trainingCells(row.cells).map((c) => c.key);
            const rowOn = keys.length > 0 && keys.every((k) => picked.has(k));
            return (
              <div key={row.group.id} className="tg-row" role="row">
                <div className={cx('tg-group', rowOn && 'is-on')} role="rowheader">
                  <button type="button" className="tg-group-pick" onClick={() => toggleRow(row)} aria-pressed={rowOn} title="Valitse ryhmän kaikki viikot">
                    <span className="tg-group-when t-num">{row.group.day} {row.group.time}</span>
                    <span className="tg-group-name truncate">{row.group.name}</span>
                  </button>
                  <Link to={groupPath(row.group.id)} className="tg-group-open" aria-label={`Avaa ryhmä ${row.group.name}`} title="Avaa ryhmä"><Icon name="chevron-right" size={16} /></Link>
                </div>
                {row.cells.map((c) => {
                  const on = picked.has(c.key);
                  return (
                    <button key={c.key} type="button" role="gridcell" aria-pressed={on}
                      className={cx('tg-cell', on && 'is-on', c.theme && 'has-theme', !c.sessions && 'is-off')}
                      onClick={() => toggleCell(c)}
                      title={c.theme ? `${c.theme.title}${c.theme.lead ? ` — ${c.theme.lead}` : ''}` : c.sessions ? 'Ei teemaa' : c.gap === 'break' ? 'Ei treeniä tällä viikolla' : 'Kalenteri ei jatku tähän asti'}>
                      {on && <span className="tg-check"><Icon name="check" size={12} strokeWidth={3} /></span>}
                      {c.theme
                        ? <span className="tg-theme">{c.theme.title}</span>
                        : c.sessions ? <span className="tg-empty">Ei teemaa</span>
                          : <span className="tg-gap">{c.gap === 'break' ? 'Tauko' : 'Ei kalenterissa'}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {pickedCells.length > 0 && (
        <div className="tg-bar" role="region" aria-label="Valitut ruudut">
          <span className="tg-bar-count"><strong>{plural(pickedCells.length, 'ruutu', 'ruutua')}</strong><span className="k-faint"> · {summaryText(sum)}</span></span>
          {common && <span className="tg-bar-theme truncate"><Icon name="sparkles" size={14} />{common.title}</span>}
          <span className="grow" />
          {common && <Button variant="ghost" size="sm" onClick={pickSame}>Valitse kaikki ”{common.title}”</Button>}
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>Tyhjennä</Button>
          {withTheme.length > 0 && <Button variant="outline" size="sm" icon="trash" onClick={removeThemes}>Poista teema</Button>}
          <Button variant="lime" size="md" icon={common ? 'edit' : 'sparkles'} onClick={() => setWriting(true)}>{common ? 'Muokkaa teemaa' : 'Aseta teema'}</Button>
        </div>
      )}

      <ThemeWriteSheet open={writing} cells={pickedCells} onClose={() => setWriting(false)} onSaved={() => { setWriting(false); setPicked(new Set()); }} />
    </div>
  );
}
