// TrialCodes — Ylläpito → Avaimet: the owner makes valmentaja-avaimet and e-mails them as they like.
// The default trial is 3 months; a key gives N free months from the day it is used (6 or 12, or any
// length) or free use, a surprise for the coach; it has a number of uses, an optional last day and
// can be revoked. A key says what it gives (Krossikoutsi6kk+, Krossikoutsi12kk+; Krossikoutsi123+ = the
// 3-month key), one per length: making it again adds uses. Case, spaces and "+" never matter. The coach types it on the sign-up page or in Profiili → Tilaus
// (supabase/migrations/20261030080055_koutsi_trial_codes.sql).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { Button, Card, EmptyState, ErrorState, Field, Input, Segmented, SkeletonList, useConfirm, useToast } from '../ui/index.js';
import { CopyButton } from '../shared/bits.jsx';
import { fmtDay } from '../domain/subscription.js';

const LENGTHS = [{ value: '6', label: '6 kk' }, { value: '12', label: '12 kk' }, { value: 'muu', label: 'Muu' }, { value: 'free', label: 'Maksuton' }];

/** The key "Luo avain" makes: Krossikoutsi12kk+ / Krossikoutsimaksuton+. */
function example(months) {
  return `Krossikoutsi${months == null ? 'maksuton' : `${months > 0 ? months : 'N'}kk`}+`;
}

/** "12 kk ilmaiseksi" / "Maksuton" */
function whatItGives(months) {
  return months == null ? 'Maksuton käyttö' : `${months} kk ilmaiseksi`;
}

function NewCode({ onMade }) {
  const toast = useToast();
  const [length, setLength] = useState('12');
  const [months, setMonths] = useState('3');
  const [uses, setUses] = useState('1');
  const [lastDay, setLastDay] = useState('');
  const [note, setNote] = useState('');
  const [own, setOwn] = useState('');
  const [busy, setBusy] = useState(false);
  const chosenMonths = length === 'free' ? null : length === 'muu' ? Number(months) : Number(length);
  const monthsOk = chosenMonths === null || (Number.isInteger(chosenMonths) && chosenMonths >= 1 && chosenMonths <= 36);
  const usesOk = Number.isInteger(Number(uses)) && Number(uses) >= 1 && Number(uses) <= 1000;
  const make = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const code = await api.admin.createTrialCode({
        months: chosenMonths, maxUses: Number(uses), note: note.trim(), code: own.trim() || null,
        expiresAt: lastDay ? new Date(`${lastDay}T23:59:59`).toISOString() : null,
      });
      toast(`Avain ${code} on valmis.`);
      setNote(''); setOwn('');
      onMade(code);
    } catch (err) { toast(err); } finally { setBusy(false); }
  };
  return (
    <Card className="stack-4">
      <Field label="Mitä avain antaa">
        <Segmented ariaLabel="Mitä avain antaa" value={length} onChange={setLength} options={LENGTHS} />
      </Field>
      {length === 'muu' && (
        <Field label="Kuukautta ilmaiseksi" htmlFor="code-months" error={!monthsOk ? '1–36 kuukautta.' : null}>
          <Input id="code-months" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} />
        </Field>
      )}
      <div className="row wrap">
        <Field label="Käyttökertoja" htmlFor="code-uses" hint="Jos avain on jo olemassa, nämä lisätään siihen." error={!usesOk ? '1–1000.' : null}>
          <Input id="code-uses" inputMode="numeric" value={uses} onChange={(e) => setUses(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} />
        </Field>
        <Field label="Viimeinen käyttöpäivä" optional htmlFor="code-last">
          <Input id="code-last" type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
        </Field>
      </div>
      <Field label="Muistiinpano" optional htmlFor="code-note" hint="Esimerkiksi kenelle annoit avaimen. Näkyy vain sinulle.">
        <Input id="code-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label="Oma avain" optional htmlFor="code-own" hint={`Jätä tyhjäksi, niin avain on ${example(chosenMonths)}. Kirjainkoolla ja plussalla ei ole väliä.`}>
        <Input id="code-own" value={own} maxLength={40} autoCapitalize="off" onChange={(e) => setOwn(e.target.value)} />
      </Field>
      <Button variant="dark" loading={busy} missing={!monthsOk ? 'Tarkista kuukaudet.' : !usesOk ? 'Tarkista käyttökerrat.' : null} onClick={make}>Luo avain</Button>
    </Card>
  );
}

export function TrialCodes() {
  const toast = useToast();
  const confirm = useConfirm();
  const [s, setS] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    setS((x) => ({ ...x, loading: true, error: null }));
    try { setS({ data: await api.admin.trialCodes(), error: null, loading: false }); } catch (error) { setS({ data: null, error, loading: false }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const revoke = async (c) => {
    if (!(await confirm({ title: `Poistetaanko avain ${c.shown} käytöstä?`, message: 'Jo alkaneet kokeilut jatkuvat, uusia ei voi enää aloittaa sillä.', confirmLabel: 'Poista käytöstä', danger: true }))) return;
    try { await api.admin.revokeTrialCode(c.code); load(); } catch (err) { toast(err); }
  };
  if (s.error?.code === 'not_deployed') return <EmptyState compact art="calendar" title="Valmentaja-avaimet" text={s.error.userMessage} />;
  return (
    <div className="stack-4">
      <NewCode onMade={load} />
      {s.loading && !s.data && <SkeletonList count={2} />}
      {s.error && <ErrorState error={s.error} onRetry={load} />}
      {s.data && !s.data.length && <EmptyState compact art="calendar" title="Ei vielä avaimia" />}
      {(s.data || []).map((c) => (
        <Card key={c.code} className="stack-2">
          <div className="row-between">
            <span className="k-row-title">{c.shown}</span>
            {c.revokedAt
              ? <span className="chip chip-sm chip-neutral">Poistettu käytöstä</span>
              : <CopyButton text={c.shown} />}
          </div>
          <div className="k-faint">
            {whatItGives(c.months)}, käytetty {c.useCount}/{c.maxUses}{c.expiresAt ? `, voimassa ${fmtDay(c.expiresAt)} asti` : ''}
          </div>
          {c.note && <p className="k-body-text">{c.note}</p>}
          {!c.revokedAt && <div><Button variant="ghost" size="sm" onClick={() => revoke(c)}>Poista käytöstä</Button></div>}
        </Card>
      ))}
    </div>
  );
}
