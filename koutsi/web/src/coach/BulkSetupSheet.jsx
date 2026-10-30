// BulkSetupSheet — "Lisää monta kerralla", in the order a coach sets up a season:
//   1. Ryhmät   — the new groups and how many weeks of sessions go to the calendar
//   2. Pelaajat — a pasted list of names for each new group (one per line, e.g. from Excel)
//   3. Teemat   — optional: each group's theme for its first week ("Sama kaikille" fills the empty ones)
//   4. Valmis   — what will be saved, then saved; afterwards the players' invites are one tap away
// Everything is stored by one atomic RPC (koutsi_bulk_setup_v2): either the whole setup lands or
// none of it. A name already on the roster is not created again — that player is added to the
// group (one real player must not become two rows); the same new name in two groups is one player.
// Adding players to groups that already exist is the group page's job (Lisää pelaajia).
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Button, Field, Icon, IconButton, Input, Sheet, Textarea, useToast } from '../ui/index.js';
import { DayPicker, DurationStepper, TimeSelect } from '../shared/fields.jsx';
import { koutsiAddDays, koutsiIsoWeekOfDateStr, koutsiParseNameList, koutsiTodayStr, KOUTSI_THEME_TITLE_MAX } from '../domain/core.js';
import { exactNameMatch } from '../domain/roster.js';
import { useCoach } from './CoachRoot.jsx';
import { WeeksChips, useDefaultWeeks } from './groupForms.jsx';
import { openInvites } from './nav.js';

let rowSeq = 0;
const newGroupRow = () => ({ key: `ng${rowSeq++}`, name: '', day: 'Ma', time: '', duration: 60, level: '', names: '', theme: '' });
const STEPS = ['Ryhmät', 'Pelaajat', 'Teemat', 'Valmis'];
const JS_DAY = { Su: 0, Ma: 1, Ti: 2, Ke: 3, To: 4, Pe: 5, La: 6 };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The ISO week of a new group's first session (the calendar starts today). */
function firstWeek(day) {
  const today = koutsiTodayStr();
  const dow = new Date(`${today}T12:00:00`).getDay();
  const delta = ((JS_DAY[day] ?? dow) - dow + 7) % 7;
  return koutsiIsoWeekOfDateStr(koutsiAddDays(today, delta));
}

export function BulkSetupSheet({ open, onClose }) {
  const { state, reload } = useData();
  const { coachId } = useCoach();
  const toast = useToast();
  const seasonWeeks = useDefaultWeeks();
  const [step, setStep] = useState(1);
  const [rows, setRows] = useState([newGroupRow()]);
  const [weeks, setWeeks] = useState(12);
  const [sameTheme, setSameTheme] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // { groups, players, themes } once saved
  useEffect(() => {
    if (!open) return;
    setStep(1); setRows([newGroupRow()]); setWeeks(seasonWeeks.initial); setSameTheme(''); setBusy(false); setDone(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = rows.filter((g) => g.name.trim() && g.time);
  const setRow = (key, patch) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // every name once: in which new groups, and whether it is already on the roster
  const people = useMemo(() => {
    const byName = new Map();
    groups.forEach((g) => [...new Set(koutsiParseNameList(g.names))].forEach((name) => {
      const k = name.toLocaleLowerCase('fi');
      if (!byName.has(k)) byName.set(k, { name, refs: [], match: exactNameMatch(state.students, name) });
      byName.get(k).refs.push(g.key);
    }));
    return [...byName.values()];
  }, [groups, state.students]); // eslint-disable-line react-hooks/exhaustive-deps
  const fresh = people.filter((p) => !p.match);
  const known = people.filter((p) => p.match);
  const themed = groups.filter((g) => g.theme.trim());

  const fillSame = () => {
    const t = sameTheme.trim();
    if (!t) return;
    setRows((list) => list.map((r) => (r.theme.trim() ? r : { ...r, theme: t })));
  };

  const submit = async () => {
    if (busy || !groups.length) return;
    setBusy(true);
    try {
      const groupsPayload = groups.map((g) => ({ client_id: g.key, name: g.name.trim(), level: g.level.trim() || 'Kaikki tasot', day: g.day, time: g.time, duration_minutes: g.duration }));
      const playersPayload = fresh.map((p) => ({ name: p.name, age: null, level: null, group_refs: p.refs }));
      const themesPayload = themed.map((g) => {
        const w = firstWeek(g.day);
        return { group_ref: g.key, year: w.year, week: w.week, title: g.theme.trim().slice(0, KOUTSI_THEME_TITLE_MAX), lead: '' };
      });
      const result = await api.students.bulkSetup(coachId, { groups: groupsPayload, players: playersPayload, themes: themesPayload, weeksAhead: weeks });
      // committed: show it now, before the follow-up, so a failure below can't invite a duplicate retry
      await reload().catch(() => {});
      for (const p of known) {
        for (const ref of p.refs) {
          const groupId = result?.group_ids?.[ref];
          if (groupId) await api.groups.addMembers(groupId, [p.match.id]);
        }
      }
      await reload().catch(() => {});
      setDone({ groups: groups.length, players: people.length, themes: themed.length });
      toast(`${plural(groups.length, 'ryhmä', 'ryhmää')} luotu${people.length ? `, ${plural(people.length, 'pelaaja', 'pelaajaa')}` : ''}${themed.length ? `, ${plural(themed.length, 'teema', 'teemaa')}` : ''}.`);
    } catch (err) {
      toast(err);
    } finally {
      setBusy(false);
    }
  };

  const next = (n) => setStep(n);
  let footer;
  if (done) {
    footer = (
      <div className="sheet-actions">
        <Button variant="soft" size="lg" onClick={onClose}>Sulje</Button>
        <Button variant="lime" size="lg" icon="send" onClick={() => { onClose(); openInvites(); }}>Lähetä kutsut</Button>
      </div>
    );
  } else if (step === 1) {
    footer = (
      <div className="sheet-actions">
        <Button variant="soft" size="lg" onClick={onClose}>Peruuta</Button>
        <Button variant="dark" size="lg" iconRight="arrow-right" missing={!groups.length ? 'Anna ainakin yhdelle ryhmälle nimi ja aika.' : null} onClick={() => next(2)}>Pelaajat</Button>
      </div>
    );
  } else {
    const label = step === 2 ? 'Teemat' : step === 3 ? (themed.length ? 'Tarkista' : 'Ohita teemat') : 'Tallenna kaikki';
    footer = (
      <div className="sheet-actions">
        <Button variant="soft" size="lg" icon="arrow-left" className="btn-square" aria-label="Takaisin" title="Takaisin" onClick={() => next(step - 1)} disabled={busy} />
        {step < 4
          ? <Button variant="dark" size="lg" iconRight="arrow-right" onClick={() => next(step + 1)}>{label}</Button>
          : <Button variant="lime" size="lg" loading={busy} onClick={submit}>{label}</Button>}
      </div>
    );
  }

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Lisää monta kerralla" subtitle={`Vaihe ${done ? 4 : step}/4: ${STEPS[(done ? 4 : step) - 1]}`} size="lg" dismissible={!busy} confirmClose={!done && rows.some((g) => g.name.trim() || g.level.trim() || g.time || g.names.trim() || g.theme.trim()) ? { title: 'Hylätäänkö täytetyt ryhmät?', message: 'Mitään ei ole vielä tallennettu.' } : false} footer={footer}>
      <ol className="bs-steps" aria-label="Vaiheet">
        {STEPS.map((label, i) => (
          <li key={label} className={`bs-step${(done ? 4 : step) === i + 1 ? ' is-on' : ''}${(done ? 5 : step) > i + 1 ? ' is-done' : ''}`}>
            <span className="bs-step-num">{(done ? 5 : step) > i + 1 ? <Icon name="check" size={12} strokeWidth={3} /> : i + 1}</span>{label}
          </li>
        ))}
      </ol>

      {done ? (
        <div className="bs-done stack-3">
          <span className="bs-done-check"><Icon name="check" size={26} strokeWidth={3} /></span>
          <h3 className="t-h2">Valmis</h3>
          <p className="k-quiet-text">{[plural(done.groups, 'ryhmä', 'ryhmää'), plural(done.players, 'pelaaja', 'pelaajaa'), done.themes ? plural(done.themes, 'teema', 'teemaa') : null].filter(Boolean).join(', ')}. Treenit ovat kalenterissa {weeks} viikon ajan.</p>
          <p className="field-msg">Pelaajat liittyvät omalla linkillään. Lähetä kutsut nyt, tai myöhemmin Pelaajat-sivulta.</p>
          <Button variant="outline" size="sm" icon="calendar" onClick={() => { onClose(); navigate('/valmentaja/ryhmat'); }}>Avaa Viikkohallinta</Button>
        </div>
      ) : step === 1 ? (
        <div className="stack-5">
          <section className="stack-3">
            {rows.map((g, i) => (
              <div key={g.key} className="k-subcard stack-3">
                <div className="row-between">
                  <span className="k-subcard-title">Ryhmä {i + 1}</span>
                  {rows.length > 1 && <IconButton icon="close" label="Poista ryhmä" size="sm" onClick={() => setRows((list) => list.filter((r) => r.key !== g.key))} />}
                </div>
                <div className="k-two">
                  <Input value={g.name} onChange={(e) => setRow(g.key, { name: e.target.value })} placeholder="Nimi, esim. tiistai aikuiset" maxLength={120} aria-label="Ryhmän nimi" />
                  <Input value={g.level} onChange={(e) => setRow(g.key, { level: e.target.value })} placeholder="Taso (valinn.)" maxLength={80} aria-label="Taso" />
                </div>
                <DayPicker value={g.day} onChange={(day) => setRow(g.key, { day })} />
                <div className="k-two">
                  <TimeSelect value={g.time} onChange={(time) => setRow(g.key, { time })} />
                  <DurationStepper value={g.duration} onChange={(duration) => setRow(g.key, { duration })} />
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" icon="plus" onClick={() => setRows((list) => [...list, newGroupRow()])}>Lisää ryhmä</Button>
          </section>
          <Field label="Treenit kalenteriin">
            <WeeksChips value={weeks} onChange={setWeeks} left={seasonWeeks.left} />
          </Field>
        </div>
      ) : step === 2 ? (
        <div className="stack-4">
          <p className="field-msg">Liitä kunkin ryhmän pelaajat, yksi nimi per rivi (esim. suoraan Excelistä). Voit jättää ryhmän myös tyhjäksi. Älä kirjoita terveystietoja.</p>
          {groups.map((g) => {
            const list = [...new Set(koutsiParseNameList(g.names))];
            const onRoster = list.filter((n) => exactNameMatch(state.students, n)).length;
            return (
              <div key={g.key} className="k-subcard stack-2">
                <label className="k-subcard-title" htmlFor={`bs-names-${g.key}`}>{g.day} {g.time}, {g.name.trim()}</label>
                <Textarea id={`bs-names-${g.key}`} rows={4} value={g.names} onChange={(e) => setRow(g.key, { names: e.target.value })} placeholder={'Onni Virtanen\nAada Korhonen\n…'} />
                {list.length > 0 && <span className="k-faint">{plural(list.length, 'nimi', 'nimeä')}{onRoster ? `, ${onRoster} on jo listallasi — liitetään ryhmään` : ''}</span>}
              </div>
            );
          })}
        </div>
      ) : step === 3 ? (
        <div className="stack-4">
          <p className="field-msg">Vapaaehtoinen: ryhmän ensimmäisen viikon teema näkyy pelaajille heti. Voit asettaa teemat myöhemminkin.</p>
          <div className="bs-same">
            <Input value={sameTheme} onChange={(e) => setSameTheme(e.target.value)} maxLength={KOUTSI_THEME_TITLE_MAX} placeholder="Sama teema kaikille" aria-label="Sama teema kaikille" />
            <Button variant="outline" size="md" disabled={!sameTheme.trim()} onClick={fillSame}>Täytä tyhjät</Button>
          </div>
          {groups.map((g) => (
            <Field key={g.key} label={`${g.day} ${g.time}, ${g.name.trim()} — vko ${firstWeek(g.day).week}`} htmlFor={`bs-theme-${g.key}`}>
              <Input id={`bs-theme-${g.key}`} value={g.theme} onChange={(e) => setRow(g.key, { theme: e.target.value })} maxLength={KOUTSI_THEME_TITLE_MAX} placeholder="Ei teemaa" />
            </Field>
          ))}
        </div>
      ) : (
        <div className="stack-3">
          <div className="field-label">Tallennetaan</div>
          <div className="k-list">
            {groups.map((g) => {
              const n = people.filter((p) => p.refs.includes(g.key)).length;
              return (
                <div key={g.key} className="bs-review-row">
                  <span className="t-num bs-review-when">{g.day} {g.time}</span>
                  <span className="grow"><strong>{g.name.trim()}</strong><span className="k-faint">{`, ${plural(n, 'pelaaja', 'pelaajaa')}${g.theme.trim() ? `, ${g.theme.trim()}` : ''}`}</span></span>
                </div>
              );
            })}
          </div>
          <p className="field-msg">
            {plural(groups.length, 'uusi ryhmä', 'uutta ryhmää')}, {plural(fresh.length, 'uusi pelaaja', 'uutta pelaajaa')}
            {known.length ? `, ${known.length} jo listallasi olevaa liitetään` : ''}, treenit {weeks} viikoksi{themed.length ? `, ${plural(themed.length, 'teema', 'teemaa')}` : ''}.
          </p>
        </div>
      )}
    </Sheet>
  );
}
