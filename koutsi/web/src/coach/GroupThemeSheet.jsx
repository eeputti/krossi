// GroupThemeSheet — one group's theme for one week, set or changed in place: from a session
// opened in the calendar, and from the group's page. The current theme is filled in, earlier
// themes are one tap away, and the week's planner is a link for setting many groups at once.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, Field, Input, Sheet, Textarea, useConfirm, useToast } from '../ui/index.js';
import { copyText } from '../ui/effects.js';
import {
  koutsiGroupThemeForWeek, koutsiThemeLibrary, koutsiThemeKey, koutsiThemeShareMessage,
  KOUTSI_THEME_TITLE_MAX, KOUTSI_THEME_LEAD_MAX,
} from '../domain/core.js';
import { themeWeekLabel } from '../domain/week.js';
import { openPlanner } from './nav.js';
import { useSaveThemes } from './themeActions.js';

/** open, group, week ({ year, week }), onClose() */
export function GroupThemeSheet({ open, group, week, onClose }) {
  const { state, run } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const saveThemes = useSaveThemes();
  const current = group && week ? koutsiGroupThemeForWeek(group, week) : null;
  const [title, setTitle] = useState('');
  const [lead, setLead] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle(current?.title || '');
    setLead(current?.lead || '');
  }, [open, group?.id, week?.year, week?.week]); // eslint-disable-line react-hooks/exhaustive-deps
  const library = useMemo(() => koutsiThemeLibrary(state.groups)
    .filter((t) => !current || koutsiThemeKey(t.title) !== koutsiThemeKey(current.title)), [state.groups, current]);
  if (!group || !week) return null;

  const cleanTitle = title.trim();
  const cleanLead = lead.trim();
  const unchanged = current && current.title === cleanTitle && (current.lead || '') === cleanLead;

  const save = async () => {
    if (!cleanTitle || busy) return;
    if (unchanged) { onClose(); return; }
    setBusy(true);
    const row = { groupId: group.id, year: week.year, week: week.week, title: cleanTitle, lead: cleanLead };
    const written = await saveThemes(current ? { replace: [row] } : { fresh: [row] });
    setBusy(false);
    if (written == null) return;
    if (written === 0) { toast('Ryhmällä oli jo teema tälle viikolle — avaa ikkuna uudelleen ja muuta sitä.', { tone: 'info' }); return; }
    onClose();
    toast(current ? 'Teema vaihdettu.' : 'Teema asetettu.', {
      action: { label: 'Kopioi viesti', onClick: () => copyText(koutsiThemeShareMessage({ title: cleanTitle, lead: cleanLead, week: week.week })) },
      duration: 6000,
    });
  };
  const remove = async () => {
    if (!current) return;
    const ok = await confirm({
      title: 'Poista teema tältä viikolta?',
      message: `"${current.title}" poistetaan ryhmältä ${group.name} viikolta ${week.week}. Muiden viikkojen teemat säilyvät.`,
      confirmLabel: 'Poista', danger: true,
    });
    if (!ok) return;
    const res = await run(() => api.themes.remove([current.id]), 'Teema poistettu tältä viikolta.');
    if (res.ok) onClose();
  };
  const toPlanner = () => { onClose(); openPlanner({ week }); };

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="md"
      title={current ? 'Vaihda teema' : 'Aseta teema'}
      subtitle={`${group.day} ${group.time} · ${group.name} · ${themeWeekLabel(week)}`}
      footer={(
        <div className="sheet-actions">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button>
          <Button variant="dark" size="lg" loading={busy} missing={!cleanTitle ? 'Kirjoita teema ensin.' : null} onClick={save}>{current ? 'Tallenna' : 'Aseta teema'}</Button>
        </div>
      )}>
      <div className="stack-4">
        <Field label="Teema" htmlFor="group-theme-title">
          <Input id="group-theme-title" size="lg" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={KOUTSI_THEME_TITLE_MAX}
            placeholder="Esim. Syöttö / smash" onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
        </Field>
        {library.length > 0 && (
          <div className="planner-recent">
            <div className="field-label">Aiemmat teemat</div>
            <div className="row wrap">
              {library.slice(0, 6).map((t) => (
                <button key={t.key} type="button" className="planner-chip" onClick={() => { setTitle(t.title); setLead(t.lead || ''); }}>
                  {t.title}<span className="planner-chip-sub">vko {t.week}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Tarkennus pelaajille" optional htmlFor="group-theme-lead" hint="Näkyy pelaajan sovelluksessa teeman alla.">
          <Textarea id="group-theme-lead" rows={2} value={lead} onChange={(e) => setLead(e.target.value)} maxLength={KOUTSI_THEME_LEAD_MAX}
            placeholder="Esim. Pallon heitto samaan kohtaan ja iskulyönti liikkeestä." />
        </Field>
        <div className="row wrap">
          <button type="button" className="k-textlink" onClick={toPlanner}>Usealle ryhmälle kerralla → Viikon teemat</button>
          {current && <button type="button" className="k-textlink k-danger-link" onClick={remove}>Poista teema tältä viikolta</button>}
        </div>
      </div>
    </Sheet>
  );
}
