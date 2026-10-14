// MerkitseUsage — Ylläpito → Käyttö: how often each Merkitse tile, quick button and save was
// tapped, so the pilot shows what coaches really use. Admins' own taps (testing) are counted
// apart. Self-contained, so it can sit as one section of a wider usage view.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { EmptyState, ErrorState, Segmented, SkeletonList } from '../ui/index.js';
import { koutsiFmtEventDate } from '../domain/timeline.js';
import { USAGE_SECTIONS } from './usage.js';

const PERIODS = [{ value: '7', label: '7 pv' }, { value: '30', label: '30 pv' }, { value: 'all', label: 'Kaikki' }];

export function MerkitseUsage() {
  const [period, setPeriod] = useState('30');
  const [s, setS] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    setS((x) => ({ ...x, loading: true, error: null }));
    try {
      setS({ data: await api.admin.usage(period === 'all' ? null : Number(period)), error: null, loading: false });
    } catch (error) {
      setS({ data: null, error, loading: false });
    }
  }, [period]);
  useEffect(() => { load(); }, [load]);

  const sections = useMemo(() => {
    const rows = new Map((s.data || []).map((r) => [r.event, r]));
    const known = new Set(USAGE_SECTIONS.flatMap((sec) => sec.events.map(([e]) => e)));
    const out = USAGE_SECTIONS.map((sec) => ({
      title: sec.title,
      rows: sec.events.map(([event, label]) => ({ event, label, ...(rows.get(event) || { clicks: 0, users: 0, adminClicks: 0, lastAt: null }) })),
    }));
    const other = (s.data || []).filter((r) => !known.has(r.event)).map((r) => ({ ...r, label: r.event }));
    if (other.length) out.push({ title: 'Muut', rows: other });
    return out;
  }, [s.data]);
  const max = Math.max(1, ...(s.data || []).map((r) => r.clicks));

  return (
    <section className="stack-4">
      <div className="row-between wrap">
        <div>
          <div className="eyebrow">Uusi Koutsi</div>
          <h2 className="k-block-title">Merkitse ja pikanapit</h2>
        </div>
        <Segmented ariaLabel="Aikaväli" size="sm" value={period} onChange={setPeriod} options={PERIODS} />
      </div>
      <p className="k-faint">Napautukset ilman ylläpitäjiä. Omat ja muiden ylläpitäjien testit näkyvät erikseen.</p>
      {s.loading && !s.data ? <SkeletonList count={4} />
        : s.error?.code === 'not_deployed' ? <EmptyState compact art="calendar" title="Seuranta ei ole vielä päällä" text={s.error.userMessage} />
          : s.error ? <ErrorState error={s.error} onRetry={load} />
            : sections.map((sec) => (
              <div key={sec.title} className="stack-2">
                <div className="field-label">{sec.title}</div>
                <ul className="admin-usage">
                  {sec.rows.map((r) => (
                    <li key={r.event} className="admin-usage-row">
                      <div className="admin-usage-head">
                        <span className="grow truncate">{r.label}</span>
                        <strong className="t-num">{r.clicks}</strong>
                      </div>
                      <div className="admin-usage-bar" aria-hidden="true"><span style={{ width: `${(r.clicks / max) * 100}%` }} /></div>
                      <div className="k-faint admin-usage-meta">
                        {r.users ? `${r.users} ${r.users === 1 ? 'käyttäjä' : 'käyttäjää'}` : 'ei vielä käyttäjiä'}
                        {r.adminClicks ? ` · ylläpito ${r.adminClicks}` : ''}
                        {r.lastAt ? ` · viimeksi ${koutsiFmtEventDate(r.lastAt)}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
    </section>
  );
}
