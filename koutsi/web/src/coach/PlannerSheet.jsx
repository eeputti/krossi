// PlannerSheet — "Viikon teemat": one theme for many groups in three steps (theme → groups →
// done, where the coach sees every group it went to and who still lacks one — ThemeSaved), the
// week's existing themes as clusters, "Jatka edellisillä", earlier themes to reuse,
// and past weeks as a read-only archive. Ported from the old WeekThemePlanner rule by rule:
//   - nothing is preselected; which groups get a theme is always the coach's choice
//   - a group's existing different theme (or tarkennus) is replaced only after consent
//   - a group that looked empty is written insert-only
//   - past weeks are history: they can be reused this week, not edited
import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../app/data.jsx';
import { goBack } from '../app/router.js';
import { Button, Disclosure, Field, Icon, Input, Sheet, Textarea, useConfirm, useToast, confetti } from '../ui/index.js';
import { ThemeCard, WeekStepper, Quiet } from '../shared/bits.jsx';
import {
  koutsiCurrentIsoWeek, koutsiAddIsoWeeks, koutsiCompareIsoWeeks, koutsiWeekThemeStatus, koutsiThemeClusters,
  koutsiThemeLibrary, koutsiThemeHistory, koutsiThemeKey, koutsiGroupNameChips, koutsiIsoWeekKey,
  KOUTSI_THEME_TITLE_MAX, KOUTSI_THEME_LEAD_MAX,
} from '../domain/core.js';
import { DAY_NAMES, parseWeekParam, plannerDefaultWeek, themeWeekLabel } from '../domain/week.js';
import { api } from '../api/index.js';
import { useSaveThemes } from './themeActions.js';
import { useRecord } from './merkitse.jsx';
import { ThemeSaved } from './ThemeSaved.jsx';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');

function Steps({ step }) {
  const labels = ['Teema', 'Ryhmät', 'Valmis'];
  return (
    <ol className="planner-steps" aria-label="Vaiheet">
      {labels.map((label, i) => {
        const n = i + 1;
        return (
          <li key={label} className={cx('planner-step', step === n && 'is-on', step > n && 'is-done')}>
            <span className="planner-step-num">{step > n ? <Icon name="check" size={13} strokeWidth={3} /> : n}</span>
            <span className="planner-step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Chip({ active, onClick, children }) {
  return <button type="button" className={cx('planner-chip', active && 'is-on')} aria-pressed={active} onClick={onClick}>{children}</button>;
}

export function PlannerSheet({ query }) {
  const { state, run } = useData();
  const confirm = useConfirm();
  const toast = useToast();
  const saveThemes = useSaveThemes();
  const { openContinue } = useRecord();
  const groups = state.groups;
  const now = koutsiCurrentIsoWeek();
  const [open, setOpen] = useState(true);
  const [week, setWeek] = useState(() => parseWeekParam(query.vko) || plannerDefaultWeek());
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState('');
  const [lead, setLead] = useState('');
  const [editingKey, setEditingKey] = useState(null);
  // ?ryhma=<id>[,<id>…] opens with those groups picked (a group's page, "Aseta teema puuttuville")
  const pickedFromQuery = () => new Set(String(query.ryhma || '').split(',').filter((id) => groups.some((g) => g.id === id)));
  const [selected, setSelected] = useState(pickedFromQuery);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const bodyTop = useRef(null);
  // Opened again while already open (Jatka edellisillä → Valmis → Aseta teema puuttuville): start
  // over on the new week with the new groups picked.
  const queryKey = `${query.vko || ''}|${query.ryhma || ''}`;
  const lastQuery = useRef(queryKey);
  useEffect(() => {
    if (lastQuery.current === queryKey) return;
    lastQuery.current = queryKey;
    const w = parseWeekParam(query.vko);
    if (w) setWeek(w);
    setTitle(''); setLead(''); setEditingKey(null); setSaved(null);
    setSelected(pickedFromQuery());
    setStep(1);
  }, [queryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const isPast = koutsiCompareIsoWeeks(week, now) < 0;
  const status = koutsiWeekThemeStatus(groups, state.trainings, week);
  const { rows, pool, covered } = status;
  const withoutTheme = status.missing.map((g) => g.id);
  const clusters = koutsiThemeClusters(groups, week);
  const library = useMemo(() => koutsiThemeLibrary(groups).filter((t) => !clusters.some((c) => c.key === t.key)), [groups, clusters]);
  const history = useMemo(() => koutsiThemeHistory(groups, week), [groups, week]);
  const editingCluster = editingKey ? clusters.find((c) => c.key === editingKey) || null : null;
  const carry = isPast ? [] : status.carry;

  const presets = [
    { id: 'none-yet', label: `Ilman teemaa (${withoutTheme.length})`, ids: withoutTheme },
    { id: 'all', label: `Kaikki (${rows.length})`, ids: rows.map((r) => r.group.id) },
    ...koutsiGroupNameChips(groups).map((c) => ({ id: `word-${c.word}`, label: `${c.word} (${c.groupIds.length})`, ids: c.groupIds })),
    ...Object.keys(DAY_NAMES)
      .map((day) => ({ id: `day-${day}`, ids: rows.filter((r) => r.group.day === day).map((r) => r.group.id), day }))
      .filter((p) => p.ids.length > 0)
      .map((p) => ({ ...p, label: `${p.day} (${p.ids.length})` })),
  ].filter((p) => p.ids.length > 0);
  const allIn = (set, ids) => ids.length > 0 && ids.every((id) => set.has(id));
  const toggleChip = (ids) => setSelected((prev) => {
    const next = new Set(prev);
    const off = allIn(prev, ids);
    ids.forEach((id) => (off ? next.delete(id) : next.add(id)));
    return next;
  });
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const close = () => setOpen(false);
  const toTop = () => setTimeout(() => bodyTop.current?.scrollIntoView({ block: 'start' }), 0);
  const goStep = (n) => { setStep(n); toTop(); };
  const changeWeek = (w) => { setWeek(w); setSelected(new Set()); setEditingKey(null); setSaved(null); goStep(1); };
  const resetComposer = () => { setTitle(''); setLead(''); setEditingKey(null); setSelected(new Set()); };

  const editCluster = (c) => {
    setTitle(c.title); setLead(c.lead); setEditingKey(c.key);
    setSelected(new Set(c.groups.map((g) => g.id)));
    goStep(1);
  };
  const reuseThisWeek = (c) => {
    setWeek(now); setTitle(c.title); setLead(c.lead); setEditingKey(null); setSaved(null);
    setSelected(new Set(c.groups.map((g) => g.id)));
    goStep(1);
  };
  const removeCluster = async (c) => {
    const ok = await confirm({
      title: 'Poista teema tältä viikolta?',
      message: `"${c.title}" poistetaan ${c.groups.length === 1 ? '1 ryhmältä' : `${c.groups.length} ryhmältä`} viikolta ${week.week}. Muiden viikkojen teemat säilyvät.`,
      confirmLabel: 'Poista', danger: true,
    });
    if (!ok) return;
    const res = await run(() => api.themes.remove(c.themes.map((t) => t.id)), c.groups.length === 1 ? 'Teema poistettu viikolta.' : `Teema poistettu ${c.groups.length} ryhmältä.`);
    if (res.ok && editingKey === c.key) resetComposer();
  };
  const continueThemes = () => openContinue(week); // opens over the planner, each group's previous theme ready to edit
  // from Valmis: a new theme for the groups still without one, those groups already picked
  const themeForMissing = (ids) => { track('teemat.puuttuville'); setSaved(null); resetComposer(); setSelected(new Set(ids)); goStep(1); };

  const cleanTitle = title.trim();
  const cleanLead = lead.trim();
  const targets = rows.filter((r) => selected.has(r.group.id));
  const editingIds = new Set((editingCluster?.groups || []).map((g) => g.id));
  const canSave = !busy && !isPast && cleanTitle.length > 0 && targets.length > 0;

  const save = async () => {
    if (!canSave) return;
    const key = koutsiThemeKey(cleanTitle);
    const sameTitle = (r) => r.theme && koutsiThemeKey(r.theme.title) === key;
    // Left empty, the tarkennus isn't a change: a group with this title keeps its own.
    const keepsOwn = (r) => !editingIds.has(r.group.id) && sameTitle(r) && !cleanLead;
    const conflicts = targets.filter((r) => r.theme && !editingIds.has(r.group.id) && !keepsOwn(r)
      && (!sameTitle(r) || (r.theme.lead || '') !== cleanLead));
    let list = targets.filter((r) => !keepsOwn(r));
    if (conflicts.length > 0) {
      const names = conflicts.slice(0, 3).map((r) => `${r.group.day} ${r.group.time} ${r.group.name}: ${r.theme.title}${sameTitle(r) ? ' (eri tarkennus)' : ''}`);
      const choice = await confirm({
        title: `${conflicts.length === 1 ? '1 ryhmällä' : `${conflicts.length} ryhmällä`} on jo oma teema viikolla ${week.week}`,
        message: `${names.join(' · ')}${conflicts.length > 3 ? ` · ja ${conflicts.length - 3} muuta` : ''}`,
        confirmLabel: 'Korvaa nekin', secondaryLabel: 'Tallenna vain muille', secondaryValue: 'skip', cancelLabel: 'Peruuta',
      });
      if (!choice) return;
      if (choice === 'skip') list = list.filter((r) => !conflicts.includes(r));
    }
    const changes = list.filter((r) => !(r.theme && r.theme.title === cleanTitle && (r.theme.lead || '') === cleanLead));
    if (changes.length === 0) {
      toast(list.length === 0 && conflicts.length > 0 ? 'Kaikilla valituilla ryhmillä on jo oma teema, joten mitään ei tallennettu.' : 'Valituilla ryhmillä on jo tämä teema.', { tone: 'info' });
      return;
    }
    const toRow = (r) => ({ groupId: r.group.id, year: week.year, week: week.week, title: cleanTitle, lead: cleanLead });
    setBusy(true);
    const written = await saveThemes({ fresh: changes.filter((r) => !r.theme).map(toRow), replace: changes.filter((r) => r.theme).map(toRow) });
    setBusy(false);
    if (written == null) return;
    if (written === 0) { toast('Valituilla ryhmillä oli jo teema, eikä sitä muutettu.', { tone: 'info' }); return; }
    // Valmis lists every picked group: the ones that got it, what it replaced, and the ones left as they were
    const skipped = conflicts.filter((r) => !list.includes(r));
    setSaved({
      week,
      items: [...list, ...targets.filter((r) => keepsOwn(r))].map((r) => ({
        group: r.group, title: cleanTitle, lead: cleanLead,
        previous: r.theme && !sameTitle(r) ? r.theme.title : null,
        already: Boolean(r.theme) && sameTitle(r) && (keepsOwn(r) || (r.theme.lead || '') === cleanLead),
      })),
      skipped: skipped.map((r) => ({ group: r.group, theme: r.theme })),
    });
    track('teemat.tallennettu');
    resetComposer();
    goStep(3);
  };

  // when step 3 shows, full coverage earns a little celebration
  const fullNow = Boolean(saved) && withoutTheme.length === 0 && pool.length > 0;
  useEffect(() => {
    if (!fullNow) return undefined;
    const t = setTimeout(() => confetti({ count: 70 }), 160);
    return () => clearTimeout(t);
  }, [fullNow]);

  const byDay = [];
  rows.forEach((r) => {
    const day = DAY_NAMES[r.group.day] ? r.group.day : '';
    let bucket = byDay.find((b) => b.day === day);
    if (!bucket) { bucket = { day, rows: [] }; byDay.push(bucket); }
    bucket.rows.push(r);
  });

  const clusterCard = (c) => (
    <div key={c.key} className="planner-cluster">
      <div className="planner-cluster-title">{c.title}</div>
      {c.lead && <div className="planner-cluster-lead">{c.lead}</div>}
      <div className="planner-cluster-groups">{c.groups.length === 1 ? '1 ryhmä' : `${c.groups.length} ryhmää`}: {c.groups.map((g) => `${g.day} ${g.time}`).join(', ')}</div>
      <div className="row wrap">
        {isPast
          ? <Button variant="outline" size="sm" icon="repeat" onClick={() => reuseThisWeek(c)}>Käytä tällä viikolla</Button>
          : (
            <>
              <Button variant="outline" size="sm" icon="edit" onClick={() => editCluster(c)}>Muokkaa</Button>
              <Button variant="ghost" size="sm" icon="trash" onClick={() => removeCluster(c)}>Poista tältä viikolta</Button>
            </>
          )}
      </div>
    </div>
  );

  let footer = null;
  if (isPast) footer = <Button variant="dark" size="lg" block onClick={() => changeWeek(now)}>Takaisin tähän viikkoon</Button>;
  else if (step === 1) footer = (
    <div className="sheet-actions">
      <Button variant="soft" size="lg" onClick={close}>Sulje</Button>
      <Button variant="dark" size="lg" iconRight="arrow-right" missing={!cleanTitle ? 'Kirjoita teema ensin.' : null} onClick={() => goStep(2)}>Valitse ryhmät</Button>
    </div>
  );
  else if (step === 2) footer = (
    <div className="sheet-actions">
      <Button variant="soft" size="lg" icon="arrow-left" className="btn-square" aria-label="Takaisin" title="Takaisin" onClick={() => goStep(1)} />
      <Button variant="lime" size="lg" missing={!cleanTitle ? 'Kirjoita teema ensin.' : targets.length === 0 ? 'Valitse ainakin yksi ryhmä.' : null} disabled={isPast} loading={busy} onClick={save}>{targets.length === 0 ? 'Valitse ryhmät' : `Tallenna ${targets.length} ryhmälle`}</Button>
    </div>
  );
  else if (step === 3) footer = (
    <div className="sheet-actions">
      <Button variant="outline" size="lg" icon="plus" onClick={() => { setSaved(null); resetComposer(); goStep(1); }}>Uusi teema</Button>
      <Button variant="dark" size="lg" onClick={close}>Valmis</Button>
    </div>
  );

  return (
    <Sheet open={open} onClose={close} onClosed={() => goBack('/valmentaja/koti')} size="lg" title="Viikon teemat" footer={footer} dismissible={!busy} confirmClose={(step === 1 || step === 2) && Boolean(cleanTitle || cleanLead) && !saved}>
      <div ref={bodyTop} />
      <WeekStepper
        week={week}
        isCurrent={koutsiCompareIsoWeeks(week, now) === 0}
        onPrev={() => changeWeek(koutsiAddIsoWeeks(week, -1))}
        onNext={() => changeWeek(koutsiAddIsoWeeks(week, 1))}
        onToday={() => changeWeek(now)}
        sub={<span className={cx(covered === pool.length && pool.length > 0 && 'is-full')}>{covered}/{pool.length} ryhmällä on teema{pool.length < rows.length ? ` · ${rows.length - pool.length} ilman treeniä` : ''}</span>}
      />
      {!isPast && <Steps step={step} />}

      {isPast && (
        <div className="stack-3">
          <p className="k-note">Mennyt viikko. Teemat säilyvät ryhmien teemahistoriana, ja voit ottaa niitä uudelleen käyttöön tällä viikolla.</p>
          {clusters.length === 0 ? <Quiet>Viikolle {week.week} ei asetettu teemoja.</Quiet> : clusters.map(clusterCard)}
        </div>
      )}

      {!isPast && step === 1 && (
        <div className="stack-4">
          {carry.length > 0 && !editingCluster && (
            <div className="planner-carry">
              <span><strong>Pikavalinta:</strong> {carry.length === 1 ? '1 ryhmä voi jatkaa' : `${carry.length} ryhmää voi jatkaa`} omalla edellisellä teemallaan.</span>
              <Button variant="dark" size="sm" icon="repeat" onClick={continueThemes}>Jatka edellisillä</Button>
            </div>
          )}
          <Field label={editingCluster ? 'Muokkaa teemaa' : `Mitä viikolla ${week.week} harjoitellaan?`} htmlFor="planner-title">
            <Input id="planner-title" size="lg" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={KOUTSI_THEME_TITLE_MAX}
              list="planner-library" placeholder="Esim. Syöttö / smash" onKeyDown={(e) => { if (e.key === 'Enter' && cleanTitle) goStep(2); }} />
            <datalist id="planner-library">{library.map((t) => <option key={t.key} value={t.title} />)}</datalist>
          </Field>
          {!editingCluster && library.length > 0 && !cleanTitle && (
            <div className="planner-recent">
              <div className="field-label">Aiemmat teemat</div>
              <div className="row wrap">
                {library.slice(0, 6).map((t) => (
                  <button key={t.key} type="button" className="planner-chip" onClick={() => { setTitle(t.title); setLead(t.lead); }}>
                    {t.title}<span className="planner-chip-sub">vko {t.week}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <Field label="Tarkennus pelaajille" optional htmlFor="planner-lead" hint="Näkyy pelaajan sovelluksessa teeman alla.">
            <Textarea id="planner-lead" rows={2} value={lead} onChange={(e) => setLead(e.target.value)} maxLength={KOUTSI_THEME_LEAD_MAX} placeholder="Esim. Pallon heitto samaan kohtaan ja iskulyönti liikkeestä." />
          </Field>
          {cleanTitle && (
            <div>
              <div className="field-label">Näin pelaaja näkee teeman</div>
              <ThemeCard theme={{ title: cleanTitle, lead: cleanLead }} week={week} />
            </div>
          )}
          {editingCluster && (
            <div className="row wrap">
              {editingCluster.mixedLead && <span className="k-warn-text">Ryhmillä on eri tarkennukset — tallennus korvaa ne tällä.</span>}
              <button type="button" className="k-textlink" onClick={resetComposer}>Peruuta muokkaus</button>
            </div>
          )}
          {clusters.length > 0 && (
            <Disclosure title={koutsiCompareIsoWeeks(week, now) === 0 ? 'Tämän viikon teemat' : `Viikon ${week.week} teemat`} summary={`${clusters.length}`} icon="sparkles">
              <div className="stack-2">{clusters.map(clusterCard)}</div>
            </Disclosure>
          )}
          {!editingCluster && history.length > 0 && (
            <Disclosure title="Aiemmat viikot" summary={history.length === 1 ? "1 viikko" : `${history.length} viikkoa`} icon="clock">
              <div className="stack-3">
                {history.slice(0, 8).map((w) => (
                  <div key={koutsiIsoWeekKey(w)} className="planner-history-week">
                    <div className="planner-history-label">{themeWeekLabel(w, now)}</div>
                    {w.clusters.map((c) => (
                      <div key={c.key} className="planner-history-row">
                        <div className="grow">
                          <div className="planner-history-title">{c.title}</div>
                          <div className="planner-history-sub truncate">{c.groups.length === 1 ? '1 ryhmä' : `${c.groups.length} ryhmää`}{c.lead ? ` · ${c.lead}` : ''}</div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => { setTitle(c.title); setLead(c.lead); }}>Käytä</Button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Disclosure>
          )}
        </div>
      )}

      {!isPast && step === 2 && (
        <div className="stack-4">
          <div className="planner-picked">
            <span className="grow">Teema: <strong>{cleanTitle}</strong></span>
            <button type="button" className="k-textlink" onClick={() => goStep(1)}>Muuta</button>
          </div>
          <div>
            <div className="field-label">Monelle ryhmälle kerralla</div>
            <p className="field-msg">Napauta yhtä tai useampaa, esim. Ma ja Ti.</p>
            <div className="row wrap planner-chips">
              {presets.map((p) => <Chip key={p.id} active={allIn(selected, p.ids)} onClick={() => toggleChip(p.ids)}>{p.label}</Chip>)}
            </div>
          </div>
          <div>
            <div className="row-between">
              <div className="field-label">Tai vain tietyille ryhmille</div>
              {selected.size > 0 && <button type="button" className="k-textlink" onClick={() => setSelected(new Set())}>Tyhjennä</button>}
            </div>
            {byDay.map((bucket) => (
              <div key={bucket.day || 'muut'} className="planner-day">
                <div className="planner-day-label">{DAY_NAMES[bucket.day] || 'Muut'}</div>
                {bucket.rows.map((r) => {
                  const same = r.theme && koutsiThemeKey(r.theme.title) === koutsiThemeKey(cleanTitle);
                  return (
                    <label key={r.group.id} className={cx('planner-group', r.skips && 'is-off', selected.has(r.group.id) && 'is-on')}>
                      <input type="checkbox" checked={selected.has(r.group.id)} onChange={() => toggle(r.group.id)} />
                      <span className="grow">
                        <span className="planner-group-name">{r.group.time} · {r.group.name}{r.group.level ? <span className="k-faint"> · {r.group.level}</span> : null}<span className="k-faint"> · {r.group.memberIds.length} pel.</span></span>
                        <span className={cx('planner-group-theme', r.theme && (same ? 'is-same' : 'is-other'))}>
                          {r.theme ? `${same ? '✓ ' : 'Nyt: '}${r.theme.title}` : r.skips ? `Ei treeniä viikolla ${week.week}` : 'Ei teemaa'}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {!isPast && step === 3 && saved && (
        <ThemeSaved state={state} week={saved.week} items={saved.items} skipped={saved.skipped} onMissing={themeForMissing} />
      )}
    </Sheet>
  );
}
