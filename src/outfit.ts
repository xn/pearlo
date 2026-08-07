import { Modes, OutfitSpec } from "grimoire-kolmafia";
import { Item, canEquip, toSlot } from "kolmafia";
import { $item, $items, $slot, have } from "libram";

import {
  damagePlan,
  lanternComponents,
  lanternComponentsNeededForOneShot,
  ownedLanternProspect,
} from "./combat";
import {
  FamiliarPlan,
  familiarBreathesFree,
  pickPearlFamiliar,
  playerAirByEffect,
} from "./familiar";
import { PearlSpec, waterBreathingEquipment } from "./zones";

const OFFHAND_LANTERNS = $items`petrified wood water purifier, meteorb, snow mobile, big hot pepper`;

// Never let the maximizer spend scarce charges on pearl fights: the broken champagne
// bottle's +item drains its limited daily uses (user directive, 2026-08-07).
const GLOBAL_AVOID = $items`broken champagne bottle`;

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
    familiarBreathesFree() || (plan.familiar !== undefined && plan.familiar.underwater);
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
export function capeMode(): "kill" | "hold" {
  const plan = damagePlan(undefined, ownedLanternProspect());
  return plan.casts <= 3 ? "kill" : "hold";
}

export function buildPearlOutfit(spec: PearlSpec): OutfitSpec {
  // Equip only as much damage gear as the one-shot actually needs (user feedback:
  // full CMoI+lantern stacking is overkill) — greedy over component values.
  const equip: Item[] = [];
  let componentsNeeded = lanternComponentsNeededForOneShot();
  const ownedLanterns = OFFHAND_LANTERNS.filter((i) => have(i));
  let secondLantern: Item | undefined;
  if (componentsNeeded > 0 && ownedLanterns.length > 0) {
    equip.push(ownedLanterns[0]);
    componentsNeeded -= lanternComponents(ownedLanterns[0]);
  }
  if (componentsNeeded > 0 && have($item`Congressional Medal of Insanity`)) {
    equip.push($item`Congressional Medal of Insanity`);
    componentsNeeded -= lanternComponents($item`Congressional Medal of Insanity`);
  }
  if (componentsNeeded > 0 && ownedLanterns.length > 1) {
    secondLantern = ownedLanterns[1];
  }

  const modes: Modes = {};
  if (have($item`Jurassic Parka`)) modes.parka = spec.parkaMode;
  if (have($item`unwrapped knock-off retro superhero cape`) && !airRequiresBackSlot()) {
    equip.push($item`unwrapped knock-off retro superhero cape`);
    modes.retrocape = ["heck", capeMode()];
  }

  // Always run a familiar (user decision) via two-pass planning: benchmark res without
  // familiar help, then spend the slot on res (maximizer `switch` picks) or damage/utility.
  // The second lantern only reaches the Left-Hand Man when the one-shot still needs it.
  const familiarPlan = pickPearlFamiliar(spec, secondLantern);

  const baseModifier = `${spec.key} res 18 max${breathingKeywords(familiarPlan)}, 0.05 hp regen, 0.05 mp regen, 0.1 item`;
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
