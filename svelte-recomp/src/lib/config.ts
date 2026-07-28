// Last-resort fallbacks only.
//
// These used to be the app's real source of truth — GOAL_KG = 90 and
// START_KG = 133.5, both derived from one specific person's body — which is
// precisely why nobody else could use the app. Real values now come from the
// user's profile (see $lib/profile and the onboarding flow) and are stored per
// user in `user_settings`.
//
// What remains here is only what a screen might need before the profile has
// loaded. Nothing here should ever be shown as if it were the user's own number.

/** Neutral placeholder goal weight. Only used while user_settings is loading. */
export const GOAL_KG = 0;

/** Neutral placeholder start weight. Only used while user_settings is loading. */
export const START_KG = 0;

/** Grams of protein per kg of goal bodyweight — see profile.proteinTargetG. */
export const PROTEIN_G_PER_KG = 1.8;
