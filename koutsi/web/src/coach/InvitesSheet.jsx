// InvitesSheet — getting players in: each not-yet-joined player's own link (the way minors
// must join, and the way a placeholder's history follows the player), and the coach's
// permanent code for adults joining new.
import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { goBack } from '../app/router.js';
import { Avatar, Button, Disclosure, Icon, ListRow, Sheet, useConfirm, useToast } from '../ui/index.js';
import { copyText } from '../ui/effects.js';
import { CopyButton, QrCode, ShareTextButton, Quiet } from '../shared/bits.jsx';
import { koutsiInviteLink, koutsiInviteMessage } from '../domain/core.js';
import { groupsOf, unjoinedPlayers } from '../domain/week.js';
import { useCoach } from './CoachRoot.jsx';
import { GroupLinksSheet } from './GroupLinks.jsx';
import { currentSeason } from '../domain/season.js';

function PersonalInviteRow({ student, coachName, groups }) {
  const toast = useToast();
  const [state, setState] = useState('idle'); // idle | busy | sent
  const send = async () => {
    setState('busy');
    try {
      const code = await api.students.placeholderJoinCode(student.id);
      const message = koutsiInviteMessage(code, coachName, null, student.id);
      let shared = false;
      try {
        if (navigator.share) { await navigator.share({ title: 'Liity Koutsiin', text: message }); shared = true; }
      } catch (err) {
        if (err?.name === 'AbortError') { setState('idle'); return; }
      }
      if (!shared) {
        if (await copyText(message)) toast(`Viesti kopioitu — liitä se ${student.name.split(' ')[0]}lle WhatsAppiin.`, { icon: 'copy' });
        else { toast('Kopiointi ei onnistunut.', { tone: 'error' }); setState('idle'); return; }
      }
      setState('sent');
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
        <span className="k-faint truncate">{groups.map((g) => `${g.day} ${g.time}`).join(', ') || 'Ei ryhmää'}{student.ageLabel ? ` · ${student.ageLabel}` : ''}</span>
      </span>
      <Button variant={state === 'sent' ? 'soft' : 'dark'} size="sm" icon={state === 'sent' ? 'check' : 'send'} loading={state === 'busy'} onClick={send}>
        {state === 'sent' ? 'Lähetetty' : 'Lähetä'}
      </Button>
    </div>
  );
}

export function CoachCode() {
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
          <div className="field-label">Oma liittymiskoodisi</div>
          <div className="k-code">{code}</div>
          <div className="k-link-text">{link}</div>
        </div>
      </div>
      <div className="row wrap">
        <ShareTextButton text={koutsiInviteMessage(code, state.coach.name, null)} title="Liity Koutsiin" label="Jaa viesti" />
        <CopyButton text={link} label="Kopioi linkki" />
      </div>
      <p className="field-msg">Pysyvä koodi aikuiselle, joka liittyy uutena. Jos olet jo lisännyt hänet nimellä, sovellus tunnistaa hänet ja kysyy varmistuksen. <strong>Alaikäiselle lähetetään aina oma henkilökohtainen linkki.</strong></p>
      <Button variant="ghost" size="sm" icon="refresh" onClick={rotate}>Vaihda koodi</Button>
    </div>
  );
}

export function InvitesSheet() {
  const { state } = useData();
  const [open, setOpen] = useState(true);
  const [links, setLinks] = useState(false);
  const unjoined = unjoinedPlayers(state);
  return (
    <Sheet open={open} onClose={() => setOpen(false)} onClosed={() => goBack('/valmentaja/pelaajat')} size="md"
      title="Kutsu pelaajat" subtitle="Liittynyt pelaaja näkee ryhmänsä viikon teeman, treenit ja oman kehityksensä.">
      <div className="stack-5">
        {state.groups.length > 0 && (
          <div className="list-group">
            <ListRow icon="share" title="Ryhmälinkit koko kaudeksi" subtitle="Yksi viesti kaikille ryhmille — aikuiset liittyvät itse" onClick={() => setLinks(true)} />
          </div>
        )}
        <section className="stack-3">
          <div className="row-between">
            <h3 className="t-h3">Ei vielä liittyneet ({unjoined.length})</h3>
          </div>
          {unjoined.length === 0 ? <Quiet icon="check-circle">Kaikki lisäämäsi pelaajat ovat liittyneet.</Quiet> : (
            <>
              <p className="field-msg">Jokaisella on oma linkki: kun pelaaja liittyy sillä, kaikki hänelle jo kirjattu siirtyy hänelle. Napauta Lähetä, niin puhelin avaa jakovalikon (esim. WhatsApp).</p>
              <div className="k-list">
                {unjoined.map((s) => <PersonalInviteRow key={s.id} student={s} coachName={state.coach.name} groups={groupsOf(state, s.id)} />)}
              </div>
            </>
          )}
        </section>
        <Disclosure title="Pysyvä liittymiskoodi" summary="Aikuisille uusina" icon="link">
          <CoachCode />
        </Disclosure>
        <p className="k-fine"><Icon name="info" size={14} /> Ryhmäkohtaisen linkin saat ryhmän sivulta (Kutsu).</p>
      </div>
      <GroupLinksSheet open={links} onClose={() => setLinks(false)} season={state.seasonsReady ? currentSeason(state) : null} />
    </Sheet>
  );
}
