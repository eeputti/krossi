// PendingOutcomeCheck — mounted once by App.jsx for signed-in players.
//
// It no longer pops up by itself: past games whose outcome is still open are cards in Omat →
// "Odottaa vastaustasi" (and in the bell), and tapping one calls askOutcome(game), which shows the
// "Pelasitteko?" sheet here:
//   Kyllä, pelattiin  -> recordOutcome('played') + confetti, then offers <MatchResultSheet> ("Kirjaa tulos?", skippable)
//   Ei pelattu        -> recordOutcome('not_played')
//   closing the sheet -> nothing is recorded; the card stays in Omat
// It waits while an overlay or a full-screen page (chat, recap) is open so it never stacks on them.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useRoute } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { formatGameTime, firstName } from '../../lib/format.js';
import { AvatarStack, Button, Icon, Sheet, confetti, isAnySheetOpen, useToast } from '../../ui/index.js';
import { gameTitle, notifyGamesChanged, placeLine } from '../games/gameUtils.js';
import { MatchResultSheet } from '../shared/MatchResultSheet.jsx';

const NEXT_DELAY_MS = 650;
const SHEET_EXIT_MS = 280;
const RETRY_MS = 2000;
const BLOCKING_ROUTE_TYPES = new Set(['overlay', 'full']);

const ASK_OUTCOME = 'krossi:ask-outcome';
/** Put "Pelasitteko?" about this game first in line (shown on Omat once no sheet is open). */
export function askOutcome(game) {
  window.dispatchEvent(new CustomEvent(ASK_OUTCOME, { detail: game }));
}

/** Everyone in the game except me. */
function othersIn(game, uid) {
  return [game.creator, ...(game.participants || [])].filter((p) => p && p.id !== uid);
}

export function PendingOutcomeCheck() {
  const { user } = useSession();
  const route = useRoute();
  const toast = useToast();
  const uid = user?.id || null;
  // Only ask on Omat: popping a question over whatever the player is doing feels like a freeze.
  const blocked = route.name !== 'home' || BLOCKING_ROUTE_TYPES.has(route.route?.type);

  const [queue, setQueue] = useState([]);
  const [game, setGame] = useState(null); // the game being asked about (kept through exit animations)
  const [askOpen, setAskOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [busy, setBusy] = useState(null);
  const [retry, setRetry] = useState(0);
  const afterAsk = useRef('next'); // 'next' | 'result'
  const askedOnce = useRef(false);

  useEffect(() => {
    const onAsk = (e) => {
      const asked = e.detail;
      if (asked?.id) setQueue((q) => [asked, ...q.filter((g) => g.id !== asked.id)]);
    };
    window.addEventListener(ASK_OUTCOME, onAsk);
    return () => window.removeEventListener(ASK_OUTCOME, onAsk);
  }, []);

  // Ask about the head of the queue whenever nothing else is in the way.
  useEffect(() => {
    if (game || blocked || queue.length === 0) return undefined;
    const t = setTimeout(() => {
      // Another sheet (e.g. Pelaan nyt, paywall) is open — try again a bit later.
      if (isAnySheetOpen() || document.body.classList.contains('sheet-open')) { setRetry((n) => n + 1); return; }
      askedOnce.current = true;
      setRetry(0);
      setBusy(null);
      setGame(queue[0]);
      setAskOpen(true);
    }, retry > 0 ? RETRY_MS : askedOnce.current ? NEXT_DELAY_MS : 0);
    return () => clearTimeout(t);
  }, [game, blocked, queue, retry]);

  const finish = () => {
    const id = game?.id;
    setQueue((q) => q.filter((g) => g.id !== id));
    setGame(null);
    setPrefill(null);
  };

  const dismiss = () => {
    if (!game || busy) return;
    afterAsk.current = 'next';
    setAskOpen(false);
  };

  const answer = async (outcome) => {
    if (!game || busy) return;
    setBusy(outcome);
    try {
      await api.games.recordOutcome(game.id, outcome);
      notifyGamesChanged();
      if (outcome === 'played') {
        confetti();
        const opponent = othersIn(game, uid)[0];
        setPrefill({
          format: game.matchType === 'nelinpeli' ? 'doubles' : 'singles',
          opponentName: opponent ? firstName(opponent.name) : '',
        });
        afterAsk.current = 'result';
      } else {
        toast('Selvä — merkitty pelaamattomaksi', { tone: 'info' });
        afterAsk.current = 'next';
      }
      setAskOpen(false);
    } catch (err) {
      toast(err);
      setBusy(null);
    }
  };

  const onAskClosed = () => {
    setBusy(null);
    if (afterAsk.current === 'result') setResultOpen(true);
    else finish();
  };

  const closeResult = () => {
    setResultOpen(false);
    setTimeout(finish, SHEET_EXIT_MS);
  };

  if (!uid) return null;

  const others = game ? othersIn(game, uid) : [];
  const people = game ? [game.creator, ...(game.participants || [])].filter(Boolean) : [];
  const remaining = Math.max(0, queue.length - 1);

  return (
    <>
      <Sheet
        open={askOpen}
        onClose={dismiss}
        onClosed={onAskClosed}
        dismissible={!busy}
        size="sm"
        labelledBy="home-outcome-title"
        className="home-outcome-sheet"
      >
        {game && (
          <div className="home-outcome">
            <div className="home-outcome-people pop">
              <AvatarStack people={people} max={4} size={58} />
              <span className="home-outcome-ball" aria-hidden="true"><Icon name="ball" size={18} strokeWidth={2.4} /></span>
            </div>
            <h2 id="home-outcome-title" className="home-outcome-title">Pelasitteko?</h2>
            <p className="home-outcome-game">
              {gameTitle(game)}
              {others.length > 0 && <> · {others.map((p) => firstName(p.name)).join(', ')}</>}
            </p>
            <p className="home-outcome-meta">
              <span><Icon name="clock" size={14} />{formatGameTime(game.scheduledAt)}</span>
              <span className="truncate"><Icon name="pin" size={14} />{placeLine(game)}</span>
            </p>
            <p className="home-outcome-hint">Vastaus pitää putkesi ja merkkisi ajan tasalla.</p>
            <div className="sheet-actions home-outcome-actions">
              <Button variant="soft" size="lg" loading={busy === 'not_played'} disabled={Boolean(busy)} onClick={() => answer('not_played')}>
                Ei pelattu
              </Button>
              <Button variant="lime" size="lg" icon="check" loading={busy === 'played'} disabled={Boolean(busy)} onClick={() => answer('played')}>
                Kyllä, pelattiin
              </Button>
            </div>
            {remaining > 0 && <p className="home-outcome-more">Vielä {remaining} {remaining === 1 ? 'peli' : 'peliä'} kysymättä</p>}
          </div>
        )}
      </Sheet>

      <MatchResultSheet
        open={resultOpen}
        onClose={closeResult}
        onSaved={() => notifyGamesChanged()}
        initial={prefill}
        title="Kirjaa tulos?"
      />
    </>
  );
}
