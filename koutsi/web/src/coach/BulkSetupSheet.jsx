// BulkSetupSheet — "Lisää monta kerralla": new groups and a pasted list of players in one go.
// Everything new is stored by one atomic RPC (koutsi_bulk_setup_v2): either the whole reviewed
// setup lands or none of it. Names already on the roster are not created again — they are
// added to their group as the existing player (one real player must not become two rows).
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, Field, IconButton, Input, Select, Sheet, Textarea, useToast } from '../ui/index.js';
import { DayPicker, DurationStepper, TimeSelect } from '../shared/fields.jsx';
import { koutsiParseNameList, koutsiSortGroupsBySchedule } from '../domain/core.js';
import { exactNameMatch } from '../domain/roster.js';
import { useCoach } from './CoachRoot.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
let rowSeq = 0;
const newGroupRow = () => ({ key: `ng${rowSeq++}`, name: '', day: 'Ma', time: '', duration: 60, level: '' });

export function BulkSetupSheet({ open, onClose }) {
  const { state, reload } = useData();
  const { coachId } = useCoach();
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [newGroups, setNewGroups] = useState([newGroupRow()]);
  const [existing, setExisting] = useState([]);
  const [weeks, setWeeks] = useState(12);
  const [paste, setPaste] = useState('');
  const [assign, setAssign] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setStep(1); setNewGroups([newGroupRow()]); setExisting([]); setWeeks(12); setPaste(''); setAssign({}); setBusy(false);
  }, [open]);

  const validNew = newGroups.filter((g) => g.name.trim() && g.time);
  const targets = [
    ...validNew.map((g) => ({ ref: g.key, label: `${g.day} ${g.time} · ${g.name.trim()} (uusi)` })),
    ...koutsiSortGroupsBySchedule(state.groups).filter((g) => existing.includes(g.id)).map((g) => ({ ref: g.id, label: `${g.day} ${g.time} · ${g.name}`, existingId: g.id })),
  ];
  const names = useMemo(() => [...new Set(koutsiParseNameList(paste))], [paste]);
  const players = names.map((name) => ({ name, match: exactNameMatch(state.students, name), ref: assign[name] ?? targets[0]?.ref ?? '' }));
  const fresh = players.filter((p) => !p.match);
  const known = players.filter((p) => p.match && p.ref);
  const step1Ready = validNew.length > 0 || existing.length > 0 || true;

  const setRow = (key, patch) => setNewGroups((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const submit = async () => {
    if (busy) return;
    if (!validNew.length && !fresh.length && !known.length) { toast('Ei tallennettavaa — lisää ryhmä tai pelaajia.', { tone: 'info' }); return; }
    setBusy(true);
    try {
      const groupsPayload = [
        ...validNew.map((g) => ({ client_id: g.key, name: g.name.trim(), level: g.level.trim() || 'Kaikki tasot', day: g.day, time: g.time, duration_minutes: g.duration })),
        ...existing.map((id) => ({ client_id: id, existing_id: id })),
      ];
      const playersPayload = fresh.map((p) => ({ name: p.name, age: null, level: null, group_refs: p.ref ? [p.ref] : [] }));
      const result = await api.students.bulkSetup(coachId, { groups: groupsPayload, players: playersPayload, themes: [], weeksAhead: weeks });
      // committed: show it now, before the follow-up, so a failure below can't invite a duplicate retry
      await reload().catch(() => {});
      for (const p of known) {
        const groupId = result?.group_ids?.[p.ref] || (existing.includes(p.ref) ? p.ref : null);
        if (groupId) await api.groups.addMembers(groupId, [p.match.id]);
      }
      await reload().catch(() => {});
      toast(`${validNew.length ? `${validNew.length} ryhmää luotu. ` : ''}${fresh.length ? `${fresh.length} pelaajaa lisätty.` : ''}${known.length ? ` ${known.length} olemassa olevaa pelaajaa liitetty ryhmiin.` : ''}`.trim());
      onClose();
    } catch (err) {
      toast(err);
    } finally {
      setBusy(false);
    }
  };

  const footer = step === 1 ? (
    <div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose}>Peruuta</Button><Button variant="dark" size="lg" iconRight="arrow-right" disabled={!step1Ready} onClick={() => setStep(2)}>Pelaajat</Button></div>
  ) : (
    <div className="sheet-actions"><Button variant="soft" size="lg" icon="arrow-left" onClick={() => setStep(1)} disabled={busy}>Takaisin</Button><Button variant="lime" size="lg" loading={busy} onClick={submit}>Tallenna kaikki</Button></div>
  );
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Lisää monta kerralla" subtitle={step === 1 ? '1/2 · Ryhmät' : '2/2 · Pelaajat'} size="lg" dismissible={!busy} footer={footer}>
      {step === 1 ? (
        <div className="stack-5">
          <section className="stack-3">
            <div className="field-label">Uudet ryhmät</div>
            {newGroups.map((g, i) => (
              <div key={g.key} className="k-subcard stack-3">
                <div className="row-between">
                  <span className="k-subcard-title">Ryhmä {i + 1}</span>
                  {newGroups.length > 1 && <IconButton icon="close" label="Poista rivi" size="sm" onClick={() => setNewGroups((rows) => rows.filter((r) => r.key !== g.key))} />}
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
            <Button variant="outline" size="sm" icon="plus" onClick={() => setNewGroups((rows) => [...rows, newGroupRow()])}>Lisää ryhmä</Button>
          </section>
          {state.groups.length > 0 && (
            <section className="stack-2">
              <div className="field-label">Tai lisää pelaajia olemassa oleviin ryhmiin</div>
              <div className="k-pick-list">
                {koutsiSortGroupsBySchedule(state.groups).map((g) => (
                  <label key={g.id} className={cx('k-pick', existing.includes(g.id) && 'is-on')}>
                    <input type="checkbox" checked={existing.includes(g.id)} onChange={() => setExisting((p) => (p.includes(g.id) ? p.filter((x) => x !== g.id) : [...p, g.id]))} />
                    <span className="truncate">{g.day} {g.time} · {g.name}</span>
                  </label>
                ))}
              </div>
            </section>
          )}
          <Field label="Uusien ryhmien treenit kalenteriin">
            <div className="k-weeks-row">
              {[8, 12, 20, 30].map((w) => <button key={w} type="button" className={cx('planner-chip', weeks === w && 'is-on')} onClick={() => setWeeks(w)}>{w} vk</button>)}
            </div>
          </Field>
        </div>
      ) : (
        <div className="stack-5">
          <Field label="Pelaajat" hint="Liitä nimet, yksi per rivi — esim. suoraan Excelistä (ensimmäinen sarake). Älä kirjoita terveystietoja." htmlFor="bulk-names">
            <Textarea id="bulk-names" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Onni Virtanen\nAada Korhonen\n…'} />
          </Field>
          {players.length > 0 && (
            <div className="stack-2">
              <div className="field-label">{players.length} nimeä</div>
              {targets.length === 0 && <p className="k-warn-text">Valitse tai luo vähintään yksi ryhmä edellisessä vaiheessa, jos haluat liittää pelaajat ryhmiin.</p>}
              <div className="k-list">
                {players.map((p) => (
                  <div key={p.name} className="k-bulk-row">
                    <span className="grow">
                      <span className="k-row-title truncate">{p.name}</span>
                      {p.match && <span className="k-faint">On jo listallasi — liitetään ryhmään olemassa olevana</span>}
                    </span>
                    {targets.length > 0 && (
                      <Select aria-label={`Ryhmä: ${p.name}`} value={p.ref} placeholder="Ei ryhmää" options={targets.map((t) => ({ value: t.ref, label: t.label }))}
                        onChange={(e) => setAssign((a) => ({ ...a, [p.name]: e.target.value }))} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="field-msg">Tallennus: {validNew.length} uutta ryhmää, {fresh.length} uutta pelaajaa{known.length ? `, ${known.length} olemassa olevaa ryhmään` : ''}.</p>
        </div>
      )}
    </Sheet>
  );
}
