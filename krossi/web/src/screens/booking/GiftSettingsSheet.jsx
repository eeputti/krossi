// GiftSettingsSheet — Hallin asetukset → lahjakortit: the ready amounts the shop offers (1–6, tap
// one to take it off), the range for an amount of the buyer's own, and how long a card is valid.
// Whole euros, like the purchase itself. Cards already sold keep their value and validity.
import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';
import { useBusy } from '../../app/hooks.js';
import { centsLabel } from '../../features/booking.js';
import { GIFT_LIMITS, checkGiftSettings } from '../../features/seasons.js';
import { Button, Field, Icon, Input, Select, Sheet, useToast } from '../../ui/index.js';
import { GIFT_VALIDITY, centsFromInput, centsToInput, validityOptions } from './hallSettingsForm.js';

const fromGift = (g) => ({
  amounts: [...(g?.amounts || [])], min: centsToInput(g?.minCents ?? 1000), max: centsToInput(g?.maxCents ?? 30000), validDays: g?.validDays ?? 365,
});

export function GiftSettingsSheet({ open, onClose, venue, gift, onDone }) {
  const toast = useToast();
  const [busy, run] = useBusy();
  const [form, setForm] = useState(() => fromGift(gift));
  const [newAmount, setNewAmount] = useState('');
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(fromGift(gift));
    setNewAmount('');
    setTried(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!venue) return <Sheet open={false} onClose={onClose} />;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const input = { amounts: form.amounts, minCents: centsFromInput(form.min), maxCents: centsFromInput(form.max), validDays: form.validDays };
  const check = checkGiftSettings(input);
  const error = (field) => (tried && check.field === field ? check.error : '');
  const typed = centsFromInput(newAmount);
  const full = form.amounts.length >= GIFT_LIMITS.maxAmounts;

  const addAmount = () => {
    if (!Number.isInteger(typed) || typed <= 0 || full) return;
    set({ amounts: [...new Set([...form.amounts, typed])].sort((a, b) => a - b) });
    setNewAmount('');
  };

  const save = () => {
    setTried(true);
    if (check.error) return;
    run(async () => {
      try {
        await api.wallet.saveGiftSettings(venue.id, check.value);
        onDone?.('Lahjakorttien asetukset tallennettu.');
      } catch (err) {
        toast(err);
      }
    });
  };

  return (
    <Sheet
      open={open}
      onClose={busy ? undefined : onClose}
      title="Lahjakortit"
      subtitle={venue.name}
      footer={<Button variant="lime" size="lg" block icon="check" loading={busy} onClick={save}>Tallenna</Button>}
      size="md"
      className="bk-sheet"
    >
      <div className="stack-4">
        <div className="hset-days-box">
          <div className="hset-days-head">
            <span className="eyebrow">Valmiit summat</span>
            <span className="hset-days-count t-num">{form.amounts.length}/{GIFT_LIMITS.maxAmounts}</span>
          </div>
          {form.amounts.length === 0 ? <p className="ss-empty">Ei valmiita summia.</p> : (
            <ul className="hset-days" aria-label="Valmiit summat">
              {form.amounts.map((a) => (
                <li key={a}>
                  <button type="button" className="hset-day" onClick={() => set({ amounts: form.amounts.filter((x) => x !== a) })} aria-label={`Poista ${centsLabel(a)}`}>
                    <span className="t-num">{centsLabel(a)}</span>
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error('amounts') && <p className="field-msg field-msg-error" role="alert">{error('amounts')}</p>}
          <div className="hset-day-add">
            <Input inputMode="numeric" aria-label="Uusi summa euroina" placeholder="Summa €" value={newAmount} disabled={full}
              onChange={(e) => setNewAmount(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addAmount(); }} />
            <Button variant="outline" size="sm" icon="plus" disabled={full || !Number.isInteger(typed) || typed <= 0} onClick={addAmount}>Lisää summa</Button>
          </div>
        </div>
        <div className="ss-two">
          <Field label="Pienin oma summa (€)" htmlFor="hset-gift-min" error={error('minCents')}>
            <Input id="hset-gift-min" inputMode="numeric" value={form.min} onChange={(e) => set({ min: e.target.value })} />
          </Field>
          <Field label="Suurin oma summa (€)" htmlFor="hset-gift-max" error={error('maxCents')}>
            <Input id="hset-gift-max" inputMode="numeric" value={form.max} onChange={(e) => set({ max: e.target.value })} />
          </Field>
        </div>
        <Field label="Voimassa ostosta" htmlFor="hset-gift-valid" error={error('validDays')} hint="Saaja lunastaa koodin saldokseen tämän ajan kuluessa.">
          <Select id="hset-gift-valid" options={validityOptions(GIFT_VALIDITY, form.validDays)} value={String(form.validDays)}
            onChange={(e) => set({ validDays: Number(e.target.value) })} />
        </Field>
        <p className="bk-fine">Summat ovat täysiä euroja. Jo myydyt lahjakortit pitävät arvonsa ja voimassaolonsa.</p>
      </div>
    </Sheet>
  );
}
