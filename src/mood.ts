import { myHp, myMaxhp, myMaxmp, myMp, restoreHp, restoreMp, use } from "kolmafia";
import { $effect, $effects, $item, get, have } from "libram";

import { tryAcquiringEffect } from "./lib";
import { PearlSpec } from "./pearls";

// Verified spell-damage effects (Bonus_Spell_Damage wiki page):
// Carol of the Hells +100% spell dmg; Song of Sauce +100% and +50 hot;
// Jackasses' Symphony +12 flat. Acquisition is free-first via canAcquireEffect.
const SPELL_DAMAGE_EFFECTS = $effects`Carol of the Hells, Song of Sauce, Jackasses' Symphony of Destruction`;

// The user-authored defensive/res effect list, moved verbatim from the old inline
// prepare() in pearls.ts (duplicate Feeling Peaceful collapsed to one entry).
export const RESISTANCE_EFFECTS = $effects`Astral Shell, Egged On, Elemental Saucesphere, Feeling Peaceful, Blood Bond, Empathy, Scarysauce, Scariersauce, Leash of Linguini, A Few Extra Pounds, Big, Mariachi Mood, Patience of the Tortoise, Power Ballad of the Arrowsmith, Quiet Determination, Reptilian Fortitude, Saucemastery, Seal Clubbing Frenzy, Song of Starch, Stevedave's Shanty of Superiority`;

export function pearlMood(spec: PearlSpec, mpPerFight: number): void {
  void spec; // per-zone res effect pruning is a later refinement; current list is all-elements
  // Fishy: free pipe only in v1 (docs/consumption-reference.md)
  if (!have($effect`Fishy`) && have($item`fishy pipe`) && !get("_fishyPipeUsed")) {
    use($item`fishy pipe`);
  }
  for (const ef of RESISTANCE_EFFECTS) tryAcquiringEffect(ef);
  for (const ef of SPELL_DAMAGE_EFFECTS) tryAcquiringEffect(ef);
  // Explicit restores — auto-recovery is disabled by PearloEngine
  if (myMp() < 1.5 * mpPerFight) restoreMp(Math.min(myMaxmp(), 3 * mpPerFight));
  if (myHp() < 0.6 * myMaxhp()) restoreHp(myMaxhp());
}
