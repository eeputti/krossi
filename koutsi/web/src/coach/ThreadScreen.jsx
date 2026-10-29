// ThreadScreen — the coach's conversation with one player (/valmentaja/viestit/:playerId), full screen
// on a phone. Above it the player's facts at a glance (Alpo 25.10.: "näe pelaajan tiedot"):
// attendance this month, the next session, the feeling, and the player's Toive — a tap on it quotes it
// in the reply. ⋯ opens the player page or turns messages off for this player.
import { useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { goBack, navigate } from '../app/router.js';
import { Button, Chip, EmptyState, IconButton, ListRow, Page, Sheet, TopBar, useToast } from '../ui/index.js';
import { useMessages } from '../shared/messages/MessagesProvider.jsx';
import { Chat } from '../shared/messages/Chat.jsx';
import { parseRef, refQuote } from '../domain/messages.js';
import { playerMonthFacts } from '../domain/glance.js';
import { upcomingSessions } from '../domain/player.js';
import { relativeDay } from '../domain/week.js';
import { allative, groupLine, TurnOnSheet } from './MessagesScreen.jsx';
import { messagesPath, playerPath } from './nav.js';
import { track } from './usage.js';

const dec = (x) => (x == null ? null : x.toFixed(1).replace('.', ','));

function Facts({ state, student, onQuoteWish }) {
  const now = new Date();
  const facts = useMemo(() => playerMonthFacts(state, student, now.getFullYear(), now.getMonth(), now).current, [state, student]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = upcomingSessions(state, student.id, now)[0] || null;
  const wish = (student.wishHistory || [])[0];
  return (
    <div className="msg-context" aria-label="Pelaajan tiedot">
      {student.isPlaceholder && <Chip tone="warn" size="md" icon="info"><span>Ei vielä liittynyt</span></Chip>}
      {facts.held > 0 && <Chip size="md" icon="check-circle"><span>Läsnä {facts.present}/{facts.held}, {facts.rate}&nbsp;%</span></Chip>}
      {next && <Chip size="md" icon="calendar"><span>Seuraava {relativeDay(next.date).toLowerCase()} {next.time}</span></Chip>}
      {facts.moodAverage != null && <Chip size="md" icon="heart"><span>Fiilis {dec(facts.moodAverage)}</span></Chip>}
      {student.playerWish && wish && (
        <button type="button" className="chip chip-lime chip-md msg-context-wish" onClick={() => onQuoteWish(wish)} title="Lainaa toive vastaukseen">
          <span>Toive: {student.playerWish}</span>
        </button>
      )}
    </div>
  );
}

export function ThreadScreen({ params, query }) {
  const { state } = useData();
  const m = useMessages();
  const toast = useToast();
  const student = state.students.find((s) => s.id === params.id) || null;
  const thread = student ? m.byStudent(student.id) : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [turnOnOpen, setTurnOnOpen] = useState(false);
  const [quote, setQuote] = useState(() => parseRef(query?.vastaa));
  const back = () => goBack(messagesPath);

  if (!student) {
    return (
      <>
        <TopBar title="Viestit" back={messagesPath} />
        <Page><EmptyState art="search" title="Pelaajaa ei löytynyt" text="Valmennus on ehkä päättynyt." /></Page>
      </>
    );
  }
  if (m.loaded && (!m.ready || !m.enabled || !thread || !thread.enabled)) {
    return (
      <>
        <TopBar title={student.name} back={messagesPath} />
        <Page>
          <EmptyState art="mail" title={`Viestit eivät ole käytössä ${allative(student.name)}`}
            text={m.ready && m.enabled ? 'Viestit ovat täysi-ikäisille pelaajille. Ota ne käyttöön, niin voitte viestiä kahden kesken.' : 'Viestit tulevat käyttöön vaiheittain.'}
            action={m.ready && m.enabled ? <Button variant="dark" onClick={() => setTurnOnOpen(true)}>Ota käyttöön</Button> : null} />
        </Page>
        <TurnOnSheet open={turnOnOpen} onClose={() => setTurnOnOpen(false)} student={student} />
      </>
    );
  }

  const turnOff = async () => {
    setMenuOpen(false);
    try {
      await api.messages.setEnabled([student.id], false);
      await m.reload();
      track('viestit.pois-pelaajalta');
      toast(`Viestit pois päältä: ${student.name}.`);
    } catch (err) { toast(err); }
  };
  const resolveRef = (kind, id) => refQuote(state, student, kind, id, 'coach');
  const closed = student.isPlaceholder
    ? `${student.name.split(' ')[0]} ei ole vielä liittynyt Koutsiin. Viestit toimivat, kun hän liittyy.`
    : null;

  return (
    <>
      <Chat
        thread={thread}
        viewer="coach"
        title={student.name}
        sub={groupLine(state, student.id)}
        person={student}
        onBack={back}
        onWho={() => navigate(playerPath(student.id))}
        headAction={<IconButton icon="more" label="Keskustelun toiminnot" onClick={() => setMenuOpen(true)} />}
        context={<Facts state={state} student={student} onQuoteWish={(w) => { track('viestit.lainaa-toive'); setQuote({ kind: 'wish', id: w.id }); }} />}
        placeholder={`Kirjoita ${allative(student.name)}…`}
        closed={closed}
        initialRef={quote}
        resolveRef={resolveRef}
        onSent={() => track('viestit.lahetetty')}
      />
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={student.name} size="sm">
        <div className="list-group">
          <ListRow icon="user" title="Pelaajan sivu" subtitle="Kehitys, merkinnät, poissaolot" onClick={() => { setMenuOpen(false); navigate(playerPath(student.id)); }} />
          <ListRow icon="close" title="Viestit pois tältä pelaajalta" subtitle="Keskustelu jää luettavaksi, uusia viestejä ei voi lähettää" chevron={false} onClick={turnOff} />
        </div>
      </Sheet>
    </>
  );
}
