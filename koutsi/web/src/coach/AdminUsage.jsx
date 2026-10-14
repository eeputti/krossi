// AdminUsage — Ylläpito → Käyttö: what both Koutsi apps (old and renewed) are used for,
// from the anonymous events of lib/koutsi-usage.js. When people use Koutsi, which pages they
// open and for how long, what they tap, which errors they ran into, and the latest visits as
// timelines. No names anywhere: rows carry a random visit id, never a user. The old Koutsi's
// Ylläpito shows the same data (lib/koutsi-admin-usage.jsx); both read it through
// lib/koutsi-usage-report.js.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { Card, Chip, EmptyState, ErrorState, Icon, Segmented, Select, SkeletonList, StatTile, Switch } from '../ui/index.js';
import {
  APP_NAMES, DEVICE_NAMES, ROLE_NAMES, WEEKDAYS, clickName, eventText, fmtClock, fmtDuration, fmtWhen, heatLevel, routeName, summarize,
} from '../../../../lib/koutsi-usage-report.js';

const PERIODS = [{ value: '7', label: '7 pv' }, { value: '30', label: '30 pv' }, { value: '90', label: '90 pv' }, { value: '180', label: '180 pv' }];
const ROLES = [{ value: 'all', label: 'Kaikki' }, { value: 'valmentaja', label: 'Valmentajat' }, { value: 'pelaaja', label: 'Pelaajat' }];
const APPS = [{ value: 'all', label: 'Molemmat' }, { value: 'vanha', label: 'Vanha' }, { value: 'uusi', label: 'Uusi' }];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

function Who({ row }) {
  return (
    <span className="ausage-who">
      <Chip size="sm" tone={row.role === 'valmentaja' ? 'success' : 'neutral'}>{ROLE_NAMES[row.role]}</Chip>
      <Chip size="sm" tone={row.app === 'uusi' ? 'lime' : 'neutral'}>{APP_NAMES[row.app]}</Chip>
    </span>
  );
}

function Bar({ value, max }) {
  return <div className="ausage-bar" aria-hidden="true"><span style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%` }} /></div>;
}

function SectionTitle({ eyebrow, title, children }) {
  return (
    <div className="row-between wrap ausage-section-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2 className="k-block-title">{title}</h2>
      </div>
      {children}
    </div>
  );
}

/** Weekday × hour grid of visits, Helsinki time. Tap or hover a cell to read it. */
function Heatmap({ heat, max }) {
  const [focus, setFocus] = useState(null);
  const readout = focus
    ? `${WEEKDAYS[focus.d]} klo ${focus.h}–${focus.h + 1}: ${plural(heat[focus.d][focus.h], 'käyttökerta', 'käyttökertaa')}`
    : 'Napauta ruutua nähdäksesi tarkan määrän.';
  return (
    <div className="ausage-heat-wrap">
      <div className="ausage-heat" role="grid" aria-label="Käyttökerrat viikonpäivän ja kellonajan mukaan">
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="ausage-heat-hour">{h % 6 === 0 ? h : ''}</span>)}
        {WEEKDAYS.map((day, d) => (
          <div key={day} role="row" className="ausage-heat-row">
            <span className="ausage-heat-day" role="rowheader">{day}</span>
            {heat[d].map((v, h) => (
              <button
                key={h}
                type="button"
                role="gridcell"
                className={`ausage-cell ausage-l${heatLevel(v, max)}${focus && focus.d === d && focus.h === h ? ' is-focus' : ''}`}
                aria-label={`${day} klo ${h}–${h + 1}: ${v}`}
                title={`${day} klo ${h}–${h + 1}: ${v}`}
                onMouseEnter={() => setFocus({ d, h })}
                onFocus={() => setFocus({ d, h })}
                onClick={() => setFocus({ d, h })}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="ausage-heat-foot">
        <span className="k-faint">{readout}</span>
        <span className="ausage-legend" aria-hidden="true">
          vähän {[1, 2, 3, 4, 5].map((l) => <i key={l} className={`ausage-cell ausage-l${l}`} />)} paljon
        </span>
      </div>
    </div>
  );
}

/** Visits per day (per week for long periods). */
function DayBars({ days }) {
  const [focus, setFocus] = useState(null);
  const weekly = days.length > 45;
  const bars = useMemo(() => {
    if (!weekly) return days.map((d) => ({ key: d.day, label: d.day.split('-').reverse().slice(0, 2).join('.') + '.', value: d.sessions }));
    const out = [];
    days.forEach((d, i) => {
      if (i % 7 === 0) out.push({ key: d.day, label: `vko alkaen ${d.day.split('-').reverse().slice(0, 2).join('.')}.`, value: 0 });
      out[out.length - 1].value += d.sessions;
    });
    return out;
  }, [days, weekly]);
  const max = Math.max(1, ...bars.map((b) => b.value));
  const shown = focus != null ? bars[focus] : null;
  return (
    <div className="stack-2">
      <div className="ausage-days" role="img" aria-label={`Käyttökerrat ${weekly ? 'viikoittain' : 'päivittäin'}`}>
        {bars.map((b, i) => (
          <button
            key={b.key}
            type="button"
            className={`ausage-day${focus === i ? ' is-focus' : ''}`}
            title={`${b.label}: ${b.value}`}
            aria-label={`${b.label}: ${b.value}`}
            onMouseEnter={() => setFocus(i)}
            onFocus={() => setFocus(i)}
            onClick={() => setFocus(i)}
          >
            <span style={{ height: `${b.value ? Math.max(4, (b.value / max) * 100) : 0}%` }} />
          </button>
        ))}
      </div>
      <span className="k-faint">
        {shown ? `${shown.label}: ${plural(shown.value, 'käyttökerta', 'käyttökertaa')}` : `Käyttökerrat ${weekly ? 'viikoittain' : 'päivittäin'} — napauta palkkia.`}
      </span>
    </div>
  );
}

function Views({ rows }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return <p className="k-faint">Ei vielä avattuja sivuja.</p>;
  const max = rows[0].views;
  const list = all ? rows : rows.slice(0, 12);
  return (
    <ul className="ausage-list">
      {list.map((r) => (
        <li key={`${r.app}${r.role}${r.path}`} className="ausage-row">
          <div className="ausage-row-head">
            <span className="grow truncate">{routeName(r.path)}</span>
            <strong className="t-num">{r.views}</strong>
          </div>
          <Bar value={r.views} max={max} />
          <div className="ausage-meta">
            <Who row={r} />
            <span className="k-faint">{plural(r.sessions, 'käyttökerta', 'käyttökertaa')}{r.seconds != null ? ` · keskim. ${fmtDuration(r.seconds)}` : ''}</span>
          </div>
        </li>
      ))}
      {rows.length > 12 && <li><button type="button" className="k-textlink" onClick={() => setAll(!all)}>{all ? 'Näytä vähemmän' : `Näytä kaikki ${rows.length}`}</button></li>}
    </ul>
  );
}

function Clicks({ rows }) {
  const [path, setPath] = useState('');
  const [all, setAll] = useState(false);
  const paths = useMemo(() => [...new Set(rows.map((r) => r.path))], [rows]);
  if (!rows.length) return <p className="k-faint">Ei vielä painalluksia.</p>;
  const filtered = path ? rows.filter((r) => r.path === path) : rows;
  const max = filtered.length ? filtered[0].clicks : 1;
  const list = all ? filtered : filtered.slice(0, 15);
  return (
    <div className="stack-3">
      <Select
        aria-label="Sivu"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="Kaikki sivut"
        options={paths.map((p) => ({ value: p, label: routeName(p) }))}
      />
      <ul className="ausage-list">
        {list.map((r) => (
          <li key={`${r.app}${r.role}${r.path}${r.label}${r.target}`} className="ausage-row">
            <div className="ausage-row-head">
              <span className={`grow truncate${r.label ? '' : ' ausage-hidden-label'}`}>{clickName(r)}</span>
              <strong className="t-num">{r.clicks}</strong>
            </div>
            <Bar value={r.clicks} max={max} />
            <div className="ausage-meta">
              <Who row={r} />
              <span className="k-faint">{path ? '' : `${routeName(r.path)} · `}{plural(r.sessions, 'käyttökerta', 'käyttökertaa')}</span>
            </div>
          </li>
        ))}
        {filtered.length > 15 && <li><button type="button" className="k-textlink" onClick={() => setAll(!all)}>{all ? 'Näytä vähemmän' : `Näytä kaikki ${filtered.length}`}</button></li>}
      </ul>
    </div>
  );
}

function Errors({ rows }) {
  if (!rows.length) {
    return <p className="ausage-ok"><Icon name="check-circle" size={16} /> Ei virheitä tällä aikavälillä.</p>;
  }
  return (
    <ul className="ausage-list">
      {rows.map((r) => (
        <li key={`${r.label}${r.message}`} className="ausage-row ausage-error">
          <div className="ausage-row-head">
            <span className="grow"><Icon name="alert" size={15} /> {r.label}</span>
            <strong className="t-num">{r.count}×</strong>
          </div>
          {r.message && <p className="ausage-error-msg">{r.message}</p>}
          <div className="ausage-meta">
            {r.places.map((p) => (
              <span key={`${p.app}${p.role}${p.path}`} className="ausage-place"><Who row={p} /> <span className="k-faint">{routeName(p.path)}</span></span>
            ))}
          </div>
          <span className="k-faint">viimeksi {fmtWhen(r.lastAt)}{r.count > 1 ? ` · ensimmäisen kerran ${fmtWhen(r.firstAt)}` : ''}</span>
        </li>
      ))}
    </ul>
  );
}

function Sessions({ rows }) {
  if (!rows.length) return <p className="k-faint">Ei vielä käyttökertoja.</p>;
  return (
    <ul className="ausage-list">
      {rows.map((s) => (
        <li key={s.id}>
          <details className="ausage-session">
            <summary>
              <span className="ausage-session-title">
                <Who row={s} />
                <span className="k-faint">{DEVICE_NAMES[s.device] || s.device}</span>
                {s.errors > 0 && <Chip size="sm" tone="clay" icon="alert">{plural(s.errors, 'virhe', 'virhettä')}</Chip>}
              </span>
              <span className="ausage-session-sub">
                {fmtWhen(s.start)} · {fmtDuration(s.seconds)} · {plural(s.views, 'sivu', 'sivua')} · {plural(s.clicks, 'painallus', 'painallusta')}
              </span>
            </summary>
            <ol className="ausage-timeline">
              {s.events.map((e, i) => (
                <li key={i} className={`ausage-ev ausage-ev-${e.kind}`}>
                  <span className="ausage-ev-time t-num">{fmtClock(e.at)}</span>
                  <span className="ausage-ev-text">{eventText(e)}</span>
                </li>
              ))}
            </ol>
          </details>
        </li>
      ))}
    </ul>
  );
}

export function AdminUsage() {
  const [days, setDays] = useState('30');
  const [role, setRole] = useState('all');
  const [app, setApp] = useState('all');
  const [includeTest, setIncludeTest] = useState(false);
  const [s, setS] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    setS((x) => ({ ...x, loading: true, error: null }));
    try {
      setS({ data: await api.admin.usageOverview(Number(days), includeTest), error: null, loading: false });
    } catch (error) {
      setS({ data: null, error, loading: false });
    }
  }, [days, includeTest]);
  useEffect(() => { load(); }, [load]);
  const sum = useMemo(() => (s.data ? summarize(s.data, { role, app }) : null), [s.data, role, app]);

  const controls = (
    <div className="ausage-controls">
      <Segmented ariaLabel="Aikaväli" size="sm" value={days} onChange={setDays} options={PERIODS} />
      <Segmented ariaLabel="Rooli" size="sm" value={role} onChange={setRole} options={ROLES} />
      <Segmented ariaLabel="Sovellus" size="sm" value={app} onChange={setApp} options={APPS} />
      <label className="ausage-switch">
        <Switch size="sm" checked={includeTest} onChange={setIncludeTest} label="Näytä omat testit" />
        <span>Näytä omat ja testitilien käytöt</span>
      </label>
    </div>
  );

  let body;
  if (s.loading && !s.data) body = <SkeletonList count={4} />;
  else if (s.error?.code === 'not_deployed') body = <EmptyState compact art="calendar" title="Käyttötilastot eivät ole vielä päällä" text={s.error.userMessage} />;
  else if (s.error) body = <ErrorState error={s.error} onRetry={load} />;
  else if (!sum.totals.sessions) {
    body = (
      <EmptyState
        compact
        art="court"
        title="Ei vielä käyttötietoja"
        text={sum.testEvents && !includeTest
          ? `Tiedot kertyvät, kun valmentajat ja pelaajat käyttävät Koutsia. Omia ja testitilien tapahtumia on ${sum.testEvents} — näet ne kytkimellä.`
          : 'Tiedot kertyvät, kun valmentajat ja pelaajat käyttävät Koutsia.'}
      />
    );
  } else {
    const devTotal = sum.devices.puhelin + sum.devices.tabletti + sum.devices.kone;
    body = (
      <>
        <div className="k-stats">
          <StatTile label="Käyttökertoja" value={sum.totals.sessions} sub={`${sum.activeDays} aktiivista päivää`} />
          <StatTile label="Sivuja avattu" value={sum.totals.views} />
          <StatTile label="Painalluksia" value={sum.totals.clicks} />
          <StatTile label="Virheitä" value={sum.totals.errors} tone={sum.totals.errors ? 'clay' : 'default'} />
        </div>
        {devTotal > 0 && (
          <p className="k-faint">
            Laitteet: puhelin {pct(sum.devices.puhelin, devTotal)} % · tietokone {pct(sum.devices.kone, devTotal)} % · tabletti {pct(sum.devices.tabletti, devTotal)} %
          </p>
        )}
        <Card className="stack-4">
          <SectionTitle eyebrow="Suomen aikaa" title="Milloin Koutsia käytetään" />
          <Heatmap heat={sum.heat} max={sum.heatMax} />
          <DayBars days={sum.days} />
        </Card>
        <Card className="stack-3">
          <SectionTitle eyebrow="Mitä avataan" title="Sivut" />
          <p className="k-faint">Montako kertaa sivu avattiin ja kauanko siinä keskimäärin viivyttiin.</p>
          <Views rows={sum.views} />
        </Card>
        <Card className="stack-3">
          <SectionTitle eyebrow="Mitä painetaan" title="Eniten painetut" />
          <p className="k-faint">Nimiä tai muuta sisältöä sisältävät kohdat näkyvät vain tyyppinä, esim. ”Kortti (teksti piilotettu)”.</p>
          <Clicks rows={sum.clicks} />
        </Card>
        <Card className="stack-3">
          <SectionTitle eyebrow="Mikä meni pieleen" title="Virheet" />
          <p className="k-faint">Kaatumiset ja virheilmoitukset, jotka käyttäjä näki ruudulla.</p>
          <Errors rows={sum.errors} />
        </Card>
        <Card className="stack-3">
          <SectionTitle eyebrow="Mitä ihmiset tekivät" title="Viimeisimmät käyttökerrat" />
          <p className="k-faint">Jokainen käyttökerta tapahtumineen — ilman nimeä. Avaa rivi nähdäksesi, mitä tehtiin.</p>
          <Sessions rows={sum.sessions} />
        </Card>
      </>
    );
  }

  return (
    <section className="stack-4 ausage">
      <SectionTitle eyebrow="Vanha ja uusi Koutsi" title="Käyttötilastot" />
      {controls}
      {body}
      <p className="k-fine">
        <Icon name="shield" size={14} />
        Tallennetaan ilman nimeä, sähköpostia tai käyttäjätunnusta, ja tiedot poistuvat 180 päivän jälkeen.
        Valmentajia on vähän, joten valmentajapuolen käyttö voi silti olla tunnistettavissa ajankohdasta.
      </p>
    </section>
  );
}
