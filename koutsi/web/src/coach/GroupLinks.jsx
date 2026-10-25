// GroupLinks.jsx — "Jaa ryhmälinkit": one message with every group's season link, to paste into
// myClub's notice or the group's WhatsApp, plus a big QR code to show at the first session.
// Players join themselves; the coach types no lists and sends no links one by one.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, Icon, Sheet, useToast } from '../ui/index.js';
import { CopyButton, QrCode, ShareTextButton } from '../shared/bits.jsx';
import { koutsiFmtShortDate, koutsiInviteLink, koutsiSortGroupsBySchedule } from '../domain/core.js';
import { SEASON_LINK_USES, groupLinksMessage, joinedCount, joinedTotals, seasonLinkDays, seasonLinkFor } from '../domain/groupLinks.js';
import { groupsOfSeason } from '../domain/season.js';
import { useCoach } from './CoachRoot.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

/**
 * The coach's season links: { codes, linkFor(groupId), ensure(groups) }. ensure() makes the missing
 * ones (one call per group) and reloads; an existing link is always reused, never replaced.
 */
export function useSeasonLinks(season) {
  const { coachId, acting } = useCoach();
  const [codes, setCodes] = useState(null);
  const load = useCallback(async () => {
    try { setCodes(await api.invites.list(coachId)); } catch { setCodes([]); }
  }, [coachId]);
  const ensure = useCallback(async (groups) => {
    const current = await api.invites.list(coachId);
    const missing = groups.filter((g) => !seasonLinkFor(current, g.id));
    for (const g of missing) {
      await api.invites.create(g.id, { expiresDays: seasonLinkDays(season), maxUses: SEASON_LINK_USES, coachId: acting ? coachId : null });
    }
    const next = missing.length ? await api.invites.list(coachId) : current;
    setCodes(next);
    return next;
  }, [coachId, acting, season]);
  const linkFor = useCallback((groupId) => seasonLinkFor(codes || [], groupId), [codes]);
  return { codes, load, ensure, linkFor };
}

/** The season's groups and their links in one message. `season` may be null (a coach with no seasons). */
export function GroupLinksSheet({ open, onClose, season }) {
  const { state } = useData();
  const toast = useToast();
  const groups = useMemo(() => (season ? groupsOfSeason(state, season) : koutsiSortGroupsBySchedule(state.groups)), [state, season]);
  const { ensure, linkFor, codes } = useSeasonLinks(season);
  const [busy, setBusy] = useState(false);
  const [off, setOff] = useState([]);
  const [qr, setQr] = useState(null);
  useEffect(() => {
    if (!open || !groups.length) return;
    setOff([]);
    setBusy(true);
    ensure(groups).catch((err) => toast(err)).finally(() => setBusy(false));
  }, [open, season?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = groups.map((group) => ({ group, code: linkFor(group.id)?.code || null, count: joinedCount(state, group) }));
  const chosen = rows.filter((r) => !off.includes(r.group.id));
  const message = groupLinksMessage({ coachName: state.coach.name, season, rows: chosen });
  const { joined, total } = joinedTotals(state, groups);
  const ready = codes && chosen.length > 0 && chosen.every((r) => r.code);
  return (
    <>
      <Sheet open={open} onClose={onClose} size="lg" title="Jaa ryhmälinkit"
        subtitle={`${season ? `${season.name} · ` : ''}${joined}/${total} pelaajaa liittynyt`}
        footer={<div className="sheet-actions">
          <CopyButton text={message} label="Kopioi" size="lg" variant="soft" />
          <ShareTextButton text={message} title="Liity Koutsiin" label={busy ? 'Luodaan linkkejä…' : 'Jaa viesti'} size="lg" variant="lime" />
        </div>}>
        <div className="stack-5">
          <p className="season-lead">Lähetä yksi viesti, esimerkiksi myClubin tiedotteena tai ryhmän WhatsAppiin. Jokainen liittyy oman ryhmänsä linkillä, ja linkki toimii koko kauden.</p>
          <div className="k-list">
            {rows.map((r) => {
              const on = !off.includes(r.group.id);
              const pct = r.count.total ? r.count.joined / r.count.total : 0;
              return (
                <div key={r.group.id} className={cx('gl-row', !on && 'is-off')}>
                  <label className="gl-pick">
                    <input type="checkbox" checked={on} onChange={() => setOff((p) => (p.includes(r.group.id) ? p.filter((x) => x !== r.group.id) : [...p, r.group.id]))} />
                    <span className="season-when"><b>{r.group.day}</b>{r.group.time}</span>
                    <span className="k-row-main">
                      <span className="k-row-title truncate">{r.group.name}</span>
                      <span className="gl-joined">
                        <span className="gl-bar" aria-hidden="true"><span style={{ width: `${Math.round(pct * 100)}%` }} /></span>
                        <span className="k-faint">{r.count.joined}/{r.count.total} liittynyt</span>
                      </span>
                    </span>
                  </label>
                  <Button variant="ghost" size="sm" icon="grid" disabled={!r.code} onClick={() => setQr(r)}>QR</Button>
                </div>
              );
            })}
          </div>
          <section className="stack-2">
            <div className="field-label">Viesti</div>
            <pre className="gl-message">{ready ? message : 'Luodaan linkkejä…'}</pre>
          </section>
          <p className="k-fine"><Icon name="info" size={14} /> Alaikäinen liittyy edelleen omalla henkilökohtaisella linkillä (Kutsu pelaajat). Poista viestistä juniorien ryhmät, jos haluat.</p>
        </div>
      </Sheet>
      <GroupQrSheet open={Boolean(qr)} onClose={() => setQr(null)} group={qr?.group} code={qr?.code} expiresAt={qr ? linkFor(qr.group.id)?.expiresAt : null} />
    </>
  );
}

/** A group's link as a big QR code, to show from the phone at the first session of the season. */
export function GroupQrSheet({ open, onClose, group, code, expiresAt }) {
  if (!group || !code) return null;
  const link = koutsiInviteLink(code);
  return (
    <Sheet open={open} onClose={onClose} size="md" title={group.name} subtitle={`${group.day} ${group.time} · liity ryhmään`}>
      <div className="gl-qr">
        <QrCode text={link} size={260} />
        <p className="gl-qr-help">Skannaa puhelimen kameralla, luo tunnus ja olet ryhmässä.</p>
        <div className="k-code">{code}</div>
        <p className="k-faint">koutsi.krossi.app/pelaaja · syötä koodi{expiresAt ? ` · voimassa ${koutsiFmtShortDate(String(expiresAt).slice(0, 10))} asti` : ''}</p>
        <CopyButton text={link} label="Kopioi linkki" />
      </div>
    </Sheet>
  );
}
