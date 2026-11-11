// JoinCodesSheet — "Liittymiskoodini": the codes a coach hands out, in one place. Phone: Lisää;
// computer: the side nav, right above the coach's own card; also Profiili.
// The coach first picks which kind of code fits; each card says in one line what it does, and the
// chosen side shows three steps "Näin se toimii" before the codes themselves.
//   Ryhmäkohtaiset — one code per group for the whole season (the season link, see
//     domain/groupLinks.js): the player lands straight in that group. Copy the link, show it as a
//     big QR code, or send every group's link in one message (GroupLinksSheet).
//   Oma koodi — the coach's permanent code: the player lands on the Pelaajat list, not in a group;
//     the coach moves them to the right group(s). Best for a player in many groups.
// Kutsu pelaajat (InvitesSheet) shows the same codes plus a third kind:
//   Henkilökohtaiset — each player the coach added by name and who hasn't joined yet gets their own
//     link (the way minors must join; what was logged for them follows them).
// Minors: the coach adds them on Pelaajat and sends each one a personal link.
// Opening the sheet makes a missing group code once (never replaces one).
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Avatar, Button, Icon, Sheet, Spinner, useConfirm, useToast } from '../ui/index.js';
import { copyText } from '../ui/effects.js';
import { CopyButton, QrCode, Quiet, ShareTextButton } from '../shared/bits.jsx';
import { koutsiInviteLink, koutsiInviteMessage, koutsiSortGroupsBySchedule } from '../domain/core.js';
import { joinedCount } from '../domain/groupLinks.js';
import { currentSeason, groupsOfSeason } from '../domain/season.js';
import { groupsOf, unjoinedPlayers } from '../domain/week.js';
import { useCoach } from './CoachRoot.jsx';
import { GroupLinksSheet, GroupQrSheet, useSeasonLinks } from './GroupLinks.jsx';
import { HowSteps, MinorsNote } from './joinHelp.jsx';
import { track } from './usage.js';

const KINDS = [
  { value: 'ryhmat', icon: 'users', title: 'Ryhmäkohtaiset', text: 'Pelaaja liittyy suoraan tiettyyn ryhmään.' },
  { value: 'oma', icon: 'user', title: 'Oma koodi', text: 'Pelaaja tulee Pelaajat-listallesi, ja sinä siirrät hänet ryhmään.' },
];
// the soft hyphen lets the title break as "Henkilö-kohtaiset" in a narrow card
const PERSONAL = { value: 'henk', icon: 'send', title: 'Henkilö­kohtaiset', text: 'Jo lisäämällesi pelaajalle. Alaikäiselle aina tämä.' };

function PersonalInviteRow({ student, coachName, groups }) {
  const toast = useToast();
  const [state, setState] = useState('idle'); // idle | busy | ready | sent
  // The code is fetched before the tap: an iPhone only lets a tap share or copy right away, not
  // after waiting for the network. If it isn't here yet, the first tap fetches it and the button
  // becomes "Jaa nyt" for a second tap.
  const [code, setCode] = useState(null);
  useEffect(() => {
    let alive = true;
    api.students.placeholderJoinCode(student.id).then((c) => { if (alive && c) setCode(c); }).catch(() => {});
    return () => { alive = false; };
  }, [student.id]);
  const copyInstead = async (message) => {
    if (await copyText(message)) { toast(`Viesti kopioitu — liitä se ${student.name.split(' ')[0]}lle WhatsAppiin.`, { icon: 'copy' }); setState('sent'); }
    else { toast('Kopiointi ei onnistunut. Avaa pelaajan sivu ja kopioi linkki sieltä.', { tone: 'error' }); setState(code ? 'idle' : 'ready'); }
  };
  const shareNow = (c) => {
    const message = koutsiInviteMessage(c, coachName, null, student.id);
    if (navigator.share) {
      navigator.share({ title: 'Liity Koutsiin', text: message })
        .then(() => setState('sent'))
        .catch((err) => { if (err?.name === 'AbortError') setState('idle'); else copyInstead(message); });
      return;
    }
    copyInstead(message);
  };
  const send = async () => {
    if (code) { shareNow(code); return; }
    setState('busy');
    try {
      const c = await api.students.placeholderJoinCode(student.id);
      if (!c) throw new Error('Liittymiskoodia ei löytynyt. Päivitä sivu.');
      setCode(c);
      setState('ready');
    } catch (err) {
      toast(err);
      setState('idle');
    }
  };
  return (
    <div className="k-invite-row">
      <Avatar person={student} size={36} />
      <span className="grow">
        <span className="k-row-title truncate">{student.name}</span>
        <span className="k-faint truncate">{groups.map((g) => `${g.day} ${g.time}`).join(', ') || 'Ei ryhmää'}{student.ageLabel ? `, ${student.ageLabel}` : ''}</span>
      </span>
      <Button variant={state === 'sent' ? 'soft' : state === 'ready' ? 'lime' : 'dark'} size="sm" icon={state === 'sent' ? 'check' : 'send'} loading={state === 'busy'} onClick={send}>
        {state === 'sent' ? 'Lähetetty' : state === 'ready' ? 'Jaa nyt' : 'Lähetä'}
      </Button>
    </div>
  );
}

/** The coach's permanent code: QR, the code big, the link, share + copy, and "Vaihda koodi". */
export function CoachCode({ label = 'Oma liittymiskoodisi', note = true }) {
  const { state } = useData();
  const { coachId } = useCoach();
  const toast = useToast();
  const confirm = useConfirm();
  const [code, setCode] = useState(null);
  const [error, setError] = useState('');
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
      </div>
      {note && <p className="field-msg">Pysyvä koodi aikuiselle, joka liittyy uutena. Jos olet jo lisännyt hänet nimellä, sovellus tunnistaa hänet ja kysyy varmistuksen. <strong>Alaikäiselle lähetetään aina oma henkilökohtainen linkki.</strong></p>}
      <Button variant="ghost" size="sm" icon="refresh" onClick={rotate}>Vaihda koodi</Button>
    </div>
  );
}

/**
 * The picker and the codes, shared by Liittymiskoodini and Kutsu pelaajat. `withPersonal` adds the
 * third kind (each not-yet-joined player's own link); `startTab` opens on a kind ('henk' from
 * "Lähetä kutsut"). Renders its own QR and "Jaa ryhmät" sheets.
 */
export function JoinCodes({ open, onClose, withPersonal = false, startTab = null }) {
  const { state } = useData();
  const toast = useToast();
  const season = state.seasonsReady ? currentSeason(state) : null;
  const groups = useMemo(() => (season ? groupsOfSeason(state, season) : koutsiSortGroupsBySchedule(state.groups)), [state, season]);
  const unjoined = useMemo(() => (withPersonal ? unjoinedPlayers(state) : []), [state, withPersonal]);
  const { ensure, linkFor, codes } = useSeasonLinks(season);
  const kinds = withPersonal ? [...KINDS, PERSONAL] : KINDS;
  const firstTab = () => (kinds.some((k) => k.value === startTab) ? startTab : groups.length ? 'ryhmat' : 'oma');
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
    if (!withPersonal) track('liittymiskoodit.avaa');
    setTab(firstTab());
    make();
  }, [open, season?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // from the minors note at the bottom: switch to the personal links and show the picker again
  const showPersonal = () => {
    setTab('henk');
    pickRef.current?.closest('.sheet-body')?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return (
    <>
      <div className="stack-4">
        <div ref={pickRef} className={`jc-pick${withPersonal ? ' is-three' : ''}`} role="tablist" aria-label="Mikä koodi">
          {kinds.map((k) => (
            <button key={k.value} type="button" role="tab" aria-selected={tab === k.value}
              className={`jc-pick-card${tab === k.value ? ' is-on' : ''}`} onClick={() => setTab(k.value)}>
              <span className="jc-pick-head">
                <Icon name={k.icon} size={20} />
                {k.value === 'henk' && unjoined.length > 0 && <span className="jc-pick-count" aria-label={`${unjoined.length} ei vielä liittynyt`}>{unjoined.length}</span>}
                <span className="jc-pick-dot" aria-hidden="true" />
              </span>
              <span className="jc-pick-title">{k.title}</span>
              <span className="jc-pick-text">{k.text}</span>
            </button>
          ))}
        </div>

        {tab === 'ryhmat' && (
          <div className="stack-4">
            <HowSteps items={[
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
        )}

        {tab === 'oma' && (
          <div className="stack-4">
            <HowSteps items={[
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

        {tab === 'henk' && (
          <div className="stack-4">
            <HowSteps items={[
              <>Lisää pelaaja ensin nimellä <strong>Pelaajat-välilehdellä</strong>.</>,
              <>Lähetä hänelle alta <strong>oma linkki</strong>. Puhelin avaa jakovalikon, esimerkiksi WhatsAppin.</>,
              <>Kun hän liittyy, kaikki hänelle jo kirjattu siirtyy hänelle.</>,
            ]} />
            <p className="jc-tip">
              <Icon name="info" size={16} />
              <span>Alaikäinen liittyy aina näin, omalla linkillään.</span>
            </p>
            {unjoined.length === 0 ? <Quiet icon="check-circle">Kaikki lisäämäsi pelaajat ovat liittyneet.</Quiet> : (
              <section className="stack-2">
                <div className="field-label">Ei vielä liittyneet ({unjoined.length})</div>
                <div className="k-list">
                  {unjoined.map((s) => <PersonalInviteRow key={s.id} student={s} coachName={state.coach.name} groups={groupsOf(state, s.id)} />)}
                </div>
              </section>
            )}
          </div>
        )}

        {tab !== 'henk' && <MinorsNote onClose={onClose} onPersonal={withPersonal ? showPersonal : null} />}
      </div>
      <GroupQrSheet open={Boolean(qr)} onClose={() => setQr(null)} group={qr?.group} code={qr?.code} expiresAt={qr ? linkFor(qr.group.id)?.expiresAt : null} />
      <GroupLinksSheet open={allOpen} onClose={() => setAllOpen(false)} season={season} />
    </>
  );
}

export function JoinCodesSheet({ open, onClose }) {
  return (
    <Sheet open={open} onClose={onClose} size="md" title="Liittymiskoodini" subtitle="Valitse ensin, kumman koodin annat pelaajalle.">
      <JoinCodes open={open} onClose={onClose} />
    </Sheet>
  );
}
