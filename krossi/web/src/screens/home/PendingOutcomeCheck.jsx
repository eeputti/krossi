// PendingOutcomeCheck — mounted once by App.jsx for signed-in players.
//
// It never pops up by itself: past games whose outcome is still open, and results other players
// logged with me as their opponent, are cards in Omat → "Odottaa vastaustasi" (and in the bell).
// Tapping one calls askOutcome(game) / askResult(result), which shows its sheet here:
//   "Pelasitteko?"
//     Kyllä, pelattiin  -> recordOutcome('played') + confetti, then offers <MatchResultSheet> ("Kirjaa tulos?", skippable;
//                          in a singles game the opponent comes prefilled as a Krossi player, who is then asked to confirm)
//     Ei pelattu        -> recordOutcome('not_played')
//   "Vahvistatko tuloksen?" (ResultConfirm)
//     Vahvista            -> results.confirm: the result joins my history too
//     Ei pidä paikkaansa  -> results.dispute: the logger sees it and can correct it (then I'm asked again)
//   closing a sheet -> nothing is recorded; the card stays in Omat
// It waits while an overlay or a full-screen page (chat, recap) is open so it never stacks on them.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useRoute } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { formatGameTime, firstName } from '../../lib/format.js';
import { AvatarStack, Button, Icon, Sheet, confetti, isAnySheetOpen, useToast } from '../../ui/index.js';
import { gameTitle, notifyGamesChanged, placeLine } from '../games/gameUtils.js';
import { notifyResultsChanged } from '../profile/matchResult.js';
import { MatchResultSheet } from '../shared/MatchResultSheet.jsx';
import { ResultConfirm } from './ResultConfirm.jsx';

const NEXT_DELAY_MS = 650;
const SHEET_EXIT_MS = 280;
const RETRY_MS = 2000;
const BLOCKING_ROUTE_TYPES = new Set(['overlay', 'full']);

const ASK = 'krossi:ask-outcome';
const gameItem = (game) => ({ key: game.id, kind: 'game', game });
const resultItem = (result) => ({ key: `r:${result.id}`, kind: 'result', result });

/** Put "Pelasitteko?" about this game first in line (shown on Omat once no sheet is open). */
export function askOutcome(game) {
  window.dispatchEvent(new CustomEvent(ASK, { detail: gameItem(game) }));
}
/** Put "Vahvistatko tuloksen?" about this result first in line. */
export function askResult(result) {
  window.dispatchEvent(new CustomEvent(ASK, { detail: resultItem(result) }));
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

  const [queue, setQueue] = useState([]); // { key, kind: 'game'|'result', game?, result? }
  const [current, setCurrent] = useState(null); // the item being asked about (kept through exit animations)
  const [askOpen, setAskOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [busy, setBusy] = useState(null);
  const [retry, setRetry] = useState(0);
  const afterAsk = useRef('next'); // 'next' | 'result'
  const askedOnce = useRef(false);

  useEffect(() => {
    const onAsk = (e) => {
      const asked = e.detail;
      if (asked?.key) setQueue((q) => [asked, ...q.filter((i) => i.key !== asked.key)]);
    };
    window.addEventListener(ASK, onAsk);
    return () => window.removeEventListener(ASK, onAsk);
  }, []);

  // Ask about the head of the queue whenever nothing else is in the way.
  useEffect(() => {
    if (current || blocked || queue.length === 0) return undefined;
    const t = setTimeout(() => {
      // Another sheet (e.g. Pelaan nyt, paywall) is open — try again a bit later.
      if (isAnySheetOpen() || document.body.classList.contains('sheet-open')) { setRetry((n) => n + 1); return; }
      askedOnce.current = true;
      setRetry(0);
      setBusy(null);
      setCurrent(queue[0]);
      if (queue[0].kind === 'result') setConfirmOpen(true);
      else setAskOpen(true);
    }, retry > 0 ? RETRY_MS : askedOnce.current ? NEXT_DELAY_MS : 0);
    return () => clearTimeout(t);
  }, [current, blocked, queue, retry]);

  const game = current?.kind === 'game' ? current.game : null;
  const result = current?.kind === 'result' ? current.result : null;

  const finish = () => {
    const key = current?.key;
    setQueue((q) => q.filter((i) => i.key !== key));
    setCurrent(null);
    setPrefill(null);
  };

  const dismiss = () => {
    if (!game || busy) return;
    afterAsk.current = 'next';
    setAskOpen(false);
  };

  const dismissResult = () => {
    if (!result || busy) return;
    setConfirmOpen(false);
  };

  const answerResult = async (confirm) => {
    if (!result || busy) return;
    setBusy(confirm ? 'confirm' : 'dispute');
    try {
      await (confirm ? api.results.confirm(result.id) : api.results.dispute(result.id));
      notifyResultsChanged();
      const by = firstName(result.loggedBy?.name);
      toast(confirm ? 'Tulos vahvistettu — se näkyy nyt pelihistoriassasi' : `Selvä — ${by} näkee, ettei tulos pidä paikkaansa`, { tone: confirm ? undefined : 'info' });
      setConfirmOpen(false);
    } catch (err) {
      toast(err);
      setBusy(null);
    }
  };

  const answer = async (outcome) => {
    if (!game || busy) return;
    setBusy(outcome);
    try {
      await api.games.recordOutcome(game.id, outcome);
      notifyGamesChanged();
      if (outcome === 'played') {
        confetti();
        const others = othersIn(game, uid);
        const singles = game.matchType !== 'nelinpeli';
        setPrefill({
          format: singles ? 'singles' : 'doubles',
          opponentName: others[0] ? firstName(others[0].name) : '',
          // One opponent in a singles game: link them, so they confirm the result.
          opponent: singles && others.length === 1 && others[0].name !== 'Pelaaja' ? others[0] : null,
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
              {others.length > 0 && <> ({others.map((p) => firstName(p.name)).join(', ')})</>}
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
            {remaining > 0 && <p className="home-outcome-more">Vielä {remaining} {remaining === 1 ? 'kysymys' : 'kysymystä'}</p>}
          </div>
        )}
      </Sheet>

      <Sheet
        open={confirmOpen}
        onClose={dismissResult}
        onClosed={() => { setBusy(null); finish(); }}
        dismissible={!busy}
        size="sm"
        labelledBy="home-confirm-title"
        className="home-outcome-sheet"
      >
        {result && <ResultConfirm result={result} busy={busy} remaining={remaining} titleId="home-confirm-title" onAnswer={answerResult} />}
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
