import { Modes, OutfitSpec } from "grimoire-kolmafia";
import { Item, abort, canEquip, outfitPieces, print, toSlot } from "kolmafia";
import { $familiar, $item, $items, $slot, have } from "libram";

import { args, familiarOverride, outfitOverride } from "./args";
import {
  DamagePlan,
  damagePlan,
  lanternComponentsNeededForOneShot,
  ownedLanternProspect,
  plannedLanternComponents,
  selectLanternGear,
} from "./combat";
import {
  FamiliarPlan,
  familiarBreathesFree,
  pickUtilityFamiliar,
  playerAirByEffect,
  resFamiliarSwitches,
} from "./familiar";
import { MONODENT, fishMaxxed, fishWanted } from "./fishy";
import {
  LiverMode,
  allOrganEquipment,
  liverMode,
  requiredOrganEquipment,
  wineglassMode,
} from "./organs";
import {
  PEARL_RES_CAP,
  PEARL_RES_HEADROOM,
  PEARL_RES_WEIGHT,
  PearlSpec,
  familiarWaterBreathingEquipment,
  waterBreathingEquipment,
} from "./zones";

// Never let the maximizer equip these in pearl zones (user directives):
// - broken champagne bottle: its +item drains limited daily charges (2026-08-07)
// (Kramco and Möbius ring were un-banned 2026-08-12 — their wanderers/NC are now
// handled by the wanderer macro in combat.ts and the pearlo-choice script.)
const GLOBAL_AVOID = $items`broken champagne bottle`;

// Stooper-displacement notices are per-zone-per-session — buildPearlOutfit runs
// before every fight, and repeating the line each combat is noise.
const stooperNoticePrinted = new Set<string>();

// Outfit-override warnings (avoided pieces dropped, mandatory-layer collisions) are also
// per-zone-per-session — same rationale as stooperNoticePrinted.
const avoidNoticePrinted = new Set<string>();
const collisionNoticePrinted = new Set<string>();
const monodentNoticePrinted = new Set<string>();

/**
 * A saved outfit's pieces with the Monodent in hand: kept as-is when the outfit already
 * carries it (either hand), otherwise it displaces the saved weapon (user decision
 * 2026-10-03) — the off-hand stays the outfit's.
 */
function withMonodent(pieces: Item[]): Item[] {
  if (pieces.includes(MONODENT)) return pieces;
  return [...pieces.filter((p) => toSlot(p) !== $slot`weapon`), MONODENT];
}

/**
 * How a zone spends its familiar slot. "utility" is the default; a zone escalates to
 * "switch" only once a dressed, buffed build measures below the res cap and the switch
 * build measures higher (pearls.ts). Each direction is tried at most once per zone.
 */
export type FamiliarMode = "utility" | "switch";
const familiarModes = new Map<string, FamiliarMode>();

/**
 * True when the zone's familiar slot is actually chosen by its FamiliarMode. Stooper,
 * a familiar override and an outfit override all pin it earlier in buildPearlOutfit, so
 * for those zones an escalation dress would rebuild the identical outfit.
 */
export function familiarModeApplies(spec: PearlSpec): boolean {
  return (
    liverMode() !== "stooper" &&
    familiarOverride(spec.key) === undefined &&
    outfitOverride(spec.key) === undefined
  );
}

export function familiarModeFor(key: string): FamiliarMode {
  return familiarModes.get(key) ?? "utility";
}

export function setFamiliarMode(key: string, mode: FamiliarMode): void {
  familiarModes.set(key, mode);
}

/**
 * True when the only air supply we could bring is back-slot gear (old SCUBA tank etc.),
 * which is then what the back slot is spent on instead of the cape. `airByEffect` is a
 * parameter because the profit model prices before the breathing task has run.
 */
function backSlotNeededForAir(airByEffect: () => boolean = playerAirByEffect): boolean {
  if (airByEffect()) return false;
  return !waterBreathingEquipment.some((i) => toSlot(i) !== $slot`back` && have(i) && canEquip(i));
}

/**
 * Breathing keywords are needed exactly when air is NOT guaranteed independent of the
 * maximizer's choices (user refinement, 2026-08-07): an air *effect* covers the player;
 * a familiar-air effect or an innately water-breathing familiar covers the familiar.
 * Equipment-derived air must stay constrained, or the maximizer may strip the gear.
 */
function breathingKeywords(plan: FamiliarPlan): string {
  const playerCovered = playerAirByEffect();
  const familiarCovered =
    familiarBreathesFree() ||
    (plan.familiar !== undefined && plan.familiar.underwater) ||
    (plan.famequip !== undefined && familiarWaterBreathingEquipment.includes(plan.famequip));
  if (!playerCovered && !familiarCovered) return ", sea";
  if (!playerCovered) return ", adventure underwater";
  if (!familiarCovered) return ", underwater familiar";
  return "";
}

/**
 * Kill Me (spooky lantern) when the plan one-shots within Noodles' stun coverage;
 * Hold Me (3-round stun) when we need more control than Noodles provides.
 * Both are the heck hero: it carries the stun on Hold Me and the lantern on Kill Me,
 * and its +30% Mysticality is the Saucegeyser damage term. See the spec's
 * outfit-combat contract.
 */
export function capeMode(spec: PearlSpec): "kill" | "hold" {
  const plan = damagePlan(spec.maxHp, ownedLanternProspect());
  return plan.casts <= 3 ? "kill" : "hold";
}

/**
 * The resistance objective, weighted so no tiebreaker can trade a resistance point away
 * below the cap. Overdrunk keeps weight 1: attack-only combat aborts unless the weapon
 * one-shots, so damage must stay able to outbid resistance there.
 */
export function pearlResObjective(spec: PearlSpec, overdrunk: boolean): string {
  const weight = overdrunk ? 1 : PEARL_RES_WEIGHT;
  return `${weight} ${spec.key} res ${PEARL_RES_CAP + PEARL_RES_HEADROOM} max`;
}

/**
 * The non-resistance weights, shared with the profit model so the dress and the estimate
 * optimize the same thing. No item-drop weight: `costZone` prices no item income.
 * Overdrunk chases the one-shot floor; 'effective' applies only when no weapon is forced,
 * since it could contradict the drunkweapon's class and fail every combination.
 */
export function pearlOutfitWeights(overdrunk: boolean, weaponForced: boolean): string {
  const combat = overdrunk
    ? `${weaponForced ? "" : ", effective"}, 0.2 weapon damage, 0.2 weapon damage percent`
    : "";
  return `, 0.05 hp regen, 0.05 mp regen${combat}`;
}

/** Items the real dress refuses. */
function pearlAvoidItems(spec: PearlSpec): Item[] {
  return [...GLOBAL_AVOID, ...(spec.avoid ?? [])];
}

/** Items the real dress refuses, as maximizer terms, so a speculation can refuse them too. */
export function pearlAvoidTerms(spec: PearlSpec): string {
  return pearlAvoidItems(spec)
    .map((i) => `, -"equip ${i}"`)
    .join("");
}

/**
 * Organ extenders every dress must wear: the required set (no adventuring without
 * them — Food Coma / jaundice), or every owned one under the overcapped flag.
 */
export function organEquipment(mode: LiverMode = liverMode()): Item[] {
  return args.major.overcapped ? allOrganEquipment(mode) : requiredOrganEquipment(mode);
}

/** Stooper pinned for its +1 liver, with breathing gear unless an effect covers it. */
function stooperFamiliarPlan(): FamiliarPlan {
  return {
    familiar: $familiar`Stooper`,
    famequip: familiarBreathesFree()
      ? undefined
      : familiarWaterBreathingEquipment.find((i) => have(i)),
  };
}

/**
 * Outfit for a Fishy trip (The Haggling, Lutz): no combat, so breathing is all it
 * asks the maximizer for — plus whatever keeps the character able to adventure at
 * all (issue #13): the organ extenders, the wineglass while overdrunk, and Stooper
 * while its +1 is the liver rescue. Dressing for breathing alone strips every one of
 * those, since the maximizer treats their slots as free; overfull or overspleened,
 * the trip then lands in Food Coma instead of The Haggling.
 */
export function buildFishyTripOutfit(): OutfitSpec {
  const mode = liverMode();
  const equip = [...organEquipment(mode)];
  if (mode === "wineglass") equip.push($item`Drunkula's wineglass`);
  const plan = mode === "stooper" ? stooperFamiliarPlan() : pickUtilityFamiliar();
  const spec: OutfitSpec = { equip, familiar: plan.familiar ?? $familiar.none };
  if (plan.famequip !== undefined) spec.famequip = plan.famequip;
  if (!playerAirByEffect()) spec.modifier = "adventure underwater";
  return spec;
}

/**
 * Slots the outfit commits before the maximizer gets a say: organ extenders, the
 * overdrunk weapon pair, the lantern gear and the cape's back slot. Override pieces are
 * not included; the caller adds them after the avoid filter. Exported so the profit
 * model speculates against the same slots, since pricing a zone with the back slot and
 * the lantern accessories free reports resistance the run cannot reach.
 */
export function pearlForcedEquipment(
  spec: PearlSpec,
  mode: LiverMode,
  // The profit model prices before the breathing task runs, so it passes its predicted
  // air; the dress passes what is actually up. The back slot's fate follows from it.
  airByEffect: () => boolean = playerAirByEffect,
  // Whether the Monodent takes the weapon slot. The models plan with the standing
  // answer (fishMaxxing); the dress passes the per-fight one, which also covers the
  // one fight in ten that an as-needed fish refreshes Fishy.
  fish: boolean = fishMaxxed(spec),
): { equip: Item[]; secondLantern?: Item } {
  const overdrunk = mode === "wineglass";
  const outfitName = outfitOverride(spec.key);
  const organEquip = organEquipment(mode);
  const equip: Item[] = [...organEquip];

  if (overdrunk) {
    // The wineglass IS the off-hand while overdrunk. A required angelbone totem
    // displaces the configured drunkweapon; otherwise it is forced when owned.
    equip.push($item`Drunkula's wineglass`);
    const totemForced = organEquip.includes($item`angelbone totem`);
    if (!totemForced && have(args.major.drunkweapon)) equip.push(args.major.drunkweapon);
  }

  // An outfit override owns every slot it names and all the damage gear, but its pieces
  // are added by the caller: they still have to pass the avoid filter first.
  if (outfitName !== undefined) return { equip };

  // Only as much lantern gear as the one-shot needs: a lantern is worth about an extra
  // cast, and the per-cast floor is computable. Overdrunk skips them, since lanterns
  // duplicate spell components and the wineglass kills spells.
  let secondLantern: Item | undefined;
  if (!overdrunk) {
    const needed = lanternComponentsNeededForOneShot(spec.maxHp);
    const accessoryBudget = 3 - organEquip.filter((i) => toSlot(i) === $slot`acc1`).length;
    const lanterns = selectLanternGear(
      Number.isFinite(needed) ? needed : Infinity,
      accessoryBudget,
    );
    equip.push(...lanterns.equip);
    secondLantern = lanterns.secondOffhand;
    // Weapon slot, not off-hand: the off-hand is the lantern's.
    if (fish) equip.push(MONODENT);
    // canEquip as well as have: the speculation drops a configuration whose forced gear
    // cannot be worn, so an owned-but-restricted cape would price the zone at zero.
    const cape = $item`unwrapped knock-off retro superhero cape`;
    if (have(cape) && canEquip(cape) && !backSlotNeededForAir(airByEffect)) equip.push(cape);
  }
  return { equip, secondLantern };
}

/**
 * The slots the run commits under a given air state: the forced gear plus an override
 * outfit's pieces, less the ones the dress refuses.
 */
export function pearlPlannedEquipment(
  spec: PearlSpec,
  mode: LiverMode = liverMode(),
  airByEffect: () => boolean = playerAirByEffect,
): Item[] {
  const equip = pearlForcedEquipment(spec, mode, airByEffect).equip;
  const outfitName = outfitOverride(spec.key);
  if (outfitName === undefined) return [...equip];
  const avoid = pearlAvoidItems(spec);
  const pieces = outfitPieces(outfitName).filter((p) => !avoid.includes(p));
  return [...equip, ...(fishMaxxed(spec) ? withMonodent(pieces) : pieces)];
}

/**
 * Damage priced from the gear the run commits, not what is worn when the command runs.
 * A floor: current air rather than predicted, the familiar's second lantern, and an
 * override's cape (whose kill mode the dress never sets) are left out.
 */
export function pearlDamagePlan(spec: PearlSpec, mode: LiverMode = liverMode()): DamagePlan {
  const equip = pearlPlannedEquipment(spec, mode, playerAirByEffect);
  const capeKills = outfitOverride(spec.key) === undefined && capeMode(spec) === "kill";
  return damagePlan(spec.maxHp, plannedLanternComponents(equip, capeKills));
}

export function buildPearlOutfit(spec: PearlSpec, familiarMode?: FamiliarMode): OutfitSpec {
  const overdrunk = wineglassMode();
  const outfitName = outfitOverride(spec.key);

  // Organ extenders first — they win their slots. Required extenders are the law
  // (no adventuring without them); the overcapped flag forces the full set for
  // consumption headroom. A forced corset simply occupies the shirt: the parka never
  // equips and its mode is a harmless no-op; the maximizer chases res elsewhere.
  const organEquip = organEquipment();
  const forced = pearlForcedEquipment(spec, liverMode(), playerAirByEffect, fishWanted(spec));
  const secondLantern = forced.secondLantern;
  // The cape is pushed below with its mode; keep it out of the shared list.
  const cape = $item`unwrapped knock-off retro superhero cape`;
  const equip: Item[] = forced.equip.filter((i) => i !== cape);

  const modes: Modes = {};
  if (outfitName === undefined && have($item`Jurassic Parka`)) modes.parka = spec.parkaMode;
  // The helper already decided the cape's slot; re-deciding here is how the model and
  // the dress drifted apart, and an ungated push would force gear canEquip rejects.
  if (forced.equip.includes(cape)) {
    equip.push(cape);
    modes.retrocape = ["heck", capeMode(spec)];
  }

  // Familiar precedence: Stooper liver-rescue pin (its +1 only counts while active)
  // → per-zone familiar override → the zone's settled familiar mode (user decision).
  const override = familiarOverride(spec.key);
  let familiarPlan: FamiliarPlan;
  if (liverMode() === "stooper") {
    if (override !== undefined && override !== $familiar`Stooper`) {
      if (!stooperNoticePrinted.has(spec.key)) {
        stooperNoticePrinted.add(spec.key);
        print(
          `pearlo: ${spec.key} familiar override ${override} displaced by Stooper (liver rescue needs its +1)`,
        );
      }
    }
    familiarPlan = stooperFamiliarPlan();
  } else if (override !== undefined) {
    // An override familiar gets breathing gear and nothing else — the Left-Hand Man
    // second-lantern hand-off does not apply to overrides (spec).
    const needsGear = !familiarBreathesFree() && !override.underwater;
    const famequip = needsGear ? familiarWaterBreathingEquipment.find((i) => have(i)) : undefined;
    if (needsGear && famequip === undefined) {
      abort(
        `pearlo: ${spec.key} familiar override ${override} cannot breathe underwater — ` +
          `own das boot / little bitty bathysphere, or get a familiar-air effect ` +
          `(Driving Waterproofly / Wet Willied), or drop the override.`,
      );
    }
    familiarPlan = { familiar: override, famequip };
  } else if (outfitName !== undefined) {
    // Outfit-override zones never escalate — the saved outfit IS the res plan, so a
    // res-switch familiar (which this path would drop anyway, since only
    // .familiar/.famequip are honored, never .extraModifier) makes no sense.
    // Always get a concrete utility/breathing familiar when one is available.
    familiarPlan = pickUtilityFamiliar();
  } else if ((familiarMode ?? familiarModeFor(spec.key)) === "switch") {
    // Escalated: hand the familiar slot to the maximizer via `switch` directives. With
    // no res familiar owned there is nothing to escalate to — take the utility plan.
    const switches = resFamiliarSwitches(spec);
    familiarPlan =
      switches.length > 0 ? { extraModifier: switches } : pickUtilityFamiliar(secondLantern);
  } else {
    // Default: always run a familiar (user decision), spending the slot on damage and
    // utility. The second lantern only reaches the Left-Hand Man when still needed.
    familiarPlan = pickUtilityFamiliar(secondLantern);
  }

  const avoid = pearlAvoidItems(spec);

  if (outfitName !== undefined) {
    // Saved-outfit override: the user's outfit IS the res plan. Its pieces are forced
    // through the normal equip path so grimoire's dress verifies them (and throws on
    // collisions with the mandatory layer — intended UX). The maximizer's only job is
    // patching air into slots the outfit leaves free.
    //
    // Grimoire's dress applies `spec.avoid` only to the maximizer's own picks, never to
    // forced `equip` items — so an avoided piece (Kramco, Möbius ring, etc.) sitting in
    // the saved outfit would otherwise be force-equipped despite being avoided. Filter
    // it out here instead of trusting `avoid` to catch it downstream.
    const pieces = outfitPieces(outfitName);
    const dropped = pieces.filter((p) => avoid.includes(p));
    const kept = pieces.filter((p) => !avoid.includes(p));
    if (dropped.length > 0 && !avoidNoticePrinted.has(spec.key)) {
      avoidNoticePrinted.add(spec.key);
      print(
        `pearlo: ${spec.key} outfit override dropped ${dropped.join(", ")} — avoided in pearl zones`,
        "red",
      );
    }

    // A kept piece that lands in a slot the mandatory layer (organ extenders, lanterns,
    // cape) already occupies will make grimoire's dress throw. Warn with the specific
    // slot/piece up front rather than leaving the user to decode dress's generic error;
    // don't abort here — the dress still throws its own error and is the real guard.
    const mandatorySlots = new Set(equip.map((i) => toSlot(i)));
    const collisions = kept.filter((p) => mandatorySlots.has(toSlot(p)));
    if (collisions.length > 0 && !collisionNoticePrinted.has(spec.key)) {
      collisionNoticePrinted.add(spec.key);
      for (const p of collisions) {
        print(
          `pearlo: ${spec.key} outfit override piece ${p} collides with mandatory ${toSlot(p)} gear — ` +
            `the dress will fail; remove it from the saved outfit or clear the override.`,
          "red",
        );
      }
    }

    // Fish fights override the saved weapon with the Monodent, said once per zone.
    const worn = fishWanted(spec) ? withMonodent(kept) : kept;
    const displaced = kept.filter((p) => !worn.includes(p));
    if (displaced.length > 0 && !monodentNoticePrinted.has(spec.key)) {
      monodentNoticePrinted.add(spec.key);
      print(
        `pearlo: ${spec.key} outfit override wields the Monodent of the Sea in place of ` +
          `${displaced.join(", ")} on fish fights`,
      );
    }
    equip.push(...worn);
    if (kept.includes($item`Jurassic Parka`)) modes.parka = spec.parkaMode;
    const breathing = breathingKeywords(familiarPlan).replace(/^, /, "");
    const result: OutfitSpec = { equip, modes, avoid };
    if (breathing.length > 0) result.modifier = breathing;
    if (familiarPlan.familiar) result.familiar = familiarPlan.familiar;
    if (familiarPlan.famequip) result.famequip = familiarPlan.famequip;
    return result;
  }

  // Overdrunk: weapon-damage weights chase the one-shot floor. 'effective' (weapon
  // class matched to the better attack stat) only applies when NO weapon is forced —
  // it could contradict the configured drunkweapon's class and fail every combination.
  const weaponForced =
    overdrunk && (organEquip.includes($item`angelbone totem`) || have(args.major.drunkweapon));
  const baseModifier = `${pearlResObjective(spec, overdrunk)}${breathingKeywords(familiarPlan)}${pearlOutfitWeights(overdrunk, weaponForced)}`;
  const result: OutfitSpec = {
    modifier: familiarPlan.extraModifier
      ? `${baseModifier}, ${familiarPlan.extraModifier}`
      : baseModifier,
    equip,
    modes,
    avoid,
  };
  if (familiarPlan.familiar) result.familiar = familiarPlan.familiar;
  if (familiarPlan.famequip) result.famequip = familiarPlan.famequip;
  return result;
}
