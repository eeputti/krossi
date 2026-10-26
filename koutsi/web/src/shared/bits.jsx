// bits.jsx — small pieces both apps use: copy/share buttons, the QR code, the theme card a
// player sees, a week stepper, and a few list rows.

import { useMemo, useState } from 'react';
import { Button, Icon, IconButton, useToast } from '../ui/index.js';
import { copyText } from '../ui/effects.js';
import { koutsiQrMatrix } from '../lib/qr.js';
import { themeWeekRelative, weekRangeLabel } from '../domain/week.js';

const cx = (...c) => c.filter(Boolean).join(' ');

/** Copies `text`; the label flips to `copiedLabel` for a moment. */
export function CopyButton({ text, label = 'Kopioi', copiedLabel = 'Kopioitu!', variant = 'outline', size = 'sm', icon = 'copy', block, className, missing = null }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <Button variant={variant} size={size} icon={copied ? 'check' : icon} block={block} className={className} missing={missing}
      onClick={async () => {
        if (await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 2200); }
        else toast('Kopiointi ei onnistunut — valitse teksti ja kopioi käsin.', { tone: 'error' });
      }}>
      {copied ? copiedLabel : label}
    </Button>
  );
}

/**
 * Opens the phone's share sheet with a ready message (WhatsApp is one tap away there); on a
 * desktop without a share sheet it copies the message instead.
 */
export function ShareTextButton({ text, title, label = 'Jaa', variant = 'dark', size = 'sm', icon = 'share', block, className, missing = null }) {
  const toast = useToast();
  const onClick = async () => {
    try {
      if (navigator.share) { await navigator.share({ title, text }); return; }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    if (await copyText(text)) toast('Viesti kopioitu — liitä se WhatsAppiin tai tekstiviestiin.', { icon: 'copy' });
    else toast('Kopiointi ei onnistunut.', { tone: 'error' });
  };
  return <Button variant={variant} size={size} icon={icon} block={block} className={className} missing={missing} onClick={onClick}>{label}</Button>;
}

/** QR rendered locally as SVG — an invite link never leaves the device to be drawn. */
export function QrCode({ text, size = 168 }) {
  const matrix = useMemo(() => { try { return koutsiQrMatrix(text); } catch { return null; } }, [text]);
  if (!matrix) return null;
  const quiet = 2;
  const dim = matrix.length + quiet * 2;
  let d = '';
  matrix.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${c + quiet} ${r + quiet}h1v1h-1z`; }));
  return (
    <svg className="k-qr" width={size} height={size} viewBox={`0 0 ${dim} ${dim}`} shapeRendering="crispEdges" role="img" aria-label="QR-koodi liittymislinkkiin">
      <rect width={dim} height={dim} fill="#fff" />
      <path d={d} fill="#121212" />
    </svg>
  );
}

/** How a player sees a weekly theme (also the planner's preview). */
export function ThemeCard({ theme, week, eyebrow, note, groups, compact, className, children }) {
  return (
    <div className={cx('k-theme-card', compact && 'is-compact', className)}>
      <div className="eyebrow">{eyebrow || `Viikon teema · vko ${week?.week ?? theme?.week}`}</div>
      <div className="k-theme-title">{theme.title}</div>
      {theme.lead && <p className="k-theme-lead">{theme.lead}</p>}
      {groups && <div className="k-theme-groups">{groups}</div>}
      {note && <p className="k-theme-note">{note}</p>}
      {children}
    </div>
  );
}

/** Viikkohallinta's week head, for the planner: ENSI VIIKKO / ‹ Viikko 43 › / 19.–25.10.2026 · sub */
export function WeekStepper({ week, onPrev, onNext, sub, onToday, isCurrent }) {
  const relative = themeWeekRelative(week);
  return (
    <div className="k-week-stepper">
      {relative && <div className="eyebrow">{relative}</div>}
      <div className="k-week-stepper-row">
        <IconButton icon="chevron-left" label="Edellinen viikko" variant="soft" onClick={onPrev} />
        <div className="k-week-stepper-title">Viikko {week.week}</div>
        <IconButton icon="chevron-right" label="Seuraava viikko" variant="soft" onClick={onNext} />
        {!isCurrent && onToday && <button type="button" className="wb-today-btn k-week-stepper-today" onClick={onToday}>Tämä viikko</button>}
      </div>
      <div className="k-week-stepper-meta">
        <span className="k-week-stepper-range t-num">{weekRangeLabel(week)}</span>
        {sub && <span className="k-week-stepper-sub">{sub}</span>}
      </div>
    </div>
  );
}

/** A labelled block inside a page: title, optional right-side action, children. */
export function Block({ title, eyebrow, action, children, className, id }) {
  return (
    <section className={cx('k-block', className)} id={id}>
      {(title || action) && (
        <div className="k-block-head">
          <div className="k-block-titles">
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <h2 className="k-block-title">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Small grey line for "nothing here yet" inside a block (the big EmptyState is for pages). */
export function Quiet({ children, icon }) {
  return <p className="k-quiet">{icon && <Icon name={icon} size={16} />}{children}</p>;
}

/** A pill showing a group's day + time. */
export function SchedulePill({ group }) {
  if (!group?.day) return null;
  return <span className="k-sched-pill"><span className="k-sched-day">{group.day}</span>{group.time}</span>;
}

/** Shows `count` items, then a "Näytä kaikki (N)" toggle. */
export function useShowMore(items, count) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, count);
  const toggle = items.length > count ? (
    <button type="button" className="k-more" onClick={() => setAll((v) => !v)}>
      {all ? 'Näytä vähemmän' : `Näytä kaikki (${items.length})`}
      <Icon name={all ? 'chevron-up' : 'chevron-down'} size={16} />
    </button>
  ) : null;
  return [shown, toggle];
}
