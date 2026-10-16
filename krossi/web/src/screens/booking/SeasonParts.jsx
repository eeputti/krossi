// SeasonParts.jsx — small pieces the kausivuoro, billing and series / gift card screens share:
// status chips, the month-by-month card schedule, the saved-card line, a pass's balance and a
// credit history list. Plain and factual: these are money screens (no playful touches).
import { centsLabel, durationLabel } from '../../features/booking.js';
import {
  CHARGE_STATE_LABELS, INVOICE_STATE_LABELS, chargeIsDue, dayMonth, hoursLeftLabel, invoiceState, monthLabel,
} from '../../features/seasons.js';
import { formatDate, formatDayMonth } from '../../lib/format.js';
import { Button, Chip, Icon, ProgressBar } from '../../ui/index.js';

const cx = (...c) => c.filter(Boolean).join(' ');

const SLOT_STATES = {
  requested: { label: 'Haettu', tone: 'warn' },
  active: { label: 'Voimassa', tone: 'success' },
  declined: { label: 'Hylätty', tone: 'danger' },
  withdrawn: { label: 'Peruttu', tone: 'neutral' },
  ended: { label: 'Päättynyt', tone: 'neutral' },
};

export function SlotStatusChip({ status, size = 'sm' }) {
  const s = SLOT_STATES[status] || SLOT_STATES.ended;
  return <Chip tone={s.tone} size={size}>{s.label}</Chip>;
}

const INVOICE_TONES = { open: 'neutral', overdue: 'danger', paid: 'success', void: 'neutral' };

export function InvoiceStateChip({ invoice, size = 'sm' }) {
  const state = invoiceState(invoice);
  return <Chip tone={INVOICE_TONES[state]} size={size}>{INVOICE_STATE_LABELS[state]}</Chip>;
}

const CHARGE_TONES = { scheduled: 'neutral', processing: 'warn', paid: 'success', failed: 'danger', void: 'neutral' };

export function ChargeStateChip({ charge, size = 'sm' }) {
  const due = charge.status === 'scheduled' && chargeIsDue(charge);
  return (
    <Chip tone={due ? 'warn' : CHARGE_TONES[charge.status]} size={size}>
      {due ? 'Erääntynyt' : CHARGE_STATE_LABELS[charge.status]}
    </Chip>
  );
}

/** 'Visa •••• 4242 · 12/2028' */
export function cardLabel(card) {
  if (!card) return '';
  const brand = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express' }[card.brand] || 'Kortti';
  return `${brand} •••• ${card.last4}${card.expMonth ? ` · ${String(card.expMonth).padStart(2, '0')}/${card.expYear}` : ''}`;
}

/**
 * A card-billed season slot's months: due date, amount, state; a failed (or due) month of the
 * player's own gets "Maksa nyt" (onPay).
 */
export function ChargeList({ charges, onPay, compact = false }) {
  if (!charges?.length) return null;
  return (
    <ul className={cx('ss-charges', compact && 'is-compact')}>
      {charges.map((c) => {
        const payable = onPay && (c.status === 'failed' || (c.status === 'scheduled' && chargeIsDue(c)));
        return (
          <li key={c.id} className={cx('ss-charge', `is-${c.status}`)}>
            <span className="ss-charge-month">{monthLabel(c.month, true)}</span>
            <span className="ss-charge-meta t-num">{c.weeks} krt · {c.status === 'paid' && c.paidAt ? `veloitettu ${formatDayMonth(c.paidAt)}` : `eräpäivä ${dayMonth(c.dueOn)}`}</span>
            <span className="ss-charge-amount t-num">{centsLabel(c.amountCents)}</span>
            <ChargeStateChip charge={c} />
            {c.status === 'failed' && c.failureMessage && <span className="ss-charge-error">{c.failureMessage}</span>}
            {payable && (
              <Button variant="dark" size="sm" className="ss-charge-pay" onClick={() => onPay(c)}>Maksa nyt</Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A series card: name, minutes left as a bar, valid until. */
export function PassBalance({ pass }) {
  const used = pass.status === 'used';
  const expired = pass.status === 'expired';
  return (
    <div className={cx('ss-pass', (used || expired) && 'is-done')}>
      <div className="ss-pass-head">
        <span className="ss-pass-name">{pass.name}</span>
        <span className="ss-pass-left t-num">{hoursLeftLabel(pass.minutesLeft)} <small>/ {durationLabel(pass.minutesTotal)}</small></span>
      </div>
      <ProgressBar value={pass.minutesTotal ? pass.minutesLeft / pass.minutesTotal : 0} tone="green" label={`Jäljellä ${hoursLeftLabel(pass.minutesLeft)}`} />
      <span className="ss-pass-valid">
        {expired ? `Vanhentui ${dayMonth(pass.validUntil, true)}` : used ? 'Käytetty loppuun' : `Voimassa ${dayMonth(pass.validUntil, true)} asti`}
      </span>
    </div>
  );
}

/** Credit history (series card minutes or gift cents), newest first. */
export function CreditHistory({ events, unit = 'minutes' }) {
  if (!events?.length) return <p className="ss-empty">Ei vielä tapahtumia.</p>;
  return (
    <ul className="ss-history">
      {events.map((e) => {
        const amount = unit === 'minutes' ? e.minutes : e.cents;
        const text = unit === 'minutes'
          ? `${amount > 0 ? '+' : '−'}${durationLabel(Math.abs(amount))}`
          : `${amount > 0 ? '+' : '−'}${centsLabel(Math.abs(amount))}`;
        return (
          <li key={e.id} className="ss-history-row">
            <span className="ss-history-label">{e.label}</span>
            <span className="ss-history-date">{formatDate(e.createdAt)}</span>
            <span className={cx('ss-history-amount t-num', amount > 0 ? 'is-plus' : 'is-minus')}>{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** A short factual line with an icon, for notes inside sheets. */
export function InfoLine({ icon = 'info', tone = 'neutral', children }) {
  return (
    <p className={cx('ss-info', `is-${tone}`)}>
      <Icon name={icon} size={16} />
      <span>{children}</span>
    </p>
  );
}
