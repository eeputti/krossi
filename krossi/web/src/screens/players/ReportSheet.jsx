// ReportSheet — "Ilmoita pelaajasta": a reason chip + optional details -> api.social.report.
//   <ReportSheet open onClose={fn} player={Profile|PersonLite} />
import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';
import { useBusy } from '../../app/hooks.js';
import { firstName } from '../../lib/format.js';
import { Button, ChipSelect, Field, Sheet, Textarea, useToast } from '../../ui/index.js';

const REASONS = ['Asiaton käytös', 'Häirintä', 'Valeprofiili', 'Roskaposti', 'Muu syy'].map((r) => ({ value: r, label: r }));

export function ReportSheet({ open, onClose, player }) {
  const toast = useToast();
  const [busy, run] = useBusy();
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const first = firstName(player?.name);

  useEffect(() => { if (open) { setReason(''); setText(''); } }, [open]);

  const details = text.trim();
  const full = reason ? (details ? `${reason}: ${details}` : reason) : details;

  const submit = () => run(async () => {
    try {
      await api.social.report(player.id, full);
      toast('Ilmoitus lähetetty. Kiitos, että kerroit!', { icon: 'shield' });
      onClose?.();
    } catch (err) {
      toast(err);
    }
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="sm"
      title="Ilmoita pelaajasta"
      subtitle={`Ilmoitus menee Krossin ylläpidolle. ${first} ei saa siitä tietoa.`}
      footer={(
        <Button variant="dark" size="lg" block icon="flag" loading={busy} disabled={!full} onClick={submit}>
          Lähetä ilmoitus
        </Button>
      )}
    >
      <div className="players-report">
        <Field label="Mistä on kyse?">
          <ChipSelect options={REASONS} value={reason} onChange={setReason} allowEmpty size="sm" ariaLabel="Ilmoituksen syy" />
        </Field>
        <Field label="Mitä tapahtui?" optional={!!reason} htmlFor="players-report-text" hint="Kerro lyhyesti — ylläpito käsittelee ilmoituksen luottamuksellisesti.">
          <Textarea id="players-report-text" rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Esim. mitä viesteissä tai pelissä tapahtui" />
        </Field>
      </div>
    </Sheet>
  );
}
