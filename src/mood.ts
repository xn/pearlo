import {
  Effect,
  Element,
  myFamiliar,
  myHp,
  myMaxhp,
  myMaxmp,
  myMp,
  restoreHp,
  restoreMp,
  use,
} from "kolmafia";
import { $effect, $effects, $elements, $familiar, $item, get, have } from "libram";

import { tryAcquiringEffect } from "./lib";
import { PearlSpec } from "./zones";

// Every list below is wiki-verified (effect pages fetched 2026-08-07); the original
// usefulEffects list mixed genuine resistance with stat/HP/familiar buffs — sorted here.

// True all-element resistance: Elemental Saucesphere +2, Feeling Peaceful +2,
// Astral Shell +1.
const ALL_ELEMENT_RES_EFFECTS = $effects`Elemental Saucesphere, Feeling Peaceful, Astral Shell`;

// Block-class defense: Blood Bubble makes the first hit per combat auto-miss
// (multi-attack monsters can still land extras). Sauceror skill, permable,
// costs 30 HP (not MP!) for 3 turns — cast BEFORE the HP restore below tops us up.
const BLOCK_EFFECTS = $effects`Blood Bubble`;

// Partial resistance: cold+sleaze only. Scarysauce +2, Scariersauce +6 (Scarysauce cast
// while wielding a velour viscometer); they stack (+8 together on top of the all-element set).
const PARTIAL_RES_EFFECTS: [Effect, Element[]][] = [
  [$effect`Scarysauce`, $elements`cold, sleaze`],
  [$effect`Scariersauce`, $elements`cold, sleaze`],
];

// Stats: Mysticality % feeds Saucegeyser damage; Moxie % feeds dodge.
const STAT_EFFECTS = $effects`Big, Stevedave's Shanty of Superiority, Feeling Excited`;

// Max-HP padding for rounds where the kill isn't a one-shot.
const HP_EFFECTS = $effects`Reptilian Fortitude, A Few Extra Pounds, Power Ballad of the Arrowsmith, Mariachi Mood, Patience of the Tortoise`;

// +5 familiar weight each — pointless with no familiar out; Blood Bond also drains
// 8-10 HP per adventure, so it stays out of v1 entirely.
const FAMILIAR_WEIGHT_EFFECTS = $effects`Empathy, Leash of Linguini, Only Dogs Love a Drunken Sailor`;

// Verified spell-damage effects (Bonus_Spell_Damage wiki page):
// Carol of the Hells +100% spell dmg; Song of Sauce +100% and +50 hot;
// Jackasses' Symphony +12 flat. Acquisition is free-first via canAcquireEffect.
const SPELL_DAMAGE_EFFECTS = $effects`Carol of the Hells, Song of Sauce, Jackasses' Symphony of Destruction`;

export function pearlMood(spec: PearlSpec, mpPerFight: number): void {
  // Fishy: free pipe only in v1 (docs/consumption-reference.md)
  if (!have($effect`Fishy`) && have($item`fishy pipe`) && !get("_fishyPipeUsed")) {
    use($item`fishy pipe`);
  }
  for (const ef of ALL_ELEMENT_RES_EFFECTS) tryAcquiringEffect(ef);
  for (const [ef, elements] of PARTIAL_RES_EFFECTS) {
    if (elements.includes(spec.element)) tryAcquiringEffect(ef);
  }
  for (const ef of STAT_EFFECTS) tryAcquiringEffect(ef);
  for (const ef of HP_EFFECTS) tryAcquiringEffect(ef);
  if (myFamiliar() !== $familiar.none) {
    for (const ef of FAMILIAR_WEIGHT_EFFECTS) tryAcquiringEffect(ef);
  }
  for (const ef of SPELL_DAMAGE_EFFECTS) tryAcquiringEffect(ef);
  // HP-costed buffs (Blood Bubble 30 HP) go last among buffs, right before the
  // restores below recover what they spent.
  for (const ef of BLOCK_EFFECTS) tryAcquiringEffect(ef);
  // Explicit restores — auto-recovery is disabled by PearloEngine
  if (myMp() < 1.5 * mpPerFight) restoreMp(Math.min(myMaxmp(), 3 * mpPerFight));
  if (myHp() < 0.6 * myMaxhp()) restoreHp(myMaxhp());
}
