// JoinCodesSheet — "Liittymiskoodini": the codes a coach hands out, in one place. Phone: Lisää;
// computer: the side nav, right above the coach's own card; also Profiili.
// The coach first picks which kind of code fits; each card says in one line what it does, and the
// chosen side shows three steps "Näin se toimii" before the codes themselves.
//   Ryhmäkohtaiset — one code per group for the whole season (the season link, see
//     domain/groupLinks.js): the player lands straight in that group. Copy the link, show it as a
//     big QR code, or send every group's link in one message (GroupLinksSheet).
//   Oma koodi — the coach's permanent code: the player lands on the Pelaajat list, not in a group;
//     the coach moves them to the right group(s). Best for a player in many groups.
// Minors: the coach adds them on Pelaajat and sends each one a personal link (Kutsu pelaajat).
// Opening the sheet makes a missing group code once (never replaces one).
import { useEffect, useMemo, useState } from 'react';
import { useData } from '../app/data.jsx';
import { Button, Icon, Sheet, Spinner, useToast } from '../ui/index.js';
import { CopyButton } from '../shared/bits.jsx';
import { koutsiInviteLink, koutsiSortGroupsBySchedule } from '../domain/core.js';
import { joinedCount } from '../domain/groupLinks.js';
import { currentSeason, groupsOfSeason } from '../domain/season.js';
import { GroupLinksSheet, GroupQrSheet, useSeasonLinks } from './GroupLinks.jsx';
import { CoachCode } from './InvitesSheet.jsx';
import { openInvites } from './nav.js';
import { track } from './usage.js';

const KINDS = [
  { value: 'ryhmat', icon: 'users', title: 'Ryhmäkohtaiset', text: 'Pelaaja liittyy suoraan tiettyyn ryhmään.' },
  { value: 'oma', icon: 'user', title: 'Oma koodi', text: 'Pelaaja tulee Pelaajat-listallesi, ja sinä siirrät hänet ryhmään.' },
];

function Steps({ items }) {
  return (
    <div className="jc-how">
      <div className="jc-how-title">Näin se toimii</div>
      <ol className="jc-steps">{items.map((s, i) => <li key={i}><span>{s}</span></li>)}</ol>
    </div>
  );
}

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
  const toInvites = () => { onClose(); openInvites(); };
  return (
    <>
      <Sheet open={open} onClose={onClose} size="md" title="Liittymiskoodini" subtitle="Valitse ensin, kumman koodin annat pelaajalle.">
        <div className="stack-4">
          <div className="jc-pick" role="tablist" aria-label="Mikä koodi">
            {KINDS.map((k) => (
              <button key={k.value} type="button" role="tab" aria-selected={tab === k.value}
                className={`jc-pick-card${tab === k.value ? ' is-on' : ''}`} onClick={() => setTab(k.value)}>
                <span className="jc-pick-head">
                  <Icon name={k.icon} size={20} />
                  <span className="jc-pick-dot" aria-hidden="true" />
                </span>
                <span className="jc-pick-title">{k.title}</span>
                <span className="jc-pick-text">{k.text}</span>
              </button>
            ))}
          </div>

          {tab === 'ryhmat' ? (
            <div className="stack-4">
              <Steps items={[
                <>Lähetä pelaajalle <strong>hänen ryhmänsä</strong> koodi tai linkki. Kentällä voit näyttää QR-koodin.</>,
                <>Pelaaja syöttää koodin Koutsissa tai avaa linkin.</>,
                <>Hän on heti ryhmässä. Koodi toimii koko kauden{season ? ` (${season.name})` : ''}.</>,
              ]} />
              <p className="jc-tip">
                <Icon name="info" size={16} />
                <span>Käykö pelaaja monessa ryhmässä? Anna hänelle mieluummin <button type="button" className="jc-link" onClick={() => setTab('oma')}>oma koodi</button>.</span>
              </p>
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
            </div>
          ) : (
            <div className="stack-4">
              <Steps items={[
                <>Lähetä pelaajalle <strong>alla oleva koodi</strong> tai linkki.</>,
                <>Pelaaja syöttää koodin Koutsissa tai avaa linkin.</>,
                <>Hän ilmestyy <strong>Pelaajat-välilehdelle</strong>. Siirrä hänet sieltä oikeaan ryhmään tai ryhmiin.</>,
              ]} />
              <p className="jc-tip">
                <Icon name="info" size={16} />
                <span>Sopii parhaiten pelaajalle, joka käy monessa ryhmässä.</span>
              </p>
              <CoachCode label="Lähetä tämä koodi pelaajalle" note={false} />
            </div>
          )}

          <div className="jc-minor">
            <div className="jc-minor-text">
              <strong>Alaikäiset</strong>
              <span>Suosittelemme, että lisäät heidät itse Pelaajat-välilehdellä. Sieltä lähetät jokaiselle oman henkilökohtaisen linkin.</span>
            </div>
            <Button variant="outline" size="sm" icon="send" onClick={toInvites}>Kutsu pelaajat</Button>
          </div>
        </div>
      </Sheet>
      <GroupQrSheet open={Boolean(qr)} onClose={() => setQr(null)} group={qr?.group} code={qr?.code} expiresAt={qr ? linkFor(qr.group.id)?.expiresAt : null} />
      <GroupLinksSheet open={allOpen} onClose={() => setAllOpen(false)} season={season} />
    </>
  );
}
