import { Modes, OutfitSpec } from "grimoire-kolmafia";
import { Item, canEquip, toSlot } from "kolmafia";
import { $effects, $item, $items, $slot, have } from "libram";

import { damagePlan, ownedLanternProspect } from "./combat";
import { pickPearlFamiliar } from "./familiar";
import { PearlSpec, waterBreathingEquipment } from "./pearls";

const OFFHAND_LANTERNS = $items`petrified wood water purifier, meteorb, snow mobile, big hot pepper`;

// Effect-based air supplies (docs/sea-reference.md §1.1) — no equipment slot cost.
const AIR_EFFECTS = $effects`Driving Waterproofly, Oxygenated Blood, Pneumatic, Pumped Stomach, Really Deep Breath, Mer-kinny Flavor, Hyperoxygenated Blood`;

/** True when the only air supply we could bring is back-slot gear (old SCUBA tank etc.). */
function airRequiresBackSlot(): boolean {
  if (AIR_EFFECTS.some((ef) => have(ef))) return false;
  return !waterBreathingEquipment.some((i) => toSlot(i) !== $slot`back` && have(i) && canEquip(i));
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
  const equip: Item[] = [];
  if (have($item`Congressional Medal of Insanity`)) {
    equip.push($item`Congressional Medal of Insanity`);
  }
  const ownedLanterns = OFFHAND_LANTERNS.filter((i) => have(i));
  if (ownedLanterns.length > 0) equip.push(ownedLanterns[0]);

  const modes: Modes = {};
  if (have($item`Jurassic Parka`)) modes.parka = spec.parkaMode;
  if (have($item`unwrapped knock-off retro superhero cape`) && !airRequiresBackSlot()) {
    equip.push($item`unwrapped knock-off retro superhero cape`);
    modes.retrocape = ["heck", capeMode()];
  }

  // Always run a familiar (user decision): elemental res > holding hands > utility.
  const familiarPlan = pickPearlFamiliar(spec, ownedLanterns[1]);

  const result: OutfitSpec = {
    modifier: `${spec.key} res 18 max, sea, 0.05 hp regen, 0.05 mp regen, 0.1 init`,
    equip,
    modes,
    familiar: familiarPlan.familiar,
    avoid: spec.avoid,
  };
  if (familiarPlan.famequip) result.famequip = familiarPlan.famequip;
  return result;
}
