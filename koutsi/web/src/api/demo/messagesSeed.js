// messagesSeed.js — Viestit in Anna's demo season. Messages are on for the adult groups' players
// (placeholders too: it works once they join); the junior groups and the Friday match night (two
// 15–16-year-olds in it) are left undecided, as a coach would. The coach's demo opens with two
// players waiting for an answer; the player's demo (Maria) opens with Anna's reply waiting.
import { COACH, PLAYER } from './seed.js';

const ADULT_GROUPS = /^Aikuiset/;

/** A time `daysAgo` days back at hh:mm, never later than a few minutes ago. */
function past(daysAgo, hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return new Date(Math.min(d.getTime(), Date.now() - 4 * 60 * 1000)).toISOString();
}
const minutesAgo = (n) => new Date(Date.now() - n * 60 * 1000).toISOString();

export function seedMessages(s, role) {
  const adultIds = new Set(s.groups.filter((g) => g.coachId === COACH && ADULT_GROUPS.test(g.name)).flatMap((g) => g.memberIds));
  const wishOf = (id) => (s.students.find((x) => x.id === id)?.wishHistory || [])[0]?.id || null;
  const threads = [...adultIds].map((studentId) => ({
    id: `demo-th-${studentId}`, coachId: COACH, studentId, enabled: true, enabledAt: past(9, 20, 0), coachReadAt: null, playerReadAt: null,
  }));
  const messages = [];
  const say = (studentId, sender, body, at, ref = null) => messages.push({
    id: `demo-m-${messages.length + 1}`, threadId: `demo-th-${studentId}`, sender, body, at, refKind: ref?.kind || null, refId: ref?.id || null,
  });

  // Maria: a question last night. The coach's demo leaves it waiting; the player's demo has the answer.
  say(PLAYER, 'player', 'Moi! Tiistain treeni jää multa tällä viikolla väliin.', past(1, 18, 41));
  say(PLAYER, 'player', 'Pääsenkö torstain ryhmään?', past(1, 18, 42));
  if (role === 'player') {
    say(PLAYER, 'coach', 'Pääset! Torstaina klo 18, kenttä 3. Aloitetaan verkkopelillä, kun sitä toivoit 🙂', minutesAgo(25), { kind: 'wish', id: wishOf(PLAYER) });
  }
  // Jussi: more about his wish, unanswered.
  say('demo-s-jussi', 'player', 'Toiveesta vielä: voisiko pistepelit olla ihan lopussa, niin jaksaa paremmin?', past(1, 21, 10));
  // Pirjo: the coach answered her wish (a reply that quotes the Toive), she has seen it.
  say('demo-s-pirjo', 'coach', 'Kiitos toiveesta! Pelataan tiistaina loppuun nelinpeliä.', past(2, 19, 30), { kind: 'wish', id: wishOf('demo-s-pirjo') });
  // Aleksi and Laura: everyday back-and-forth, all read.
  say('demo-s-aleksi', 'player', 'Pääsenkö tiistaina vähän myöhässä? Töistä tulee kiire.', past(4, 16, 5));
  say('demo-s-aleksi', 'coach', 'Totta kai, tule kun ehdit. Aloitetaan syötöillä, ehdit hyvin mukaan.', past(4, 16, 30));
  say('demo-s-laura', 'player', 'Olen marraskuussa kaksi viikkoa työmatkalla. Merkitsin poissaolot sovellukseen.', past(6, 21, 15));
  say('demo-s-laura', 'coach', 'Hyvä tietää, kiitos. Kirjasin ne myös omaan suunnitelmaan.', past(5, 8, 20));

  const lastOf = (threadId) => messages.filter((m) => m.threadId === threadId).map((m) => m.at).sort().pop() || null;
  for (const t of threads) {
    const last = lastOf(t.id);
    if (!last) continue;
    // Everything is read except what the demo wants waiting.
    t.coachReadAt = last;
    t.playerReadAt = last;
  }
  const maria = threads.find((t) => t.studentId === PLAYER);
  if (maria) {
    if (role === 'player') { maria.coachReadAt = lastOf(maria.id); maria.playerReadAt = past(1, 18, 42); } else { maria.coachReadAt = past(2, 9, 0); maria.playerReadAt = past(1, 18, 42); }
  }
  const jussi = threads.find((t) => t.studentId === 'demo-s-jussi');
  if (jussi) jussi.coachReadAt = past(2, 9, 0);
  s.threads = threads;
  s.messages = messages;
  s.messagesOn = true; // the coach's feature gate in the demo
  return s;
}
