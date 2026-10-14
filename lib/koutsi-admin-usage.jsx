// koutsi-admin-usage.jsx — Ylläpito → Käyttö in the old Koutsi (koutsi-valmentaja.html).
//
// The same anonymous statistics as the renewed Koutsi's Käyttö tab (koutsi/web/src/coach/
// AdminUsage.jsx), drawn in the old app's look: when Koutsi is used, which pages are opened,
// what is tapped, which errors people saw, and the latest visits as timelines. The numbers come
// from koutsi_admin_usage() (admin-only on the server) and are shaped by
// lib/koutsi-usage-report.js, which loads before this file. Only the real coach bundle has
// this file; the demo never shows Ylläpito.

function KoutsiAdminUsage() {
  const R = window.koutsiUsageReport;
  const [days, setDays] = React.useState(30);
  const [role, setRole] = React.useState('all');
  const [app, setApp] = React.useState('all');
  const [includeTest, setIncludeTest] = React.useState(false);
  const [state, setState] = React.useState({ data: null, error: null, loading: true });

  const load = React.useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data, error } = await koutsiSupabase.rpc('koutsi_admin_usage', { days_input: days, include_test: includeTest });
      if (error) throw error;
      setState({ data, error: null, loading: false });
    } catch (error) {
      const missing = /could not find the function|PGRST202/i.test(`${error?.code || ''} ${error?.message || ''}`);
      setState({ data: null, error: missing ? 'Käyttötilastot otetaan käyttöön, kun tietokantamuutos on ajettu.' : window.koutsiErrorText(error), loading: false });
    }
  }, [days, includeTest]);
  React.useEffect(() => { load(); }, [load]);

  const sum = React.useMemo(() => (state.data ? R.summarize(state.data, { role, app }) : null), [state.data, role, app]);

  return (
    <div>
      <AdminUsageFilters days={days} setDays={setDays} role={role} setRole={setRole} app={app} setApp={setApp} includeTest={includeTest} setIncludeTest={setIncludeTest} />
      {state.loading && !state.data && <div className="k-card" style={{ padding: 18, color: '#8a857a', fontSize: 14 }}>Ladataan käyttötilastoja…</div>}
      {state.error && (
        <div className="k-card" style={{ padding: '16px 17px', color: '#8f2f24', fontSize: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>{state.error}</span>
          <button type="button" onClick={load} className="btn-outline btn-sm">Yritä uudelleen</button>
        </div>
      )}
      {sum && sum.totals.sessions === 0 && (
        <div className="k-card" style={{ padding: '18px 20px', fontSize: 14.5, color: '#514c42', lineHeight: 1.5 }}>
          <b>Ei vielä käyttötietoja.</b> Tiedot kertyvät, kun valmentajat ja pelaajat käyttävät Koutsia.
          {sum.testEvents > 0 && !includeTest && ` Omia ja testitilien tapahtumia on ${sum.testEvents} — näet ne valinnalla yllä.`}
        </div>
      )}
      {sum && sum.totals.sessions > 0 && <AdminUsageBody sum={sum} R={R} />}
      <p style={{ fontSize: 12.5, color: '#8a857a', lineHeight: 1.5, marginTop: 18 }}>
        Tallennetaan ilman nimeä, sähköpostia tai käyttäjätunnusta, ja tiedot poistuvat 180 päivän jälkeen.
        Valmentajia on vähän, joten valmentajapuolen käyttö voi silti olla tunnistettavissa ajankohdasta.
      </p>
    </div>
  );
}

function AdminUsagePills({ label, value, options, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }} role="group" aria-label={label}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={String(o.value)} type="button" aria-pressed={on} onClick={() => onChange(o.value)} className="k-clickable-card"
            style={{ border: on ? '1px solid var(--green-deep)' : '1px solid #d8d4ca', background: on ? 'var(--green-deep)' : '#fff', color: on ? '#fff' : '#514c42', borderRadius: 999, padding: '7px 11px', fontSize: 12, lineHeight: 1, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function AdminUsageFilters({ days, setDays, role, setRole, app, setApp, includeTest, setIncludeTest }) {
  return (
    <div className="k-card" style={{ padding: 14, marginBottom: 18, display: 'grid', gap: 10 }}>
      <AdminUsagePills label="Aikaväli" value={days} onChange={setDays} options={[{ value: 7, label: '7 pv' }, { value: 30, label: '30 pv' }, { value: 90, label: '90 pv' }, { value: 180, label: '180 pv' }]} />
      <AdminUsagePills label="Rooli" value={role} onChange={setRole} options={[{ value: 'all', label: 'Kaikki' }, { value: 'valmentaja', label: 'Valmentajat' }, { value: 'pelaaja', label: 'Pelaajat' }]} />
      <AdminUsagePills label="Sovellus" value={app} onChange={setApp} options={[{ value: 'all', label: 'Molemmat sovellukset' }, { value: 'vanha', label: 'Vanha' }, { value: 'uusi', label: 'Uusi' }]} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#514c42', cursor: 'pointer' }}>
        <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />
        Näytä omat ja testitilien käytöt
      </label>
    </div>
  );
}

const ADMIN_USAGE_HEAT = ['#EFECE3', '#D6E8DD', '#9CC7AE', '#4E9A77', '#1E6B52', '#0E3B2C'];
const adminUsagePlural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const adminUsageCard = { padding: '18px 20px', marginBottom: 18 };
const adminUsageH2 = { fontSize: 18, fontWeight: 800, color: 'var(--green-deep)', letterSpacing: -0.3, marginBottom: 4 };
const adminUsageLead = { fontSize: 13, color: '#8a857a', marginBottom: 12, lineHeight: 1.45 };

function AdminUsageWho({ row, R }) {
  const chip = (text, strong) => (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: strong ? 'rgba(14,59,44,0.1)' : '#f1efe8', color: strong ? 'var(--green-deep)' : '#514c42' }}>{text}</span>
  );
  return <span style={{ display: 'inline-flex', gap: 4 }}>{chip(R.ROLE_NAMES[row.role], row.role === 'valmentaja')}{chip(R.APP_NAMES[row.app], row.app === 'uusi')}</span>;
}

function AdminUsageRow({ title, value, max, meta, muted }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid #ebe7dd', background: '#fbfaf6', display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 700, color: muted ? '#8a857a' : '#111' }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: muted ? 'italic' : 'normal' }}>{title}</span>
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
      </div>
      {max != null && (
        <div style={{ height: 6, borderRadius: 999, background: '#efece3', overflow: 'hidden' }} aria-hidden="true">
          <span style={{ display: 'block', height: '100%', width: `${max ? Math.max(2, (Number(String(value).replace(/\D/g, '')) / max) * 100) : 0}%`, background: '#155440', borderRadius: 999 }} />
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', fontSize: 12, color: '#8a857a' }}>{meta}</div>
    </div>
  );
}

function AdminUsageBody({ sum, R }) {
  const [heatFocus, setHeatFocus] = React.useState(null);
  const [clickPath, setClickPath] = React.useState('');
  const [allViews, setAllViews] = React.useState(false);
  const [allClicks, setAllClicks] = React.useState(false);
  const devTotal = sum.devices.puhelin + sum.devices.tabletti + sum.devices.kone;
  const pct = (n) => (devTotal ? Math.round((n / devTotal) * 100) : 0);
  const weekly = sum.days.length > 45;
  const bars = [];
  sum.days.forEach((d, i) => {
    const label = d.day.split('-').reverse().slice(0, 2).join('.') + '.';
    if (!weekly) bars.push({ key: d.day, label, value: d.sessions });
    else {
      if (i % 7 === 0) bars.push({ key: d.day, label: `vko alkaen ${label}`, value: 0 });
      bars[bars.length - 1].value += d.sessions;
    }
  });
  const barMax = Math.max(1, ...bars.map((b) => b.value));
  const clickPaths = [...new Set(sum.clicks.map((c) => c.path))];
  const clicks = clickPath ? sum.clicks.filter((c) => c.path === clickPath) : sum.clicks;
  const views = allViews ? sum.views : sum.views.slice(0, 12);
  const clickList = allClicks ? clicks : clicks.slice(0, 15);
  const tile = (label, value, sub, warn) => (
    <div className="k-card" style={{ padding: '14px 16px', background: warn ? 'rgba(199,123,46,0.1)' : undefined }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: '#111', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#8a857a', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11.5, color: '#a39e92', marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const linkButton = (text, onClick) => (
    <button type="button" onClick={onClick} style={{ border: 'none', background: 'none', padding: '4px 0', color: 'var(--green-deep)', fontWeight: 700, fontSize: 13.5, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', justifySelf: 'start' }}>{text}</button>
  );

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 10 }}>
        {tile('Käyttökertoja', sum.totals.sessions, `${sum.activeDays} aktiivista päivää`)}
        {tile('Sivuja avattu', sum.totals.views)}
        {tile('Painalluksia', sum.totals.clicks)}
        {tile('Virheitä', sum.totals.errors, null, sum.totals.errors > 0)}
      </div>
      {devTotal > 0 && <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 18 }}>Laitteet: puhelin {pct(sum.devices.puhelin)} % · tietokone {pct(sum.devices.kone)} % · tabletti {pct(sum.devices.tabletti)} %</p>}

      <div className="k-card" style={adminUsageCard}>
        <h2 style={adminUsageH2}>Milloin Koutsia käytetään</h2>
        <p style={adminUsageLead}>Käyttökerrat viikonpäivän ja kellonajan mukaan, Suomen aikaa. Napauta ruutua.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '22px repeat(24, minmax(0, 1fr))', gap: 2 }} role="grid" aria-label="Käyttökerrat viikonpäivän ja kellonajan mukaan">
          <span />
          {Array.from({ length: 24 }, (_, h) => <span key={h} style={{ fontSize: 10, color: '#a39e92', lineHeight: 1 }}>{h % 6 === 0 ? h : ''}</span>)}
          {R.WEEKDAYS.map((day, d) => (
            <React.Fragment key={day}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#8a857a', alignSelf: 'center' }}>{day}</span>
              {sum.heat[d].map((v, h) => {
                const focused = heatFocus && heatFocus.d === d && heatFocus.h === h;
                return (
                  <button key={h} type="button" aria-label={`${day} klo ${h}–${h + 1}: ${v}`} title={`${day} klo ${h}–${h + 1}: ${v}`}
                    onMouseEnter={() => setHeatFocus({ d, h })} onFocus={() => setHeatFocus({ d, h })} onClick={() => setHeatFocus({ d, h })}
                    style={{ aspectRatio: '1', minHeight: 9, border: 0, padding: 0, borderRadius: 3, cursor: 'pointer', background: ADMIN_USAGE_HEAT[R.heatLevel(v, sum.heatMax)], outline: focused ? '2px solid #111' : 'none', outlineOffset: 1 }} />
                );
              })}
            </React.Fragment>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px 12px', alignItems: 'center', marginTop: 8, fontSize: 12.5, color: '#8a857a' }}>
          <span>{heatFocus ? `${R.WEEKDAYS[heatFocus.d]} klo ${heatFocus.h}–${heatFocus.h + 1}: ${adminUsagePlural(sum.heat[heatFocus.d][heatFocus.h], 'käyttökerta', 'käyttökertaa')}` : 'Mitä tummempi, sitä enemmän käyttöä.'}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11 }} aria-hidden="true">vähän {ADMIN_USAGE_HEAT.slice(1).map((c) => <i key={c} style={{ width: 11, height: 11, borderRadius: 3, background: c, display: 'inline-block' }} />)} paljon</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 72, borderBottom: '1px solid #d3cec2', marginTop: 18 }} role="img" aria-label={`Käyttökerrat ${weekly ? 'viikoittain' : 'päivittäin'}`}>
          {bars.map((b) => (
            <span key={b.key} title={`${b.label}: ${b.value}`} style={{ flex: '1 1 0', minWidth: 0, height: `${b.value ? Math.max(4, (b.value / barMax) * 100) : 0}%`, background: '#155440', borderRadius: '4px 4px 0 0' }} />
          ))}
        </div>
        <p style={{ fontSize: 12.5, color: '#8a857a', marginTop: 6 }}>Käyttökerrat {weekly ? 'viikoittain' : 'päivittäin'} (vie hiiri palkin päälle).</p>
      </div>

      <div className="k-card" style={adminUsageCard}>
        <h2 style={adminUsageH2}>Sivut</h2>
        <p style={adminUsageLead}>Montako kertaa sivu avattiin ja kauanko siinä keskimäärin viivyttiin.</p>
        <div style={{ display: 'grid', gap: 6 }}>
          {views.map((r) => (
            <AdminUsageRow key={`${r.app}${r.role}${r.path}`} title={R.routeName(r.path)} value={r.views} max={sum.views[0].views}
              meta={<><AdminUsageWho row={r} R={R} /><span>{adminUsagePlural(r.sessions, 'käyttökerta', 'käyttökertaa')}{r.seconds != null ? ` · keskim. ${R.fmtDuration(r.seconds)}` : ''}</span></>} />
          ))}
          {sum.views.length > 12 && linkButton(allViews ? 'Näytä vähemmän' : `Näytä kaikki ${sum.views.length}`, () => setAllViews(!allViews))}
        </div>
      </div>

      <div className="k-card" style={adminUsageCard}>
        <h2 style={adminUsageH2}>Eniten painetut</h2>
        <p style={adminUsageLead}>Nimiä tai muuta sisältöä sisältävät kohdat näkyvät vain tyyppinä, esim. ”Kortti (teksti piilotettu)”.</p>
        <select className="k-select" value={clickPath} onChange={(e) => setClickPath(e.target.value)} aria-label="Sivu"
          style={{ border: '1px solid #d8d4ca', borderRadius: 10, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', color: '#111', background: '#fff', marginBottom: 10, maxWidth: '100%' }}>
          <option value="">Kaikki sivut</option>
          {clickPaths.map((p) => <option key={p} value={p}>{R.routeName(p)}</option>)}
        </select>
        <div style={{ display: 'grid', gap: 6 }}>
          {clickList.map((r) => (
            <AdminUsageRow key={`${r.app}${r.role}${r.path}${r.label}${r.target}`} title={R.clickName(r)} muted={!r.label} value={r.clicks} max={clicks[0]?.clicks || 1}
              meta={<><AdminUsageWho row={r} R={R} /><span>{clickPath ? '' : `${R.routeName(r.path)} · `}{adminUsagePlural(r.sessions, 'käyttökerta', 'käyttökertaa')}</span></>} />
          ))}
          {!clicks.length && <span style={{ fontSize: 13.5, color: '#8a857a' }}>Ei vielä painalluksia.</span>}
          {clicks.length > 15 && linkButton(allClicks ? 'Näytä vähemmän' : `Näytä kaikki ${clicks.length}`, () => setAllClicks(!allClicks))}
        </div>
      </div>

      <div className="k-card" style={adminUsageCard}>
        <h2 style={adminUsageH2}>Virheet</h2>
        <p style={adminUsageLead}>Kaatumiset ja virheilmoitukset, jotka käyttäjä näki ruudulla.</p>
        {!sum.errors.length && <p style={{ fontSize: 13.5, fontWeight: 700, color: '#2d7a4d' }}>Ei virheitä tällä aikavälillä.</p>}
        <div style={{ display: 'grid', gap: 6 }}>
          {sum.errors.map((r) => (
            <AdminUsageRow key={`${r.label}${r.message}`} title={r.label} value={`${r.count}×`}
              meta={<>
                {r.message && <span style={{ flexBasis: '100%', fontSize: 13, color: '#514c42', wordBreak: 'break-word' }}>{r.message}</span>}
                {r.places.map((p) => (
                  <span key={`${p.app}${p.role}${p.path}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 6 }}><AdminUsageWho row={p} R={R} />{R.routeName(p.path)}</span>
                ))}
                <span style={{ flexBasis: '100%' }}>viimeksi {R.fmtWhen(r.lastAt)}{r.count > 1 ? ` · ensimmäisen kerran ${R.fmtWhen(r.firstAt)}` : ''}</span>
              </>} />
          ))}
        </div>
      </div>

      <div className="k-card" style={adminUsageCard}>
        <h2 style={adminUsageH2}>Viimeisimmät käyttökerrat</h2>
        <p style={adminUsageLead}>Jokainen käyttökerta tapahtumineen — ilman nimeä. Avaa rivi nähdäksesi, mitä tehtiin.</p>
        <div style={{ display: 'grid', gap: 6 }}>
          {sum.sessions.map((s) => (
            <details key={s.id} style={{ borderRadius: 12, border: '1px solid #ebe7dd', background: '#fbfaf6' }}>
              <summary style={{ cursor: 'pointer', padding: '10px 12px', display: 'grid', gap: 4 }}>
                <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#8a857a' }}>
                  <AdminUsageWho row={s} R={R} />
                  {R.DEVICE_NAMES[s.device] || s.device}
                  {s.errors > 0 && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: 'rgba(199,123,46,0.15)', color: '#7a4c1e' }}>{adminUsagePlural(s.errors, 'virhe', 'virhettä')}</span>}
                </span>
                <span style={{ fontSize: 13, color: '#514c42' }}>
                  {R.fmtWhen(s.start)} · {R.fmtDuration(s.seconds)} · {adminUsagePlural(s.views, 'sivu', 'sivua')} · {adminUsagePlural(s.clicks, 'painallus', 'painallusta')}
                </span>
              </summary>
              <ol style={{ listStyle: 'none', margin: 0, padding: '8px 12px 12px', display: 'grid', gap: 4, borderTop: '1px solid #ebe7dd' }}>
                {s.events.map((e, i) => (
                  <li key={i} style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', gap: 8, fontSize: 13, lineHeight: 1.4 }}>
                    <span style={{ color: '#a39e92', fontVariantNumeric: 'tabular-nums' }}>{R.fmtClock(e.at)}</span>
                    <span style={{ wordBreak: 'break-word', color: e.kind === 'error' ? '#8f2f24' : e.kind === 'hide' ? '#a39e92' : e.kind === 'view' ? '#111' : '#514c42', fontWeight: e.kind === 'view' || e.kind === 'error' ? 700 : 500 }}>{R.eventText(e)}</span>
                  </li>
                ))}
              </ol>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { KoutsiAdminUsage });
