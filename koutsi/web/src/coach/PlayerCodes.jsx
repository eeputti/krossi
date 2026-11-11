// PlayerCodes — "Pelaajille" in Liittymiskoodini and Kutsu pelaajat (JoinCodes): the coach's players as on the
// Pelaajat page, in the same order (under the session nearest to now, then everyone else by name;
// a search lists matches by name). Every player who hasn't joined yet has an own code: with it the
// player joins every group the coach put them in, and everything already written for them follows
// (the same link as Kutsu pelaajat). A tap on a player opens their code; it is fetched only then
// (one call, not one per row), and the share button shows once it is here, because an iPhone only
// shares right on a tap, not after waiting for the network.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Avatar, Button, Chip, Icon, Input, Segmented, Spinner } from '../ui/index.js';
import { CopyButton, QrCode, Quiet, ShareTextButton } from '../shared/bits.jsx';
import { koutsiInviteLink, koutsiInviteMessage, koutsiTodayStr } from '../domain/core.js';
import { matchStudents } from '../domain/roster.js';
import { groupsOf, playerSections, sectionWhen } from '../domain/week.js';
import { AddPlayerSheet } from './playerForms.jsx';
import { ShowQrSheet } from './joinHelp.jsx';
import { playerPath } from './nav.js';

const byName = (a, b) => a.name.localeCompare(b.name, 'fi');
const where = (groups) => (groups.length > 1 ? 'kaikkiin ryhmiinsä' : groups.length ? 'oikeaan ryhmään' : 'valmennukseesi');

function PlayerCode({ student, groups, onQr, onOpenPlayer }) {
  const { state } = useData();
  const [code, setCode] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!student.isPlaceholder) return undefined;
    let alive = true;
    setCode(null); setError('');
    api.students.placeholderJoinCode(student.id)
      .then((c) => { if (!alive) return; if (c) setCode(c); else setError('Liittymiskoodia ei löytynyt. Päivitä sivu.'); })
      .catch((err) => { if (alive) setError(err?.userMessage || 'Koodin haku ei onnistunut. Yritä uudelleen.'); });
    return () => { alive = false; };
  }, [student.id, student.isPlaceholder]);
  const link = code ? koutsiInviteLink(code, student.id) : '';
  return (
    <div className="pc-body stack-3">
      <div className="pc-groups">
        <div className="field-label">{!groups.length ? 'Ei vielä ryhmissä' : student.isPlaceholder ? (groups.length === 1 ? 'Liittyy ryhmään' : 'Liittyy ryhmiin') : (groups.length === 1 ? 'Ryhmä' : 'Ryhmät')}</div>
        {groups.length > 0 && <ul className="pc-group-list">{groups.map((g) => <li key={g.id}><b>{g.day} {g.time}</b>{g.name}</li>)}</ul>}
        {!groups.length && (
          <div className="stack-2">
            <p className="k-quiet-text">{student.name} ei ole vielä missään ryhmässä. Lisää hänet ryhmään pelaajan sivulla{student.isPlaceholder ? ', niin hän pääsee sinne tällä samalla koodilla' : ''}.</p>
            <div><Button variant="outline" size="sm" icon="arrow-right" onClick={() => onOpenPlayer(student.id)}>Avaa pelaajan sivu</Button></div>
          </div>
        )}
      </div>
      {!student.isPlaceholder ? (
        <p className="jc-tip"><Icon name="check-circle" size={16} /><span>{student.name} on jo liittynyt ja näkee ryhmänsä. Koodia ei tarvita.</span></p>
      ) : (
        <>
          {error && <p className="field-msg field-msg-error">{error}</p>}
          {!code && !error && <Spinner size={18} />}
          {code && (
            <div className="pc-code stack-3">
              <div className="k-invite-head">
                <QrCode text={link} size={104} />
                <div className="stack-2">
                  <div className="field-label">Pelaajan oma koodi</div>
                  <div className="k-code">{code}</div>
                  <div className="k-link-text">{link}</div>
                </div>
              </div>
              <div className="row wrap">
                <ShareTextButton text={koutsiInviteMessage(code, state.coach.name, null, student.id)} title="Liity Koutsiin" label="Jaa viesti" />
                <CopyButton text={link} label="Kopioi linkki" />
                <Button variant="soft" size="sm" icon="grid" onClick={() => onQr({ student, groups, code })}>Näytä isona</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PlayerItem({ student, open, onToggle, scrollTo, ...rest }) {
  const ref = useRef(null);
  useEffect(() => { if (open && scrollTo) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [open, scrollTo]);
  const groups = rest.groups;
  return (
    <div ref={ref} className={`pc-item${open ? ' is-open' : ''}`}>
      <button type="button" className="k-row k-player-row pc-head" aria-expanded={open} onClick={onToggle}>
        <Avatar person={student} name={student.name} src={student.avatarUrl} size={42} />
        <span className="k-row-main">
          <span className="k-row-title truncate">{student.name}</span>
          <span className="k-row-sub truncate">{groups.length ? groups.map((g) => `${g.day} ${g.time}`).join(', ') : 'Ei ryhmää'}</span>
        </span>
        {student.isPlaceholder ? <Chip tone="warn" size="sm">Ei liittynyt</Chip> : <Chip tone="success" size="sm">Liittynyt</Chip>}
        <Icon name="chevron-down" size={18} className="k-chevron pc-chev" />
      </button>
      {open && <PlayerCode student={student} {...rest} />}
    </div>
  );
}

export function PlayerCodes({ onClose, initialFilter = 'all' }) {
  const { state } = useData();
  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [added, setAdded] = useState(null);
  const [qr, setQr] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const today = koutsiTodayStr();
  const unjoined = state.students.filter((s) => s.isPlaceholder).length;
  const pass = (s) => filter === 'all' || s.isPlaceholder;
  const nearest = useMemo(() => playerSections(state), [state]);
  const searched = query.trim() ? matchStudents(state.students, query, { limit: 500 }).filter(pass).sort(byName) : null;
  const sections = nearest.sections
    .map((sec) => ({ ...sec, players: sec.players.filter((p) => pass(p.student)) }))
    .filter((sec) => sec.players.length);
  const rest = nearest.rest.filter((p) => pass(p.student));
  const openPlayer = (id) => { onClose(); navigate(playerPath(id)); };
  const item = (s) => (
    <PlayerItem key={s.id} student={s} groups={groupsOf(state, s.id)} open={openId === s.id} scrollTo={added === s.id}
      onToggle={() => { setAdded(null); setOpenId(openId === s.id ? null : s.id); }} onQr={setQr} onOpenPlayer={openPlayer} />
  );
  return (
    <div className="stack-3">
      {state.students.length === 0 ? (
        <Quiet icon="user">Sinulla ei ole vielä pelaajia. Lisää pelaaja, niin hänelle tulee oma koodi.</Quiet>
      ) : (
        <>
          {state.students.length > 5 && <Input icon="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hae nimellä" aria-label="Hae pelaajaa" />}
          <Segmented ariaLabel="Suodata pelaajat" value={filter} onChange={setFilter} options={[
            { value: 'all', label: 'Kaikki', badge: state.students.length },
            { value: 'unjoined', label: 'Ei liittynyt', badge: unjoined || undefined },
          ]} />
          {searched ? (
            searched.length === 0 ? <p className="k-quiet">Ei osumia.</p> : <div className="k-list">{searched.map(item)}</div>
          ) : sections.length + rest.length === 0 ? (
            <Quiet icon="check-circle">Kaikki pelaajasi ovat jo liittyneet.</Quiet>
          ) : (
            <div className="k-psecs">
              {sections.map((sec, i) => {
                const when = sectionWhen(sec, today);
                const same = i > 0 && sectionWhen(sections[i - 1], today) === when;
                const name = sec.group ? sec.group.name : [sec.training.type, sec.student?.name].filter(Boolean).join(', ');
                return (
                  <section key={sec.training.id} className="k-psec">
                    <div className="k-psec-head is-static">
                      <span className="k-psec-text">
                        {!same && <span className="k-psec-when">{when}</span>}
                        <span className="k-psec-title truncate"><span className="t-num">{sec.training.time}–{sec.end}</span> {name}</span>
                      </span>
                    </div>
                    <div className="k-list">{sec.players.map((p) => item(p.student))}</div>
                  </section>
                );
              })}
              {rest.length > 0 && (
                <section className="k-psec">
                  <div className="k-psec-head is-static">
                    <span className="k-psec-text"><span className="k-psec-when">{sections.length ? 'Muut pelaajat' : 'Ei treenejä viikon sisällä'}</span></span>
                  </div>
                  <div className="k-list">{rest.map((p) => item(p.student))}</div>
                </section>
              )}
            </div>
          )}
        </>
      )}
      <button type="button" className="k-row jc-add" onClick={() => setAddOpen(true)}>
        <span className="jc-add-icon"><Icon name="plus" size={18} /></span>
        <span className="k-row-main">
          <span className="k-row-title">Lisää pelaaja</span>
          <span className="k-row-sub">Puuttuuko joku? Lisää hänet, niin hänelle tulee oma koodi.</span>
        </span>
      </button>
      <ShowQrSheet open={Boolean(qr)} onClose={() => setQr(null)} title={qr?.student.name} subtitle="Pelaajan oma koodi"
        lead={qr && <>Näytä tämä pelaajalle <strong>{qr.student.name}</strong>, niin hän pääsee {where(qr.groups)}.</>}
        help="Hän skannaa koodin puhelimen kameralla ja luo tunnuksen."
        link={qr ? koutsiInviteLink(qr.code, qr.student.id) : ''} code={qr?.code} />
      <AddPlayerSheet open={addOpen} onClose={() => setAddOpen(false)} onDone={(id) => { setQuery(''); setFilter('all'); setAdded(id); setOpenId(id); }} />
    </div>
  );
}
