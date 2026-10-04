// useActivity — loads my Activity once and derives the gamification numbers from it.
//   const { activity, totals, streak, wins, badges, goals, recaps, loading, error, reload } = useActivity();
import { useMemo } from 'react';
import { api } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { computeTotals, evaluateBadges, nextGoals, weekStreak, winStreak } from '../../features/gamification.js';
import { availableRecaps } from '../../features/recap.js';

export function useActivity() {
  const { data: activity, loading, error, reload } = useAsync(() => api.stats.myActivity(), []);
  const derived = useMemo(() => {
    if (!activity) return {};
    const now = new Date();
    return {
      totals: computeTotals(activity),
      streak: weekStreak(activity, now),
      wins: winStreak(activity),
      badges: evaluateBadges(activity, now),
      goals: nextGoals(activity, now, 3),
      recaps: availableRecaps(activity, now),
    };
  }, [activity]);
  return { activity, loading, error, reload, ...derived };
}
