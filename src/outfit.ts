import { Modes, OutfitSpec } from "grimoire-kolmafia";
import { Item, canEquip, toSlot } from "kolmafia";
import { $familiar, $item, $items, $slot, have } from "libram";

import { args } from "./args";
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
  playerAirByEffect,
} from "./familiar";
import { allOrganEquipment, liverMode, requiredOrganEquipment, wineglassMode } from "./organs";
import { PearlSpec, familiarWaterBreathingEquipment, waterBreathingEquipment } from "./zones";

// Never let the maximizer equip these in pearl zones (user directives):
// - broken champagne bottle: its +item drains limited daily charges (2026-08-07)
// - Kramco Sausage-o-Matic™ (and replica): sausage goblin wanderers replace zone
//   adventures — turns without pearl progress (2026-08-08)
// - Möbius ring: interferes with zone adventuring (2026-08-08)
const GLOBAL_AVOID = $items`broken champagne bottle, Kramco Sausage-o-Matic™, replica Kramco Sausage-o-Matic™, Möbius ring`;

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

export function buildPearlOutfit(spec: PearlSpec): OutfitSpec {
  const overdrunk = wineglassMode();

  // Organ extenders first — they win their slots. Required extenders are the law
  // (no adventuring without them); the overcapped flag forces the full set for
  // consumption headroom. A forced corset simply occupies the shirt: the parka never
  // equips and its mode is a harmless no-op; the maximizer chases res elsewhere.
  const organEquip = args.major.overcapped ? allOrganEquipment() : requiredOrganEquipment();
  const equip: Item[] = [...organEquip];

  // Equip only as much lantern gear (any slot) as the one-shot actually needs —
  // a lantern ≈ an extra cast, and we know the per-cast floor, so the need is
  // computable (user design). Zero need = zero damage gear forced. Overdrunk:
  // lanterns duplicate SPELL components and the wineglass kills spells — skip all.
  let secondLantern: Item | undefined;
  if (!overdrunk) {
    const needed = lanternComponentsNeededForOneShot(spec.maxHp);
    const lanterns = selectLanternGear(Number.isFinite(needed) ? needed : Infinity);
    equip.push(...lanterns.equip);
    secondLantern = lanterns.secondOffhand;
  } else {
    // The wineglass IS the off-hand while overdrunk. A required angelbone totem
    // displaces the configured drunkweapon (best-effort attack combat, user decision);
    // otherwise the drunkweapon (default June cleaver) is forced when owned.
    equip.push($item`Drunkula's wineglass`);
    const totemForced = organEquip.includes($item`angelbone totem`);
    if (!totemForced && have(args.major.drunkweapon)) equip.push(args.major.drunkweapon);
  }

  const modes: Modes = {};
  if (have($item`Jurassic Parka`)) modes.parka = spec.parkaMode;
  if (
    !overdrunk &&
    have($item`unwrapped knock-off retro superhero cape`) &&
    !airRequiresBackSlot()
  ) {
    equip.push($item`unwrapped knock-off retro superhero cape`);
    modes.retrocape = ["heck", capeMode(spec)];
  }

  // Always run a familiar (user decision) via two-pass planning: benchmark res without
  // familiar help, then spend the slot on res (maximizer `switch` picks) or damage/utility.
  // The second lantern only reaches the Left-Hand Man when the one-shot still needs it.
  // Stooper rescue pins the familiar — its +1 liver only counts while active. It
  // breathes via famequip gear unless a familiar-air effect already covers it.
  const familiarPlan: FamiliarPlan =
    liverMode() === "stooper"
      ? {
          familiar: $familiar`Stooper`,
          famequip: familiarBreathesFree()
            ? undefined
            : familiarWaterBreathingEquipment.find((i) => have(i)),
        }
      : pickPearlFamiliar(spec, secondLantern);

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
    avoid: [...GLOBAL_AVOID, ...(spec.avoid ?? [])],
  };
  if (familiarPlan.familiar) result.familiar = familiarPlan.familiar;
  if (familiarPlan.famequip) result.famequip = familiarPlan.famequip;
  return result;
}
