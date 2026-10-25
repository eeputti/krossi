// tiles.jsx — the big choice tiles and the "Muut" rows shared by Merkitse, a session's sheet in
// Viikkohallinta and the plus menu, so one thing looks the same wherever the coach meets it:
// Läsnäolo grey, Huomio blue (a speech bubble), Kotiläksy green, Tiedote amber, Teema lime,
// Video clay.
import { Icon } from '../ui/index.js';

const cx = (...c) => c.filter(Boolean).join(' ');

/** The icon and colour of each thing a coach records. */
export const RECORD_LOOK = {
  lasnaolo: { icon: 'user-check', tone: 'sand', label: 'Läsnäolo' },
  huomio: { icon: 'chat', tone: 'blue', label: 'Huomio' },
  laksy: { icon: 'check-circle', tone: 'green', label: 'Kotiläksy' },
  tiedote: { icon: 'info', tone: 'warn', label: 'Tiedote' },
  teema: { icon: 'sparkles', tone: 'lime', label: 'Teema' },
  video: { icon: 'play', tone: 'clay', label: 'Video' },
};

export function ChoiceTile({ icon, tone, title, sub, onClick }) {
  return (
    <button type="button" className="k-merkitse-tile ms-tile" onClick={onClick}>
      <span className={cx('k-merkitse-icon', `is-${tone}`)}><Icon name={icon} size={22} /></span>
      <span className="k-merkitse-title">{title}</span>
      {sub && <span className="k-merkitse-sub">{sub}</span>}
    </button>
  );
}

/** tiles: [{ id, look ('huomio' …) or icon + tone, title?, sub, run }] */
export function ChoiceGrid({ tiles, label }) {
  return (
    <div className="ms-grid" role="group" aria-label={label}>
      {tiles.map((t) => {
        const look = RECORD_LOOK[t.look] || {};
        return <ChoiceTile key={t.id} icon={t.icon || look.icon} tone={t.tone || look.tone} title={t.title || look.label} sub={t.sub} onClick={t.run} />;
      })}
    </div>
  );
}

/** The rarer things under the tiles, as one list. rows: [{ id, icon, title, sub?, danger?, run }] */
export function ChoiceRows({ title = 'Muut', rows }) {
  if (!rows.length) return null;
  return (
    <section className="ms-others" aria-label={title}>
      <div className="eyebrow">{title}</div>
      <div className="ms-others-list">
        {rows.map((r) => (
          <button key={r.id} type="button" className={cx('ms-row', r.danger && 'is-danger')} onClick={r.run}>
            <span className="ms-row-icon"><Icon name={r.icon} size={16} /></span>
            <span className="ms-row-main"><span className="ms-row-title">{r.title}</span>{r.sub && <span className="ms-row-sub">{r.sub}</span>}</span>
            <Icon name="chevron-right" size={16} className="k-chevron" />
          </button>
        ))}
      </div>
    </section>
  );
}
