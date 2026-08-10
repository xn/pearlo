import {
  Effect,
  Element,
  Item,
  effectModifier,
  haveEffect,
  hpCost,
  itemAmount,
  mpCost,
  myFamiliar,
  myHp,
  myMaxhp,
  myMaxmp,
  myMp,
  numericModifier,
  print,
  restoreHp,
  restoreMp,
  toItem,
  toSkill,
  use,
} from "kolmafia";
import { $effect, $effects, $elements, $familiar, $item, get, have } from "libram";

import { args } from "./args";
import { tryAcquiringEffect } from "./lib";
import { wineglassMode } from "./organs";
import { PEARL_RES_CAP, PearlKey, PearlSpec, resModifierName } from "./zones";

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

// Weapon-damage % effects for wineglass (attack-only) combat: Carol of the Bulls,
// Song of the North (user, 2026-08-08); Frenzied, Bloody = Blood Frenzy's +50%
// weapon damage for 30 HP — the comma in its name forces the singular template.
const WEAPON_DAMAGE_EFFECTS = [
  ...$effects`Carol of the Bulls, Song of the North`,
  $effect`Frenzied, Bloody`,
];

/** Per-zone res top-up potions (overrides.<key>resitems), parsed and warned once. */
const resItemCache = new Map<PearlKey, Item[]>();
function resItems(key: PearlKey): Item[] {
  const cached = resItemCache.get(key);
  if (cached) return cached;
  const raw = {
    spooky: args.overrides.spookyresitems,
    sleaze: args.overrides.sleazeresitems,
    hot: args.overrides.hotresitems,
    stench: args.overrides.stenchresitems,
    cold: args.overrides.coldresitems,
  }[key];
  const items: Item[] = [];
  for (const name of raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")) {
    const it = toItem(name);
    if (it === $item.none) {
      print(`pearlo: unknown item "${name}" in ${key}resitems — skipping it.`, "red");
    } else {
      items.push(it);
    }
  }
  resItemCache.set(key, items);
  return items;
}

const resShortfallWarned = new Set<PearlKey>();

/**
 * Turns of effect needed to finish this pearl: remaining fights at the capped
 * 10%/fight rate, doubled without Fishy (underwater fights cost 2 turns).
 */
function coverageTurns(spec: PearlSpec): number {
  const fights = Math.ceil((100 - get(spec.progress, 0)) / 10);
  return fights * (have($effect`Fishy`) ? 1 : 2);
}

/**
 * Chew through the zone's configured potion list (strongest first, inventory
 * only — nothing is purchased) until dressed res reaches the progress cap.
 * Runs after the skill buffs so free casts count before potions are spent.
 * Each potion is used in bulk — enough copies for the effect to outlast the
 * rest of the pearl — so short-duration potions (powders, marzipan skulls)
 * don't drop a tier on expiry boundaries mid-zone; anything that still
 * expires early is re-upped by the next pre-fight mood pass.
 */
function topUpRes(spec: PearlSpec): void {
  const resName = resModifierName(spec.key);
  if (numericModifier(resName) >= PEARL_RES_CAP) return;
  const need = coverageTurns(spec);
  for (const it of resItems(spec.key)) {
    if (numericModifier(resName) >= PEARL_RES_CAP) break;
    if (!have(it)) continue;
    const ef = effectModifier(it, "Effect");
    if (ef !== $effect.none && have(ef)) continue;
    const duration = Math.max(1, numericModifier(it, "Effect Duration"));
    use(it, Math.min(itemAmount(it), Math.ceil(need / duration)));
  }
  const finalRes = numericModifier(resName);
  if (finalRes < PEARL_RES_CAP && !resShortfallWarned.has(spec.key)) {
    resShortfallWarned.add(spec.key);
    print(
      `pearlo: ${spec.key} res is ${finalRes} after the ${spec.key}resitems top-up (< ${PEARL_RES_CAP} cap) — pearl progress runs below 10%/fight. Stock more of the list or extend it.`,
      "red",
    );
  }
}

/** Effect lists that apply to this zone/state, in cast order (HP-costed blocks last). */
function applicableBuffs(spec: PearlSpec): Effect[] {
  return [
    ...ALL_ELEMENT_RES_EFFECTS,
    ...PARTIAL_RES_EFFECTS.filter(([, elements]) => elements.includes(spec.element)).map(
      ([ef]) => ef,
    ),
    ...STAT_EFFECTS,
    ...HP_EFFECTS,
    ...(myFamiliar() !== $familiar.none ? FAMILIAR_WEIGHT_EFFECTS : []),
    // Wineglass combat kills spells — spell-damage songs are dead weight overdrunk;
    // weapon-damage songs take their place (and vice versa while sober).
    ...(wineglassMode() ? WEAPON_DAMAGE_EFFECTS : SPELL_DAMAGE_EFFECTS),
    // HP-costed buffs (Blood Bubble 30 HP) last, right before restores recover the cost.
    // (Blood Bubble is a noncombat cast; its first-hit block still works overdrunk.)
    ...BLOCK_EFFECTS,
  ];
}

/**
 * MP/HP the pending skill-casts among `effects` would cost (missing effects whose
 * default acquisition is a cast — same "cast 1 Skill Name" parse as canAcquireEffect).
 */
function pendingCastCosts(effects: Effect[]): { mp: number; hp: number } {
  let mp = 0;
  let hp = 0;
  for (const ef of effects) {
    if (have(ef) || !ef.default) continue;
    const parts = ef.default.split(" ");
    if (parts[0] !== "cast") continue;
    const sk = toSkill(parts.slice(2).join(" "));
    if (!have(sk)) continue;
    mp += mpCost(sk);
    hp += hpCost(sk);
  }
  return { mp, hp };
}

export function pearlMood(spec: PearlSpec, mpPerFight: number): void {
  // Lucky! converts the next adventure in Lucky-capable zones (Dive Bar: Razor,
  // Scooter; Reef: Dragon the Line) into a noncombat — a turn with no pearl progress
  // (cost us a turn in the 2026-08-07 session). With the luckyfishy refresh enabled
  // and Fishy low, the Get Fishy task consumes it productively before we get here;
  // otherwise it is still a live hazard worth flagging.
  if (have($effect`Lucky!`) && (haveEffect($effect`Fishy`) > 1 || !args.resources.luckyfishy)) {
    print(
      `pearlo: Lucky! is active — the next ${spec.loc} adventure may be its Lucky noncombat instead of a pearl fight. Consider spending Lucky elsewhere first.`,
      "red",
    );
  }
  // Fishy: free pipe only in v1 (docs/consumption-reference.md)
  if (!have($effect`Fishy`) && have($item`fishy pipe`) && !get("_fishyPipeUsed")) {
    use($item`fishy pipe`);
  }

  const buffs = applicableBuffs(spec);

  // MP economy (user feedback: hovering at ~2 casts of MP against a huge pool is way
  // too low): keep a real buffer — trigger below 5 fights' worth, refill to 20 fights'
  // worth (capped by max MP), and never below the pending buff casts' summed cost.
  const pending = pendingCastCosts(buffs);
  const mpTrigger = Math.max(pending.mp, 5 * mpPerFight);
  const mpTarget = Math.min(myMaxmp(), Math.max(pending.mp + 5 * mpPerFight, 20 * mpPerFight));
  if (myMp() < mpTrigger) restoreMp(mpTarget);
  if (myHp() <= pending.hp || myHp() < 0.6 * myMaxhp()) restoreHp(myMaxhp());

  for (const ef of buffs) tryAcquiringEffect(ef);

  topUpRes(spec);

  // BEFORE adventuring: the buffs spent MP/HP — re-verify the fight buffer.
  // Explicit restores; auto-recovery is disabled by PearloEngine.
  if (myMp() < 5 * mpPerFight) restoreMp(Math.min(myMaxmp(), 20 * mpPerFight));
  if (myHp() < 0.6 * myMaxhp()) restoreHp(myMaxhp());
}
