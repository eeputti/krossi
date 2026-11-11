// JoinCodesSheet — "Liittymiskoodini": the codes a coach hands out, in one place. Phone: Lisää;
// computer: the side nav, right above the coach's own card; also Profiili. Kutsu pelaajat
// (InvitesSheet) shows the same picker and codes (JoinCodes).
// The coach first picks who the code is for (three short cards side by side); the chosen side
// shows three steps "Näin se toimii" before the codes themselves.
//   Pelaajille — each player's own code (PlayerCodes, the players as on Pelaajat): the player
//     joins every group the coach put them in, and what was logged for them follows. Minors
//     always join this way.
//   Ryhmille — one code per group for the whole season (the season link, see
//     domain/groupLinks.js): the player lands straight in that group. Copy the link, show it as a
//     big QR code, or send every group's link in one message (GroupLinksSheet).
//   Kaikille — the coach's permanent code, the same for everyone: the player lands on the
//     Pelaajat list, not in a group; the coach moves them to the right group(s).
// Opening the sheet makes a missing group code once (never replaces one).
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Button, Icon, Sheet, Spinner, useConfirm, useToast } from '../ui/index.js';
import { CopyButton, QrCode, Quiet, ShareTextButton } from '../shared/bits.jsx';
import { koutsiInviteLink, koutsiInviteMessage, koutsiSortGroupsBySchedule } from '../domain/core.js';
import { joinedCount } from '../domain/groupLinks.js';
import { currentSeason, groupsOfSeason } from '../domain/season.js';
import { unjoinedPlayers } from '../domain/week.js';
import { useCoach } from './CoachRoot.jsx';
import { GroupLinksSheet, GroupQrSheet, useSeasonLinks } from './GroupLinks.jsx';
import { HowSteps, MinorsNote, ShowQrSheet } from './joinHelp.jsx';
import { PlayerCodes } from './PlayerCodes.jsx';
import { track } from './usage.js';

// short names so all three fit side by side on a phone; 'henk' stays the value (?tapa=henk)
const KINDS = [
  { value: 'henk', icon: 'user', title: 'Pelaajille', text: 'Oma koodi jokaiselle' },
  { value: 'ryhmat', icon: 'users', title: 'Ryhmille', text: 'Oma koodi joka ryhmälle' },
  { value: 'oma', icon: 'link', title: 'Kaikille', text: 'Sama koodi kaikille' },
];

/** The coach's permanent code (the same for everyone): QR, the code big, the link, share + copy, big QR, and "Vaihda koodi". */
export function CoachCode({ label = 'Oma liittymiskoodisi', note = true }) {
  const { state } = useData();
  const { coachId } = useCoach();
  const toast = useToast();
  const confirm = useConfirm();
  const [code, setCode] = useState(null);
  const [error, setError] = useState('');
  const [big, setBig] = useState(false);
  useEffect(() => {
    let alive = true;
    api.invites.myJoinCode(coachId).then((c) => { if (alive) { if (c) setCode(c); else setError('Liittymiskoodia ei löytynyt. Päivitä sivu.'); } }).catch((err) => alive && setError(err.userMessage));
    return () => { alive = false; };
  }, [coachId]);
  const rotate = async () => {
    if (!(await confirm({ title: 'Vaihda liittymiskoodi?', message: 'Nykyinen koodi lakkaa toimimasta heti. Jo liittyneet pelaajat pysyvät valmennuksessasi.', confirmLabel: 'Vaihda koodi', danger: true }))) return;
    try { setCode(await api.invites.rotateJoinCode()); toast('Koodi vaihdettu.'); } catch (err) { toast(err); }
  };
  if (error) return <p className="field-msg field-msg-error">{error}</p>;
  if (!code) return <Quiet>Haetaan koodia…</Quiet>;
  const link = koutsiInviteLink(code);
  return (
    <div className="k-invite stack-3">
      <div className="k-invite-head">
        <QrCode text={link} size={132} />
        <div className="stack-2">
          <div className="field-label">{label}</div>
          <div className="k-code">{code}</div>
          <div className="k-link-text">{link}</div>
        </div>
      </div>
      <div className="row wrap">
        <ShareTextButton text={koutsiInviteMessage(code, state.coach.name, null)} title="Liity Koutsiin" label="Jaa viesti" />
        <CopyButton text={link} label="Kopioi linkki" />
        <Button variant="soft" size="sm" icon="grid" onClick={() => setBig(true)}>Näytä isona</Button>
      </div>
      {note && <p className="field-msg">Pysyvä koodi aikuiselle, joka liittyy uutena. Jos olet jo lisännyt hänet nimellä, sovellus tunnistaa hänet ja kysyy varmistuksen. <strong>Alaikäiselle lähetetään aina oma henkilökohtainen linkki.</strong></p>}
      <Button variant="ghost" size="sm" icon="refresh" onClick={rotate}>Vaihda koodi</Button>
      <ShowQrSheet open={big} onClose={() => setBig(false)} title="Koodi kaikille" subtitle="Valmentajakohtainen koodi, sama kaikille pelaajille"
        lead={<>Tämä koodi käy <strong>kaikille</strong>. Näytä se kenelle tahansa pelaajallesi, niin hän pääsee Pelaajat-listallesi.</>}
        help="Pelaaja skannaa koodin puhelimen kameralla ja luo tunnuksen. Siirrä hänet sitten oikeaan ryhmään."
        link={link} code={code} />
    </div>
  );
}

/**
 * The picker and the codes, shared by Liittymiskoodini and Kutsu pelaajat. `startTab` opens on a
 * kind; `unjoinedFirst` ("Lähetä kutsut") lists only the players who haven't joined yet.
 * Renders its own QR and "Jaa ryhmät" sheets.
 */
export function JoinCodes({ open, onClose, startTab = null, unjoinedFirst = false, usage = null }) {
  const { state } = useData();
  const toast = useToast();
  const season = state.seasonsReady ? currentSeason(state) : null;
  const groups = useMemo(() => (season ? groupsOfSeason(state, season) : koutsiSortGroupsBySchedule(state.groups)), [state, season]);
  const unjoined = useMemo(() => unjoinedPlayers(state), [state]);
  const { ensure, linkFor, codes } = useSeasonLinks(season);
  const firstTab = () => (KINDS.some((k) => k.value === startTab) ? startTab : 'henk');
  const [tab, setTab] = useState(firstTab);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [qr, setQr] = useState(null);
  const [allOpen, setAllOpen] = useState(false);
  const pickRef = useRef(null);
  const make = () => {
    if (!groups.length) return;
    setBusy(true); setFailed(false);
    ensure(groups).catch((err) => { setFailed(true); toast(err); }).finally(() => setBusy(false));
  };
  useEffect(() => {
    if (!open) return;
    if (usage) track(usage);
    setTab(firstTab());
    make();
  }, [open, season?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // from a tip or the minors note further down: switch to Pelaajille and show the picker again
  const showPersonal = () => {
    setTab('henk');
    pickRef.current?.closest('.sheet-body')?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const toPersonal = <button type="button" className="jc-link" onClick={showPersonal}>Pelaajille</button>;
  return (
    <>
      <div className="stack-4">
        <div ref={pickRef} className="jc-pick" role="tablist" aria-label="Kenelle koodi on">
          {KINDS.map((k) => (
            <button key={k.value} type="button" role="tab" aria-selected={tab === k.value}
              className={`jc-pick-card${tab === k.value ? ' is-on' : ''}`} onClick={() => setTab(k.value)}>
              <span className="jc-pick-head">
                <span className="jc-pick-icon"><Icon name={k.icon} size={17} /></span>
                {k.value === 'henk' && unjoined.length > 0 && <span className="jc-pick-count" aria-label={`${unjoined.length} ei vielä liittynyt`}>{unjoined.length}</span>}
                <span className="jc-pick-dot" aria-hidden="true" />
              </span>
              <span className="jc-pick-title">{k.title}</span>
              <span className="jc-pick-text">{k.text}</span>
            </button>
          ))}
        </div>

        {tab === 'henk' && (
          <div className="stack-4">
            <HowSteps items={[
              <>Jokaisella pelaajalla on oma koodi. Valitse pelaaja listalta ja lähetä <strong>hänen koodinsa</strong> tai näytä se kentällä isona.</>,
              <>Pelaaja syöttää koodin Koutsissa tai avaa linkin.</>,
              <>Hän on heti <strong>kaikissa ryhmissä</strong>, joihin olet hänet lisännyt. Kaikki hänelle jo kirjattu siirtyy hänelle.</>,
            ]} />
            <p className="jc-tip">
              <Icon name="info" size={16} />
              <span>Alaikäiselle lähetetään aina oma koodi täältä.</span>
            </p>
            <PlayerCodes onClose={onClose} initialFilter={unjoinedFirst && unjoined.length ? 'unjoined' : 'all'} />
          </div>
        )}

        {tab === 'ryhmat' && (
          <div className="stack-4">
            <HowSteps items={[
              <>Jokaisella ryhmällä on oma koodi. Lähetä <strong>ryhmän koodi</strong> ryhmäläisille tai näytä se kentällä isona.</>,
              <>Pelaaja syöttää koodin Koutsissa tai avaa linkin.</>,
              <>Hän on heti oikeassa ryhmässä. Koodi toimii koko kauden{season ? ` (${season.name})` : ''}.</>,
            ]} />
            <p className="jc-tip">
              <Icon name="info" size={16} />
              <span>Käykö pelaaja monessa ryhmässä? Lähetä hänelle mieluummin oma koodi kohdasta {toPersonal}.</span>
            </p>
            {groups.length === 0 && <p className="k-quiet-text">Sinulla ei ole vielä ryhmiä. Lisää ryhmä, niin sille tulee oma koodi.</p>}
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
            <button type="button" className="k-row jc-add" onClick={() => { onClose(); navigate('/valmentaja/ryhmalista?uusi=1'); }}>
              <span className="jc-add-icon"><Icon name="plus" size={18} /></span>
              <span className="k-row-main">
                <span className="k-row-title">Lisää ryhmä</span>
                <span className="k-row-sub">Vie Ryhmät-sivulle. Uudelle ryhmälle tulee oma koodi.</span>
              </span>
            </button>
          </div>
        )}

        {tab === 'oma' && (
          <div className="stack-4">
            <HowSteps items={[
              <>Lähetä tai näytä <strong>alla oleva koodi</strong>. Sama koodi käy kaikille pelaajillesi.</>,
              <>Pelaaja syöttää koodin Koutsissa tai avaa linkin.</>,
              <>Hän ilmestyy <strong>Pelaajat-välilehdelle</strong>. Siirrä hänet sieltä oikeaan ryhmään tai ryhmiin.</>,
            ]} />
            <p className="jc-tip">
              <Icon name="info" size={16} />
              <span>Sopii uudelle pelaajalle, jota et ole vielä lisännyt. Jos hän on jo listallasi, lähetä hänelle oma koodi kohdasta {toPersonal}.</span>
            </p>
            <CoachCode label="Valmentajan koodi, sama kaikille" note={false} />
          </div>
        )}

        {tab !== 'henk' && <MinorsNote onClose={onClose} onPersonal={showPersonal} />}
      </div>
      <GroupQrSheet open={Boolean(qr)} onClose={() => setQr(null)} group={qr?.group} code={qr?.code} expiresAt={qr ? linkFor(qr.group.id)?.expiresAt : null} />
      <GroupLinksSheet open={allOpen} onClose={() => setAllOpen(false)} season={season} />
    </>
  );
}

export function JoinCodesSheet({ open, onClose }) {
  return (
    <Sheet open={open} onClose={onClose} size="md" title="Liittymiskoodini" subtitle="Valitse ensin, kenelle koodi on.">
      <JoinCodes open={open} onClose={onClose} usage="liittymiskoodit.avaa" />
    </Sheet>
  );
}
