// forms.jsx — inputs, toggles, chip pickers and segmented controls.
import { forwardRef, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

/** Field — label + control + hint/error. Pass the control as children. `optional` adds "(valinnainen)". */
export function Field({ label, hint, error, optional, htmlFor, className, children }) {
  return (
    <div className={cx('field', error && 'field-error', className)}>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}{optional && <span className="field-optional"> (valinnainen)</span>}
        </label>
      )}
      {children}
      {error ? <div className="field-msg field-msg-error" role="alert">{error}</div> : hint ? <div className="field-msg">{hint}</div> : null}
    </div>
  );
}

/** Input — text input. `icon` shows a leading icon; `size`: 'md' | 'lg'. */
export const Input = forwardRef(function Input({ icon, className, size = 'md', ...rest }, ref) {
  if (!icon) return <input ref={ref} className={cx('input', `input-${size}`, className)} {...rest} />;
  return (
    <span className={cx('input-wrap', className)}>
      <Icon name={icon} size={18} className="input-icon" />
      <input ref={ref} className={cx('input', `input-${size}`, 'input-has-icon')} {...rest} />
    </span>
  );
});

/** Textarea — grows with content up to `maxRows`. */
export const Textarea = forwardRef(function Textarea({ className, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cx('input', 'textarea', className)} {...rest} />;
});

/** Select — native select styled like an input. options: [{ value, label }] */
export function Select({ options, placeholder, className, ...rest }) {
  return (
    <span className={cx('select-wrap', className)}>
      <select className="input select" {...rest}>
        {placeholder != null && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Icon name="chevron-down" size={18} className="select-chevron" />
    </span>
  );
}

/** Switch — bare on/off switch. */
export function Switch({ checked, onChange, disabled, label, size = 'md', id }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      className={cx('switch', `switch-${size}`, checked && 'is-on')}
      onClick={() => onChange?.(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  );
}

/** Toggle — a full row: title (+ hint) on the left, Switch on the right. `tone`: 'default' | 'on-dark' */
export function Toggle({ checked, onChange, label, hint, disabled, icon, tone = 'default', className }) {
  const id = useId();
  return (
    <div className={cx('toggle-row', `toggle-row-${tone}`, className)}>
      {icon && <span className="toggle-row-icon"><Icon name={icon} size={18} /></span>}
      <label className="toggle-row-text" htmlFor={id}>
        <span className="toggle-row-label">{label}</span>
        {hint && <span className="toggle-row-hint">{hint}</span>}
      </label>
      <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  );
}

/**
 * ChipSelect — pick one or many from chips.
 *   options: [{ value, label, hint?, icon? }]
 *   value: string (single) | string[] (multiple)
 *   multiple, allowEmpty (single: tapping the selected chip clears it), size: 'sm' | 'md' | 'lg'
 *   layout: 'wrap' (default) | 'scroll' (one horizontal row) | 'grid' (equal columns; `columns`)
 */
export function ChipSelect({ options, value, onChange, multiple, allowEmpty, size = 'md', layout = 'wrap', columns = 2, ariaLabel, className }) {
  const selected = multiple ? new Set(value || []) : null;
  const isOn = (v) => (multiple ? selected.has(v) : value === v);
  const toggle = (v) => {
    if (multiple) {
      const next = new Set(selected);
      next.has(v) ? next.delete(v) : next.add(v);
      onChange(options.map((o) => o.value).filter((x) => next.has(x)));
    } else {
      onChange(value === v && allowEmpty ? '' : v);
    }
  };
  return (
    <div
      role={multiple ? 'group' : 'radiogroup'}
      aria-label={ariaLabel}
      className={cx('chip-select', `chip-select-${layout}`, className)}
      style={layout === 'grid' ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role={multiple ? 'checkbox' : 'radio'}
          aria-checked={isOn(o.value)}
          className={cx('select-chip', `select-chip-${size}`, isOn(o.value) && 'is-on', o.hint && 'has-hint')}
          onClick={() => toggle(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={size === 'lg' ? 20 : 16} />}
          <span className="select-chip-text">
            <span className="select-chip-label">{o.label}</span>
            {o.hint && <span className="select-chip-hint">{o.hint}</span>}
          </span>
          {multiple && isOn(o.value) && <Icon name="check" size={14} strokeWidth={2.6} className="select-chip-check" />}
        </button>
      ))}
    </div>
  );
}

/**
 * Segmented — iOS-style segmented control with a sliding indicator.
 *   options: [{ value, label, icon?, badge? }], value, onChange, tone: 'default' | 'on-dark', size: 'md' | 'sm'
 */
export function Segmented({ options, value, onChange, tone = 'default', size = 'md', className, ariaLabel }) {
  const wrap = useRef(null);
  const [ind, setInd] = useState(null);
  useLayoutEffect(() => {
    const el = wrap.current?.querySelector('[aria-selected="true"]');
    if (el) setInd({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div ref={wrap} role="tablist" aria-label={ariaLabel} className={cx('segmented', `segmented-${tone}`, `segmented-${size}`, className)}>
      {ind && <span className="segmented-indicator" style={{ transform: `translateX(${ind.x}px)`, width: ind.w }} aria-hidden="true" />}
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={cx('segmented-btn', value === o.value && 'is-on')} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={16} />}
          <span>{o.label}</span>
          {o.badge ? <span className="segmented-badge">{o.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Stepper — number with − / + buttons. */
export function Stepper({ value, onChange, min = 0, max = 99, step = 1, label, size = 'md' }) {
  const clamp = (n) => Math.max(min, Math.min(max, n));
  return (
    <div className={cx('stepper', `stepper-${size}`)} role="group" aria-label={label}>
      <button type="button" className="stepper-btn" aria-label="Vähennä" disabled={value <= min} onClick={() => onChange(clamp(value - step))}>
        <span aria-hidden="true">−</span>
      </button>
      <span className="stepper-value t-num" aria-live="polite">{value}</span>
      <button type="button" className="stepper-btn" aria-label="Lisää" disabled={value >= max} onClick={() => onChange(clamp(value + step))}>
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
