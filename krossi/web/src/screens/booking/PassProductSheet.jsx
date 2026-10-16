// PassProductSheet — Hallin asetukset → one series card product (or a new one): name, sport, uses ×
// length, validity, price, description, and whether it is for sale. The name follows the content
// ('Tennis 10 × 1 h') until staff write their own. A product that has been ordered can only be
// hidden; changes apply to new purchases (an unpaid order is paid at the new price).
import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';
import { useBusy } from '../../app/hooks.js';
import { centsLabel, durationLabel } from '../../features/booking.js';
import { checkPassProduct, passProductName } from '../../features/seasons.js';
import { plural } from '../../lib/format.js';
import { Button, ChipSelect, Field, Input, Select, Sheet, Textarea, Toggle, useConfirm, useToast } from '../../ui/index.js';
import { DurationStepper } from './BookingParts.jsx';
import { InfoLine } from './SeasonParts.jsx';
import {
  PRODUCT_VALIDITY, USE_MINUTES, centsFromInput, centsToInput, intFromInput, validityOptions,
} from './hallSettingsForm.js';

function fromProduct(p, sport) {
  if (!p) {
    const fresh = { sport, uses: '10', minutesPerUse: 60, validDays: 365, price: '', description: '', active: true };
    return { ...fresh, name: passProductName({ sport, uses: 10, minutesPerUse: 60 }), autoName: true };
  }
  return {
    name: p.name, sport: p.sport, uses: String(p.uses), minutesPerUse: p.minutesPerUse, validDays: p.validDays,
    price: centsToInput(p.priceCents), description: p.description || '', active: p.active,
    autoName: p.name === passProductName(p),
  };
}

export function PassProductSheet({ open, onClose, venue, sports, product, onDone }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, run] = useBusy();
  const firstSport = sports?.[0]?.value || 'tennis';
  const [form, setForm] = useState(() => fromProduct(product, firstSport));
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(fromProduct(product, firstSport));
    setTried(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

  if (!venue) return <Sheet open={false} onClose={onClose} />;

  /** Content changes rename an automatically named card ('Tennis 10 × 1 h'). */
  const set = (patch) => setForm((f) => {
    const next = { ...f, ...patch };
    const uses = intFromInput(next.uses);
    if (next.autoName && !('name' in patch) && Number.isInteger(uses) && uses > 0) {
      next.name = passProductName({ sport: next.sport, uses, minutesPerUse: next.minutesPerUse });
    }
    return next;
  });

  const input = {
    name: form.name, sport: form.sport, uses: intFromInput(form.uses), minutesPerUse: form.minutesPerUse, validDays: form.validDays,
    priceCents: centsFromInput(form.price), description: form.description, active: form.active,
  };
  const check = checkPassProduct(input, { sports: (sports || []).map((s) => s.value).concat(product ? [product.sport] : []) });
  const error = (field) => (tried && check.field === field ? check.error : '');
  const hours = Number.isInteger(input.uses) && input.uses > 0 ? (input.uses * form.minutesPerUse) / 60 : 0;
  const unit = hours > 0 && Number.isInteger(input.priceCents) ? `${centsLabel(Math.round(input.priceCents / hours))}/h` : null;

  const save = () => {
    setTried(true);
    if (check.error) return;
    run(async () => {
      try {
        const saved = await api.wallet.saveProduct({ ...check.value, id: product?.id || null, venueId: venue.id });
        onDone?.(product ? `Sarjakortti tallennettu: ${saved.name}.` : `Sarjakortti lisätty: ${saved.name}${saved.active ? '' : ' (piilotettu)'}.`);
      } catch (err) {
        toast(err);
      }
    });
  };

  const remove = async () => {
    const ok = await confirm({ title: 'Poistetaanko sarjakortti?', message: `${product.name} poistetaan. Sitä ei ole vielä tilattu.`, confirmLabel: 'Poista', danger: true });
    if (!ok) return;
    await run(async () => {
      try {
        await api.wallet.removeProduct(product.id);
        onDone?.(`Sarjakortti poistettu: ${product.name}.`);
      } catch (err) {
        toast(err);
      }
    });
  };

  const footer = (
    <div className="stack-2">
      <Button variant="lime" size="lg" block icon="check" loading={busy} onClick={save}>{product ? 'Tallenna muutokset' : 'Lisää sarjakortti'}</Button>
      {product?.removable && <Button variant="ghost" block icon="trash" disabled={busy} onClick={remove}>Poista sarjakortti</Button>}
    </div>
  );

  return (
    <Sheet
      open={open}
      onClose={busy ? undefined : onClose}
      title={product ? product.name : 'Uusi sarjakortti'}
      subtitle={product ? `${plural(product.sold, 'myyty kortti', 'myytyä korttia')}` : venue.name}
      footer={footer}
      size="md"
      className="bk-sheet"
    >
      <div className="stack-4">
        {product && product.sold > 0 && (
          <InfoLine icon="info">Muutokset koskevat uusia ostoja. Jo ostetut kortit pysyvät ennallaan: saldo, voimassaolo ja hinta.</InfoLine>
        )}
        {(sports || []).length > 1 && (
          <div className="bk-field">
            <span className="eyebrow">Laji</span>
            <ChipSelect ariaLabel="Laji" size="sm" options={sports} value={form.sport} onChange={(v) => v && set({ sport: v })} />
          </div>
        )}
        <div className="ss-time-row">
          <label className="bk-field" htmlFor="hset-pass-uses">
            <span className="eyebrow">Kertoja</span>
            <Input id="hset-pass-uses" inputMode="numeric" value={form.uses} onChange={(e) => set({ uses: e.target.value })} />
          </label>
          <div className="bk-field">
            <span className="eyebrow">Kerran pituus</span>
            <DurationStepper value={form.minutesPerUse} options={USE_MINUTES.includes(form.minutesPerUse) ? USE_MINUTES : [...USE_MINUTES, form.minutesPerUse]}
              onChange={(m) => set({ minutesPerUse: m })} />
          </div>
        </div>
        {(error('uses') || error('minutesPerUse')) && (
          <div className="field-msg field-msg-error" role="alert">{error('uses') || error('minutesPerUse')}</div>
        )}
        <Field label="Nimi" htmlFor="hset-pass-name" error={error('name')} hint="Näkyy kaupassa ja pelaajan kortilla.">
          <Input id="hset-pass-name" value={form.name} maxLength={80} onChange={(e) => set({ name: e.target.value, autoName: false })} />
        </Field>
        <div className="ss-two">
          <Field label="Hinta (€)" htmlFor="hset-pass-price" error={error('priceCents')}
            hint={unit && hours ? `${durationLabel(hours * 60)} pelaamista · ${unit}` : null}>
            <Input id="hset-pass-price" inputMode="decimal" value={form.price} placeholder="esim. 260" onChange={(e) => set({ price: e.target.value })} />
          </Field>
          <Field label="Voimassa ostosta" htmlFor="hset-pass-valid" error={error('validDays')}>
            <Select id="hset-pass-valid" options={validityOptions(PRODUCT_VALIDITY, form.validDays)} value={String(form.validDays)}
              onChange={(e) => set({ validDays: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="Kuvaus" optional htmlFor="hset-pass-description" error={error('description')}>
          <Textarea id="hset-pass-description" rows={2} maxLength={300} value={form.description}
            placeholder="esim. Käy kaikkiin tennisvuoroihin, myös iltoihin ja viikonloppuun." onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <Toggle
          label="Myynnissä"
          hint={form.active ? 'Pelaajat voivat ostaa kortin sovelluksesta.' : 'Piilotettu: ei näy kaupassa. Jo ostetut kortit toimivat normaalisti.'}
          checked={form.active}
          onChange={(v) => set({ active: v })}
        />
        {product && !product.removable && (
          <p className="bk-fine">Korttia on jo tilattu, joten sitä ei voi poistaa. Piilota se, jos et halua myydä sitä enää.</p>
        )}
      </div>
    </Sheet>
  );
}
