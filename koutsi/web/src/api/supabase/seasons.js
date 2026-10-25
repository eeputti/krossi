// seasons.js — "Uusi kausi" (domain/season.js, migration 20261026120000_koutsi_seasons).
// The draft is the coach's own row (players never see it); publishing is one server call that
// writes the season, its groups, members, new players and sessions at once and sends each player
// one notification. Before the migration every call says so and writes nothing.
import { ApiError } from '../errors.js';
import { db, isMissingFunction, isMissingTable } from './client.js';

const from = (table) => db().from(table);
const notYet = () => new ApiError('Kauden vaihto tulee käyttöön pian — mitään ei tallennettu.', { code: 'not_deployed' });
const guard = (error) => {
  if (error && (isMissingTable(error) || isMissingFunction(error))) throw notYet();
  if (error) throw error;
};

export const seasons = {
  async saveDraft(coachId, draft) {
    const { error } = await from('koutsi_season_drafts').upsert({
      coach_id: coachId, from_season_id: draft.fromSeasonId || null, draft, updated_at: new Date().toISOString(),
    }, { onConflict: 'coach_id' });
    guard(error);
  },
  async removeDraft(coachId) {
    const { error } = await from('koutsi_season_drafts').delete().eq('coach_id', coachId);
    guard(error);
  },
  async publish(coachId, draft) {
    const { data, error } = await db().rpc('koutsi_publish_season', { draft, coach_id_input: coachId || null });
    guard(error);
    return data;
  },
  // name / end date / breaks of a season; the calendar itself is extended with groups.extendSeries
  async update(seasonId, { name, endsOn, breaks }) {
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (endsOn !== undefined) patch.ends_on = endsOn;
    if (breaks !== undefined) patch.breaks = breaks;
    const { error } = await from('koutsi_seasons').update(patch).eq('id', seasonId);
    guard(error);
  },
};

