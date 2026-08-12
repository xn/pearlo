import { Modes, OutfitSpec } from "grimoire-kolmafia";
import { Item, abort, canEquip, outfitPieces, print, toSlot } from "kolmafia";
import { $familiar, $item, $items, $slot, have } from "libram";

import { args, familiarOverride, outfitOverride } from "./args";
import {
  damagePlan,
  lanternComponentsNeededForOneShot,
  ownedLanternProspect,
  selectLanternGear,
} from "./combat";
import {
  FamiliarPlan,
  familiarBreathesFree,
  pickPearlFamiliar,
  pickUtilityFamiliar,
  playerAirByEffect,
} from "./familiar";
import { allOrganEquipment, liverMode, requiredOrganEquipment, wineglassMode } from "./organs";
import { PearlSpec, familiarWaterBreathingEquipment, waterBreathingEquipment } from "./zones";

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

/**
 * Which familiar plan the last buildPearlOutfit took for each zone. "switch" is the
 * only path where the maximizer picks the familiar itself — and the only one observed
 * landing below the res cap (session 2026-08-09: parrot builds fought at 8.3%/fight),
 * so it's the only path the post-dress fallback in pearls.ts re-dresses away from.
 */
export type FamiliarPlanPath =
  "stooper" | "familiar-override" | "outfit-override" | "switch" | "utility";
const familiarPlanPaths = new Map<string, FamiliarPlanPath>();

export function familiarPlanPathFor(key: string): FamiliarPlanPath | undefined {
  return familiarPlanPaths.get(key);
}

/** True when the only air supply we could bring is back-slot gear (old SCUBA tank etc.). */
function airRequiresBackSlot(): boolean {
  if (playerAirByEffect()) return false;
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
 * See the outfit-combat contract in the spec.
 */
export function capeMode(spec: PearlSpec): "kill" | "hold" {
  const plan = damagePlan(spec.maxHp, ownedLanternProspect());
  return plan.casts <= 3 ? "kill" : "hold";
}

export function buildPearlOutfit(spec: PearlSpec, forceUtilityFamiliar = false): OutfitSpec {
  const overdrunk = wineglassMode();
  const outfitName = outfitOverride(spec.key);

  // Organ extenders first — they win their slots. Required extenders are the law
  // (no adventuring without them); the overcapped flag forces the full set for
  // consumption headroom. A forced corset simply occupies the shirt: the parka never
  // equips and its mode is a harmless no-op; the maximizer chases res elsewhere.
  const organEquip = args.major.overcapped ? allOrganEquipment() : requiredOrganEquipment();
  const equip: Item[] = [...organEquip];

  if (overdrunk) {
    // The wineglass IS the off-hand while overdrunk. A required angelbone totem
    // displaces the configured drunkweapon (best-effort attack combat, user decision);
    // otherwise the drunkweapon (default June cleaver) is forced when owned.
    equip.push($item`Drunkula's wineglass`);
    const totemForced = organEquip.includes($item`angelbone totem`);
    if (!totemForced && have(args.major.drunkweapon)) equip.push(args.major.drunkweapon);
  }

  // Equip only as much lantern gear (any slot) as the one-shot actually needs —
  // a lantern ≈ an extra cast, and we know the per-cast floor, so the need is
  // computable (user design). Zero need = zero damage gear forced. Overdrunk:
  // lanterns duplicate SPELL components and the wineglass kills spells — skip all.
  // An outfit override owns ALL damage gear itself — skip lanterns there too.
  let secondLantern: Item | undefined;
  if (!overdrunk && outfitName === undefined) {
    const needed = lanternComponentsNeededForOneShot(spec.maxHp);
    const accessoryBudget = 3 - organEquip.filter((i) => toSlot(i) === $slot`acc1`).length;
    const lanterns = selectLanternGear(
      Number.isFinite(needed) ? needed : Infinity,
      accessoryBudget,
    );
    equip.push(...lanterns.equip);
    secondLantern = lanterns.secondOffhand;
  }

  const modes: Modes = {};
  if (outfitName === undefined && have($item`Jurassic Parka`)) modes.parka = spec.parkaMode;
  if (
    !overdrunk &&
    outfitName === undefined &&
    have($item`unwrapped knock-off retro superhero cape`) &&
    !airRequiresBackSlot()
  ) {
    equip.push($item`unwrapped knock-off retro superhero cape`);
    modes.retrocape = ["heck", capeMode(spec)];
  }

  // Familiar precedence: Stooper liver-rescue pin (its +1 only counts while active)
  // → per-zone familiar override → two-pass computed plan (user decision).
  const override = familiarOverride(spec.key);
  let familiarPlan: FamiliarPlan;
  let planPath: FamiliarPlanPath;
  if (liverMode() === "stooper") {
    if (override !== undefined && override !== $familiar`Stooper`) {
      if (!stooperNoticePrinted.has(spec.key)) {
        stooperNoticePrinted.add(spec.key);
        print(
          `pearlo: ${spec.key} familiar override ${override} displaced by Stooper (liver rescue needs its +1)`,
        );
      }
    }
    familiarPlan = {
      familiar: $familiar`Stooper`,
      famequip: familiarBreathesFree()
        ? undefined
        : familiarWaterBreathingEquipment.find((i) => have(i)),
    };
    planPath = "stooper";
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
    planPath = "familiar-override";
  } else if (outfitName !== undefined) {
    // Outfit-override zones skip the res benchmark entirely — the saved outfit IS the
    // res plan, so a res-switch familiar (which the override path would drop anyway,
    // since only .familiar/.famequip are honored, never .extraModifier) makes no sense.
    // Always get a concrete utility/breathing familiar when one is available.
    familiarPlan = pickUtilityFamiliar();
    planPath = "outfit-override";
  } else if (forceUtilityFamiliar) {
    // Post-dress fallback (pearls.ts): the switch-path build landed under the res cap
    // in the real game — skip the benchmark and take the utility plan directly.
    familiarPlan = pickUtilityFamiliar(secondLantern);
    planPath = "utility";
  } else {
    // Always run a familiar (user decision) via two-pass planning: benchmark res
    // without familiar help, then spend the slot on res (maximizer `switch` picks) or
    // damage/utility. The second lantern only reaches the Left-Hand Man when the
    // one-shot still needs it.
    familiarPlan = pickPearlFamiliar(spec, secondLantern);
    planPath = familiarPlan.extraModifier !== undefined ? "switch" : "utility";
  }
  familiarPlanPaths.set(spec.key, planPath);

  const avoid = [...GLOBAL_AVOID, ...(spec.avoid ?? [])];

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

    equip.push(...kept);
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
  const combatWeights = overdrunk
    ? `${weaponForced ? "" : ", effective"}, 0.2 weapon damage, 0.2 weapon damage percent`
    : ", 0.1 item";
  const baseModifier = `${spec.key} res 18 max${breathingKeywords(familiarPlan)}, 0.05 hp regen, 0.05 mp regen${combatWeights}`;
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
