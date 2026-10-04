// matchResult.js — vocabulary and outcome rules for logged match results (MatchResult in api/contract.js).
// Shared by the result sheet, the scoreboard cards and the history sheet so they never disagree.

export const RESULT_FORMATS = [
  { value: 'singles', label: 'Kaksinpeli' },
  { value: 'doubles', label: 'Nelinpeli' },
];

export const RESULT_GAME_TYPES = [
  { value: 'sets', label: 'Erät' },
  { value: 'tiebreak', label: 'Tie-break' },
  { value: 'full_match', label: 'Kunnon matsi' },
];

export const MAX_SETS = 5;

export const labelOfFormat = (v) => RESULT_FORMATS.find((f) => f.value === v)?.label || 'Kaksinpeli';
export const labelOfGameType = (v) => RESULT_GAME_TYPES.find((t) => t.value === v)?.label || 'Erät';

const num = (n) => Number(n) || 0;

/** Sets won / lost and game totals of a sets array ({ my, opp }[]). */
export function tally(sets) {
  const list = Array.isArray(sets) ? sets : [];
  return {
    won: list.filter((s) => num(s.my) > num(s.opp)).length,
    lost: list.filter((s) => num(s.opp) > num(s.my)).length,
    my: list.reduce((acc, s) => acc + num(s.my), 0),
    opp: list.reduce((acc, s) => acc + num(s.opp), 0),
  };
}

/** Same rule as the legacy app and the mobile app: more sets won than lost. */
export const computeWon = (sets) => {
  const t = tally(sets);
  return t.won > t.lost;
};

/**
 * 'win' | 'loss' | 'draw' — decided by sets, like tennis (6–4 3–6 7–6 is a win even though
 * both sides won 16 games). Level sets (an unfinished 1–1) read as a draw. Identical to
 * features/gamification.js, so badges never celebrate a match the history calls a draw.
 */
export function resultOutcome(result) {
  const t = tally(result?.sets);
  if (t.won > t.lost) return 'win';
  if (t.lost > t.won) return 'loss';
  return 'draw';
}

export const OUTCOME_LABEL = { win: 'Voitto', loss: 'Tappio', draw: 'Tasapeli' };
export const OUTCOME_TONE = { win: 'success', loss: 'danger', draw: 'warn' };

/** Names of both sides as shown on a scoreboard. */
export function sideNames(result) {
  const doubles = result?.format === 'doubles';
  const opp = result?.opponentName?.trim() || (doubles ? 'Vastustajat' : 'Vastustaja');
  return {
    mine: doubles && result?.partnerName?.trim() ? `Sinä & ${result.partnerName.trim()}` : 'Sinä',
    theirs: doubles && result?.oppPartnerName?.trim() ? `${opp} & ${result.oppPartnerName.trim()}` : opp,
  };
}

/** Headline score: games for a single set / tie-break ("6–4"), sets otherwise ("2–1"). */
export function headlineScore(sets) {
  const list = Array.isArray(sets) ? sets : [];
  if (list.length === 1) return `${num(list[0].my)}–${num(list[0].opp)}`;
  const t = tally(list);
  return `${t.won}–${t.lost}`;
}
