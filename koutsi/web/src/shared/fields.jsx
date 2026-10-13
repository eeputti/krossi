// fields.jsx — form controls Koutsi needs beyond the UI kit.
import { useRef } from 'react';
import { ChipSelect, Select, Stepper } from '../ui/index.js';
import { koutsiRoundTimeToQuarterHour, koutsiRoundToQuarterHourMinutes } from '../domain/core.js';
import { WEEKDAY_CODES } from '../lib/constants.js';

/**
 * Time of day as two selects (hours, quarter hours). The native time picker renders as a bare
 * number wheel on some phones; every stored time is on a quarter hour anyway.
 */
export function TimeSelect({ value, onChange, id, disabled }) {
  const [h, m] = (value || '').split(':');
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  return (
    <div className="k-time">
      <Select id={id} aria-label="Tunti" disabled={disabled} value={h || ''} placeholder="--"
        options={hours.map((x) => ({ value: x, label: x }))}
        onChange={(e) => onChange(koutsiRoundTimeToQuarterHour(`${e.target.value || '00'}:${m || '00'}`))} />
      <span className="k-time-sep" aria-hidden="true">:</span>
      <Select aria-label="Minuutti" disabled={disabled} value={m || ''} placeholder="--"
        options={['00', '15', '30', '45'].map((x) => ({ value: x, label: x }))}
        onChange={(e) => onChange(`${h || '00'}:${e.target.value || '00'}`)} />
    </div>
  );
}

export function DayPicker({ value, onChange }) {
  return <ChipSelect options={WEEKDAY_CODES.map((d) => ({ value: d, label: d }))} value={value} onChange={(v) => v && onChange(v)} size="sm" ariaLabel="Viikonpäivä" />;
}

/** Duration in minutes, quarter-hour steps between 15 and 480. */
export function DurationStepper({ value, onChange }) {
  return (
    <div className="k-duration">
      <Stepper value={value} min={15} max={480} step={15} label="Kesto minuutteina" onChange={(v) => onChange(koutsiRoundToQuarterHourMinutes(v))} />
      <span className="k-duration-unit">min</span>
    </div>
  );
}

/** A file picker button that hands back the chosen file. */
export function FilePick({ accept, onPick, children, className }) {
  const ref = useRef(null);
  return (
    <>
      <button type="button" className={className || 'btn btn-outline btn-md'} onClick={() => ref.current?.click()}>{children}</button>
      <input ref={ref} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }} />
    </>
  );
}

export const optionalAge = (value) => {
  if (!value) return { age: null, valid: true };
  const n = Number(value);
  return { age: n, valid: Number.isInteger(n) && n >= 1 && n < 120 };
};
