// themeActions.js — theme writes shared by the planner and the Viikko card.
import { useCallback } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { useConfirm, useToast } from '../ui/index.js';

/**
 * Saves planner rows: `fresh` rows are insert-only (a group that looked empty may have got a
 * theme elsewhere meanwhile), `replace` rows were confirmed by the coach. Resolves to rows
 * written, or null on failure.
 */
export function useSaveThemes() {
  const { run } = useData();
  return useCallback(async ({ fresh = [], replace = [] }) => {
    let written = 0;
    const res = await run(async () => {
      if (fresh.length) written += await api.themes.save(fresh, { onlyNew: true });
      if (replace.length) written += await api.themes.save(replace);
    }, undefined, { waitForRefresh: true }); // the Valmis summary reads the saved themes from state
    return res.ok ? written : null;
  }, [run]);
}

/**
 * "Jatka edellisillä teemoilla": each group still without a theme gets its own latest one.
 * Insert-only, so a theme set elsewhere in the meantime is never replaced.
 */
export function useContinueThemes() {
  const confirm = useConfirm();
  const toast = useToast();
  const save = useSaveThemes();
  return useCallback(async (carry, week) => {
    if (!carry.length) return null;
    const titles = [...new Set(carry.map((x) => x.from.title))];
    const ok = await confirm({
      title: `Jatketaanko ${carry.length === 1 ? '1 ryhmän' : `${carry.length} ryhmän`} teemaa?`,
      message: `Ryhmät ilman teemaa viikolla ${week.week} saavat oman edellisen teemansa: ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? ` ja ${titles.length - 3} muuta` : ''}. Jo asetettuja teemoja ei muuteta.`,
      confirmLabel: 'Jatka teemoja',
    });
    if (!ok) return null;
    const written = await save({ fresh: carry.map((x) => ({ groupId: x.group.id, year: week.year, week: week.week, title: x.from.title, lead: x.from.lead })) });
    if (written == null) return null;
    if (written === 0) { toast('Ryhmillä oli jo teema, eikä sitä muutettu.', { tone: 'info' }); return 0; }
    const kept = carry.length - written;
    toast(`${written === 1 ? 'Teema jatkuu 1 ryhmällä' : `Teemat jatkuvat ${written} ryhmällä`}.${kept > 0 ? ` ${kept === 1 ? '1 ryhmällä' : `${kept} ryhmällä`} oli jo teema, jota ei muutettu.` : ''}`);
    return written;
  }, [confirm, toast, save]);
}
