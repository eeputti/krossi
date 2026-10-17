// ResultConfirm — "Vahvistatko tuloksen?": a result another player logged with me as their
// opponent, shown from my side, inside PendingOutcomeCheck's sheet.
//   <ResultConfirm result={MatchResult (isMine false)} busy={null|'confirm'|'dispute'} remaining={n} titleId onAnswer={(confirm) => …} />
import { firstName } from '../../lib/format.js';
import { Avatar, Button, Icon } from '../../ui/index.js';
import { ResultCard } from '../profile/ResultCard.jsx';

export function ResultConfirm({ result, busy, remaining = 0, titleId, onAnswer }) {
  const by = result.loggedBy;
  return (
    <div className="home-outcome">
      <div className="home-outcome-people pop">
        <Avatar person={by} size={58} />
        <span className="home-outcome-ball" aria-hidden="true"><Icon name="trophy" size={17} strokeWidth={2.4} /></span>
      </div>
      <h2 id={titleId} className="home-outcome-title">Vahvistatko tuloksen?</h2>
      <p className="home-outcome-game">{firstName(by?.name)} kirjasi tuloksen kanssasi</p>
      <ResultCard result={result} hideStatus className="home-confirm-card" />
      <p className="home-outcome-hint">Vahvistettu tulos näkyy myös sinun pelihistoriassasi.</p>
      <div className="sheet-actions home-outcome-actions home-confirm-actions">
        <Button variant="soft" size="lg" loading={busy === 'dispute'} disabled={Boolean(busy)} onClick={() => onAnswer(false)}>
          Ei pidä paikkaansa
        </Button>
        <Button variant="lime" size="lg" icon="check" loading={busy === 'confirm'} disabled={Boolean(busy)} onClick={() => onAnswer(true)}>
          Vahvista
        </Button>
      </div>
      {remaining > 0 && <p className="home-outcome-more">Vielä {remaining} {remaining === 1 ? 'kysymys' : 'kysymystä'}</p>}
    </div>
  );
}
