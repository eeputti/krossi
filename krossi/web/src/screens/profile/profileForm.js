// profileForm.js — Profile <-> editable form <-> ProfileInput (api/contract.js).
// Used by the edit screen and by the settings toggles that save a single field.

export function profileToForm(p) {
  const areas = p?.areas?.length ? p.areas : (p?.city ? [p.city] : []);
  return {
    name: p?.name || '',
    ageRange: p?.ageRange || '',
    gender: p?.gender || '',
    city: areas[0] || '',
    alsoCities: areas.slice(1),
    skillLevel: p?.skillLevel || 'keskitaso',
    competitionClasses: p?.competitionClasses || [],
    playStyles: p?.playStyles || [],
    availability: p?.availability || [],
    handedness: p?.handedness || '',
    backhand: p?.backhand || '',
    bio: p?.bio || '',
    hiddenFromFeed: Boolean(p?.hiddenFromFeed),
    playingThisWeek: Boolean(p?.playingThisWeek),
  };
}

export function formToInput(form, avatarPath = null) {
  const areas = [form.city, ...form.alsoCities.filter((c) => c && c !== form.city)].filter(Boolean);
  const input = {
    name: form.name.trim(),
    ageRange: form.ageRange || null,
    gender: form.gender || null,
    areas,
    bio: form.bio.trim() || null,
    skillLevel: form.skillLevel,
    competitionClasses: form.skillLevel === 'kilpapelaaja' ? form.competitionClasses : [],
    playStyles: form.playStyles,
    availability: form.availability,
    handedness: form.handedness || null,
    backhand: form.backhand || null,
    hiddenFromFeed: form.hiddenFromFeed,
    playingThisWeek: form.playingThisWeek,
  };
  if (avatarPath) input.avatarPath = avatarPath;
  return input;
}

/** The ProfileInput that re-saves `profile` unchanged, with `overrides` applied. */
export const profileToInput = (profile, overrides = {}) => ({ ...formToInput(profileToForm(profile)), ...overrides });
