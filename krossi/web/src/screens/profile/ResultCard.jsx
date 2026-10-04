// ResultCard — a logged match as a little scoreboard (profile + history sheet).
//   <ResultCard result={MatchResult} onClick={fn} actions={node} />
import { Chip, Icon, TennisBall } from '../../ui/index.js';
import { formatDate } from '../../lib/format.js';
import { OUTCOME_LABEL, OUTCOME_TONE, labelOfFormat, labelOfGameType, resultOutcome, sideNames } from './matchResult.js';

const cx = (...c) => c.filter(Boolean).join(' ');

export function ResultCard({ result, onClick, actions, className, style }) {
  const outcome = resultOutcome(result);
  const names = sideNames(result);
  const sets = Array.isArray(result.sets) ? result.sets : [];
  const Tag = onClick ? 'button' : 'div';
  const row = (side) => {
    const mine = side === 'mine';
    const winner = outcome !== 'draw' && (mine ? outcome === 'win' : outcome === 'loss');
    return (
      <div className={cx('profile-score-row', winner && 'is-winner')}>
        <span className="profile-score-serve" aria-hidden="true">{winner && <TennisBall size={11} className="profile-score-ball" />}</span>
        <span className="profile-score-name truncate">{mine ? names.mine : names.theirs}</span>
        <span className="profile-score-sets">
          {sets.map((s, i) => {
            const a = mine ? s.my : s.opp;
            const b = mine ? s.opp : s.my;
            return <span key={i} className={cx('profile-score-cell t-num', a > b && 'is-won')}>{a}</span>;
          })}
        </span>
      </div>
    );
  };
  return (
    <div className={cx('profile-result', className)} style={style}>
      <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={cx('profile-result-main', onClick && 'is-interactive')} aria-label={onClick ? `${OUTCOME_LABEL[outcome]}: ${names.mine} vastaan ${names.theirs}, muokkaa` : undefined}>
        <div className="profile-result-meta">
          <Chip tone={OUTCOME_TONE[outcome]} size="sm" icon={outcome === 'win' ? 'trophy' : undefined}>{OUTCOME_LABEL[outcome]}</Chip>
          <span className="profile-result-kind truncate">{labelOfFormat(result.format)} · {labelOfGameType(result.gameType)}</span>
          <span className="profile-result-date">{result.createdAt ? formatDate(result.createdAt) : ''}</span>
          {onClick && <Icon name="edit" size={15} className="profile-result-edit" />}
        </div>
        <div className="profile-score">
          {row('mine')}
          {row('theirs')}
        </div>
      </Tag>
      {actions && <div className="profile-result-actions">{actions}</div>}
    </div>
  );
}
