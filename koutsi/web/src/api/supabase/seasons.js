// seasons.js — "Uusi kausi" is tried out in the demo first. The real backend needs a seasons
// table and one publish RPC (see domain/season.js); until then the coach state has no
// `seasonsReady`, so the feature never shows, and these say so if called anyway.
import { ApiError } from '../errors.js';

const notYet = async () => {
  throw new ApiError('Kauden vaihto on vielä kokeilussa — se tulee käyttöön pian.', { code: 'not_deployed' });
};

export const seasons = { saveDraft: notYet, removeDraft: notYet, publish: notYet };
