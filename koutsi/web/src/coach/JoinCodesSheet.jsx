// JoinCodesSheet — "Liittymiskoodini": the codes a coach hands out, in one place. Phone: Lisää;
// computer: the side nav, right above the coach's own card; also Profiili.
//   Ryhmien koodit — one code per group for the whole season (the season link, see
//     domain/groupLinks.js): the player lands straight in that group. Copy the link, show it as a
//     big QR code, or send every group's link in one message (GroupLinksSheet).
//   Oma koodi — the coach's permanent code: the player gets on the coach's list, not into a group.
// Opening the sheet makes a missing group code once (never replaces one).
import { useEffect, useMemo, useState } from 'react';
import { useData } from '../app/data.jsx';
import { Button, Icon, Segmented, Sheet, Spinner, useToast } from '../ui/index.js';
import { CopyButton } from '../shared/bits.jsx';
import { koutsiInviteLink, koutsiSortGroupsBySchedule } from '../domain/core.js';
import { joinedCount } from '../domain/groupLinks.js';
import { currentSeason, groupsOfSeason } from '../domain/season.js';
import { GroupLinksSheet, GroupQrSheet, useSeasonLinks } from './GroupLinks.jsx';
import { CoachCode } from './InvitesSheet.jsx';
import { track } from './usage.js';

export function JoinCodesSheet({ open, onClose }) {
  const { state } = useData();
  const toast = useToast();
  const season = state.seasonsReady ? currentSeason(state) : null;
  const groups = useMemo(() => (season ? groupsOfSeason(state, season) : koutsiSortGroupsBySchedule(state.groups)), [state, season]);
  const { ensure, linkFor, codes } = useSeasonLinks(season);
  const [tab, setTab] = useState('ryhmat');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [qr, setQr] = useState(null);
  const [allOpen, setAllOpen] = useState(false);
  const make = () => {
    if (!groups.length) return;
    setBusy(true); setFailed(false);
    ensure(groups).catch((err) => { setFailed(true); toast(err); }).finally(() => setBusy(false));
  };
  useEffect(() => {
    if (!open) return;
    track('liittymiskoodit.avaa');
    setTab(groups.length ? 'ryhmat' : 'oma');
    make();
  }, [open, season?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Sheet open={open} onClose={onClose} size="md" title="Liittymiskoodini" subtitle="Anna pelaajalle koodi tai linkki. Hän syöttää koodin Koutsissa tai avaa linkin.">
        <div className="stack-4">
          <Segmented options={[{ value: 'ryhmat', label: 'Ryhmien koodit', icon: 'users' }, { value: 'oma', label: 'Oma koodi', icon: 'user' }]}
            value={tab} onChange={setTab} ariaLabel="Mikä koodi" />
          {tab === 'ryhmat' ? (
            <div className="stack-4">
              <p className="k-faint">Ryhmän koodilla pelaaja pääsee <strong>suoraan ryhmään</strong>. Koodi toimii koko kauden{season ? ` (${season.name})` : ''}.</p>
              {groups.length === 0 && <p className="k-quiet-text">Sinulla ei ole vielä ryhmiä. Lisää ryhmä Viikkohallinnasta, niin sille tulee oma koodi.</p>}
              {groups.length > 0 && (
                <div className="jc-list">
                  {groups.map((g) => {
                    const code = linkFor(g.id)?.code || null;
                    const count = joinedCount(state, g);
                    return (
                      <div key={g.id} className="jc-row">
                        <div className="jc-row-main">
                          <span className="jc-when"><b>{g.day}</b> {g.time}</span>
                          <span className="jc-name truncate">{g.name}</span>
                          <span className="k-faint">{count.joined}/{count.total} liittynyt</span>
                        </div>
                        <div className="jc-row-code">
                          {code ? <span className="jc-code">{code}</span> : busy ? <Spinner size={18} /> : <span className="k-faint">—</span>}
                          <div className="jc-row-actions">
                            {code && <CopyButton text={koutsiInviteLink(code)} label="Linkki" copiedLabel="Kopioitu" variant="soft" />}
                            <Button variant="soft" size="sm" icon="grid" disabled={!code} onClick={() => setQr({ group: g, code })}>QR</Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {failed && <Button variant="outline" block icon="refresh" onClick={make}>Yritä luoda koodit uudelleen</Button>}
              {groups.length > 1 && codes && (
                <Button variant="dark" size="lg" block icon="share" onClick={() => setAllOpen(true)}>Jaa ryhmät</Button>
              )}
              <p className="k-fine"><Icon name="info" size={14} /> Alaikäinen liittyy omalla henkilökohtaisella linkillä (Pelaajat → Kutsu pelaajat).</p>
            </div>
          ) : (
            <div className="stack-3">
              <p className="k-faint">Oma koodisi ei vie ryhmään: pelaaja pääsee <strong>valmennettavaksesi</strong>, ja lisäät hänet ryhmään myöhemmin.</p>
              <CoachCode />
            </div>
          )}
        </div>
      </Sheet>
      <GroupQrSheet open={Boolean(qr)} onClose={() => setQr(null)} group={qr?.group} code={qr?.code} expiresAt={qr ? linkFor(qr.group.id)?.expiresAt : null} />
      <GroupLinksSheet open={allOpen} onClose={() => setAllOpen(false)} season={season} />
    </>
  );
}
