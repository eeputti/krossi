// ContinueThemesSheet — "Jatka edellisillä": the week's themes, each group carrying on with its own
// previous theme (from the last four weeks), shown before anything is saved. A theme can be changed
// for one group, and a group can be left out. Saving is insert-only, so a theme set elsewhere in the
// meantime is never replaced. Opened from Koti, Merkitse → Teema, Viikon teemat and the week recap.
import { useEffect, useMemo, useState } from 'react';
import { useData } from '../app/data.jsx';
import { Button, Icon, Input, Sheet, useToast } from '../ui/index.js';
import { koutsiThemeKey, koutsiWeekThemeStatus, KOUTSI_THEME_TITLE_MAX } from '../domain/core.js';
import { useSaveThemes } from './themeActions.js';
import { openPlanner } from './nav.js';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');

export function ContinueThemesSheet({ open, week, onClose }) {
  const { state } = useData();
  const toast = useToast();
  const saveThemes = useSaveThemes();
  const status = useMemo(() => (week ? koutsiWeekThemeStatus(state.groups, state.trainings, week) : null), [state.groups, state.trainings, week]);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  // fill once per opening: every group that can carry on, ticked, with its previous theme
  useEffect(() => {
    if (!open || !status) return;
    setRows(status.carry.map((x) => ({ group: x.group, from: x.from, on: true, title: x.from.title })));
  }, [open, week?.year, week?.week]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!week) return null;

  const withoutPrevious = status ? status.missing.length - status.carry.length : 0;
  const picked = rows.filter((r) => r.on && r.title.trim());
  const setRow = (i, patch) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    const fresh = picked.map((r) => {
      const title = r.title.trim().slice(0, KOUTSI_THEME_TITLE_MAX);
      // the previous lead goes along only with the previous theme
      const lead = koutsiThemeKey(title) === koutsiThemeKey(r.from.title) ? (r.from.lead || '') : '';
      return { groupId: r.group.id, year: week.year, week: week.week, title, lead };
    });
    const written = await saveThemes({ fresh });
    setBusy(false);
    if (written == null) return;
    track('teemat.jatka-tallennettu');
    if (picked.some((r) => r.title.trim() !== r.from.title)) track('teemat.jatka-muutettu');
    const kept = fresh.length - written;
    toast(written === 0
      ? 'Ryhmillä oli jo teema, eikä sitä muutettu.'
      : `${written === 1 ? 'Teema tallennettu 1 ryhmälle' : `Teemat tallennettu ${written} ryhmälle`} viikolle ${week.week}.${kept > 0 ? ` ${kept === 1 ? '1 ryhmällä' : `${kept} ryhmällä`} oli jo teema.` : ''}`);
    onClose();
  };

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="md" title={`Viikon teemat · vko ${week.week}`}
      subtitle="Jatka edellisillä: jokainen ryhmä saa oman edellisen teemansa. Voit muuttaa yksittäistä teemaa tai jättää ryhmän pois ennen tallennusta."
      footer={(
        <div className="sheet-actions">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button>
          <Button variant="dark" size="lg" loading={busy} disabled={!picked.length} onClick={save}>
            {picked.length ? `Tallenna ${picked.length === 1 ? '1 ryhmälle' : `${picked.length} ryhmälle`}` : 'Valitse ryhmät'}
          </Button>
        </div>
      )}>
      {rows.length === 0 ? (
        <p className="k-quiet">Jatkettavia teemoja ei ole: ryhmillä on jo teema tälle viikolle, tai niillä ei ole teemaa neljän edellisen viikon ajalta.</p>
      ) : (
        <div className="ct-list">
          {rows.map((r, i) => {
            const changed = r.title.trim() !== r.from.title;
            return (
              <div key={r.group.id} className={cx('ct-row', !r.on && 'is-off')}>
                <button type="button" className={cx('ct-check', r.on && 'is-on')} aria-pressed={r.on} aria-label={`${r.on ? 'Jätä pois' : 'Ota mukaan'}: ${r.group.name}`}
                  onClick={() => setRow(i, { on: !r.on })}>
                  {r.on && <Icon name="check" size={13} strokeWidth={3} />}
                </button>
                <div className="ct-main">
                  <div className="ct-group"><span className="ct-when t-num">{r.group.day} {r.group.time}</span>{r.group.name}</div>
                  <Input value={r.title} disabled={!r.on} maxLength={KOUTSI_THEME_TITLE_MAX} aria-label={`Teema: ${r.group.name}`}
                    onChange={(e) => setRow(i, { title: e.target.value })} />
                  <div className="ct-from">
                    {changed
                      ? <>Muutettu · edellinen vko {r.from.week}: {r.from.title} <button type="button" className="k-textlink" onClick={() => setRow(i, { title: r.from.title })}>Palauta</button></>
                      : `Edellinen teema, vko ${r.from.week}${r.from.lead ? ' · tarkennus tulee mukana' : ''}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {withoutPrevious > 0 && (
        <p className="ct-more">
          {withoutPrevious === 1 ? '1 ryhmällä' : `${withoutPrevious} ryhmällä`} ei ole edellistä teemaa.{' '}
          <button type="button" className="k-textlink" onClick={() => { onClose(); openPlanner({ week }); }}>Aseta Viikon teemoissa</button>
        </p>
      )}
    </Sheet>
  );
}
