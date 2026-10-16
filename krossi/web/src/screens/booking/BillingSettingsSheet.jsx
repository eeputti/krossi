// BillingSettingsSheet — Hallin asetukset → laskutustiedot: the seller on every new invoice (name,
// Y-tunnus, address, IBAN, BIC, e-mail, phone), the VAT in the prices, payment terms and the next
// invoice number. The Y-tunnus check digit and the IBAN are checked as soon as the field is left
// (features/seasons.js); IBAN, BIC and Y-tunnus are shown the way they are stored. An invoice needs
// only the name and the IBAN — without them invoiced kausivuorot can't be approved.
import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';
import { useBusy } from '../../app/hooks.js';
import { checkBillingSettings, formatIban, normalizeBic, normalizeBusinessId, normalizeIban } from '../../features/seasons.js';
import { Button, Field, Input, Sheet, useToast } from '../../ui/index.js';
import { InfoLine } from './SeasonParts.jsx';
import { intFromInput, numberFromInput, numberToInput } from './hallSettingsForm.js';

const fromSettings = (s) => ({
  sellerName: s?.sellerName || '', businessId: s?.businessId || '', address: s?.address || '',
  iban: s?.iban ? formatIban(s.iban) : '', bic: s?.bic || '', email: s?.email || '', phone: s?.phone || '',
  vat: numberToInput(s?.vatPercent ?? 14), terms: String(s?.paymentTermsDays ?? 14), next: String(s?.nextInvoiceNumber ?? 1001),
});

export function BillingSettingsSheet({ open, onClose, venue, settings, onDone }) {
  const toast = useToast();
  const [busy, run] = useBusy();
  const [form, setForm] = useState(() => fromSettings(settings));
  const [tried, setTried] = useState(false);
  const [left, setLeft] = useState({}); // fields the user has left once: their own check shows

  useEffect(() => {
    if (!open) return;
    setForm(fromSettings(settings));
    setTried(false);
    setLeft({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!venue || !settings) return <Sheet open={false} onClose={onClose} />;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const nextChanged = form.next.trim() !== '' && form.next.trim() !== String(settings.nextInvoiceNumber);
  const input = {
    sellerName: form.sellerName, businessId: form.businessId, address: form.address, iban: form.iban, bic: form.bic,
    email: form.email, phone: form.phone, vatPercent: numberFromInput(form.vat), paymentTermsDays: intFromInput(form.terms),
    nextInvoiceNumber: nextChanged ? intFromInput(form.next) : null,
  };
  const check = checkBillingSettings(input, { lastInvoiceNumber: settings.lastInvoiceNumber });
  const own = {
    businessId: form.businessId.trim() && !normalizeBusinessId(form.businessId) ? 'Tarkista Y-tunnus (muoto 1234567-8).' : '',
    iban: form.iban.trim() && !normalizeIban(form.iban) ? 'Tarkista tilinumero (IBAN).' : '',
    bic: form.bic.trim() && !normalizeBic(form.bic) ? 'Tarkista BIC-koodi.' : '',
  };
  const error = (field) => (tried && check.field === field ? check.error : '') || (left[field] ? own[field] || '' : '');
  const leave = (field, tidy) => () => {
    setLeft((l) => ({ ...l, [field]: true }));
    const value = tidy(form[field]);
    if (value) set({ [field]: value });
  };

  const save = () => {
    setTried(true);
    if (check.error) return;
    run(async () => {
      try {
        const saved = await api.billing.saveSettings(venue.id, check.value);
        onDone?.(saved.ready && !settings.ready
          ? 'Laskutustiedot tallennettu. Laskulla maksettavat kausivuorot voi nyt hyväksyä.'
          : 'Laskutustiedot tallennettu.');
      } catch (err) {
        toast(err);
      }
    });
  };

  return (
    <Sheet
      open={open}
      onClose={busy ? undefined : onClose}
      title="Laskutustiedot"
      subtitle={venue.name}
      footer={<Button variant="lime" size="lg" block icon="check" loading={busy} onClick={save}>Tallenna</Button>}
      size="md"
      className="bk-sheet"
    >
      <div className="stack-4">
        <InfoLine icon="info">Laskuun tarvitaan vähintään laskuttajan nimi ja tilinumero. Muutokset koskevat uusia laskuja; jo tehdyt laskut pysyvät ennallaan.</InfoLine>
        <Field label="Laskuttaja" htmlFor="hset-bill-name" error={error('sellerName')} hint="Yrityksen tai yhdistyksen virallinen nimi">
          <Input id="hset-bill-name" value={form.sellerName} maxLength={120} placeholder="esim. Lahden Tennis- ja Squashkeskus Oy" onChange={(e) => set({ sellerName: e.target.value })} />
        </Field>
        <div className="ss-two">
          <Field label="Y-tunnus" optional htmlFor="hset-bill-id" error={error('businessId')}>
            <Input id="hset-bill-id" value={form.businessId} placeholder="1234567-8" autoComplete="off"
              onChange={(e) => set({ businessId: e.target.value })} onBlur={leave('businessId', normalizeBusinessId)} />
          </Field>
          <Field label="Puhelin" optional htmlFor="hset-bill-phone" error={error('phone')}>
            <Input id="hset-bill-phone" type="tel" value={form.phone} placeholder="03 123 4567" onChange={(e) => set({ phone: e.target.value })} />
          </Field>
        </div>
        <Field label="Osoite" optional htmlFor="hset-bill-address" error={error('address')}>
          <Input id="hset-bill-address" value={form.address} maxLength={200} placeholder="Katuosoite, postinumero ja toimipaikka" onChange={(e) => set({ address: e.target.value })} />
        </Field>
        <div className="ss-two">
          <Field label="Tilinumero (IBAN)" htmlFor="hset-bill-iban" error={error('iban')}>
            <Input id="hset-bill-iban" value={form.iban} placeholder="FI00 1234 5600 0007 85" autoComplete="off" inputMode="text"
              onChange={(e) => set({ iban: e.target.value })} onBlur={leave('iban', (v) => (normalizeIban(v) ? formatIban(normalizeIban(v)) : null))} />
          </Field>
          <Field label="BIC" optional htmlFor="hset-bill-bic" error={error('bic')}>
            <Input id="hset-bill-bic" value={form.bic} placeholder="esim. NDEAFIHH" autoComplete="off"
              onChange={(e) => set({ bic: e.target.value })} onBlur={leave('bic', normalizeBic)} />
          </Field>
        </div>
        <Field label="Sähköposti" optional htmlFor="hset-bill-email" error={error('email')} hint="Laskuissa ja pelaajille lähtevissä viesteissä vastausosoitteena.">
          <Input id="hset-bill-email" type="email" value={form.email} placeholder="laskutus@halli.fi" onChange={(e) => set({ email: e.target.value })} />
        </Field>
        <div className="hset-three">
          <Field label="ALV (%)" htmlFor="hset-bill-vat" error={error('vatPercent')}>
            <Input id="hset-bill-vat" inputMode="decimal" value={form.vat} onChange={(e) => set({ vat: e.target.value })} />
          </Field>
          <Field label="Maksuaika (pv)" htmlFor="hset-bill-terms" error={error('paymentTermsDays')}>
            <Input id="hset-bill-terms" inputMode="numeric" value={form.terms} onChange={(e) => set({ terms: e.target.value })} />
          </Field>
          <Field label="Seuraava laskunumero" htmlFor="hset-bill-next" error={error('nextInvoiceNumber')}
            hint={settings.lastInvoiceNumber ? `Viimeisin lasku ${settings.lastInvoiceNumber}` : 'Ei vielä laskuja'}>
            <Input id="hset-bill-next" inputMode="numeric" value={form.next} onChange={(e) => set({ next: e.target.value })} />
          </Field>
        </div>
        <p className="bk-fine">Hinnat sisältävät ALV:n. Tarkista liikuntapalvelujen verokanta kirjanpitäjältä.</p>
      </div>
    </Sheet>
  );
}
