import {
  Familiar,
  Item,
  getWorkshed,
  maximize,
  myFamiliar,
  numericModifier,
  print,
  useFamiliar,
} from "kolmafia";
import { $effects, $element, $familiar, $item, $items, get, have } from "libram";

import { args } from "./args";
import { asdonFualable } from "./lib";
import { PearlSpec, resModifierName } from "./zones";

export type FamiliarPlan = {
  familiar?: Familiar;
  famequip?: Item;
  extraModifier?: string;
};

// Familiar breathing that leaves the famequip slot free (docs/sea-reference.md §5).
const FAMILIAR_AIR_EFFECTS = $effects`Driving Waterproofly, Wet Willied`;

export function familiarBreathesFree(): boolean {
  return FAMILIAR_AIR_EFFECTS.some((ef) => have(ef));
}

// das boot (-10 lbs) preferred over little bitty bathysphere (-20 lbs).
const BREATHING_FAMEQUIP = $items`das boot, little bitty bathysphere`;

// Innate water-breathers useful as utility picks (docs/sea-reference.md §1.5):
// Space Jellyfish: 100% start-of-combat delevel + Trench/eel utilities.
// Barrrnacle / Emo Squid: start-of-combat delevelers.
// (Magic Dragonfish's spell% was evaluated and ruled out — not impactful enough; user 2026-08-07.)
const UTILITY_BREATHERS = [$familiar`Space Jellyfish`, $familiar`Barrrnacle`, $familiar`Emo Squid`];

// Cooler Yeti (famid 324): +1 Cold Resistance per 11 lbs, item drops, start-of-combat
// delevel (wiki Data:Cooler Yeti, fetched 2026-08-07). Newer than our typings — resolve
// by name at runtime; Familiar.get returns the none-familiar on mafia versions that
// don't know it, which have() then rejects.
function coolerYeti(): Familiar {
  return Familiar.get("Cooler Yeti");
}

// Effect-based air supplies for the player (docs/sea-reference.md §1.1).
const PLAYER_AIR_EFFECTS = $effects`Driving Waterproofly, Oxygenated Blood, Pneumatic, Pumped Stomach, Really Deep Breath, Mer-kinny Flavor, Hyperoxygenated Blood`;

/** Player air guaranteed by an active effect — no equipment slot involved. */
export function playerAirByEffect(): boolean {
  return PLAYER_AIR_EFFECTS.some((ef) => have(ef));
}

/**
 * Will the player's air be effect-based once the Breathe Underwater task has run?
 * Startup economics executes before that task, so the current playerAirByEffect()
 * models gear air on days the cascade grants effect air minutes later. Mirrors the
 * cascade's availability checks (pearls.ts) minus its retrieveItem attempts — a
 * slight understatement, i.e. conservative. airmode=auto counts as effect-capable:
 * when its gate picks gear instead, it proved the res tiers equal, so modeling
 * effect air introduces no tier error. Accepted optimism at the margin: when the
 * last effect expires with no sources left, tail zones fall back to gear air.
 */
export function predictedPlayerAirByEffect(): boolean {
  if (playerAirByEffect()) return true;
  if (args.resources.airmode === "gear") return false;
  return (
    (have($item`ballast turtle`) && !get("_ballastTurtleUsed")) ||
    (have($item`hyperinflated seal lung`) && !get("_hyperinflatedSealLungUsed", false)) ||
    (!get("_pneumaticityPotionUsed", false) && have($item`pressurized potion of pneumaticity`)) ||
    (!get("_tempuraAirUsed", false) && have($item`tempura air`)) ||
    (getWorkshed() === $item`Asdon Martin keyfob (on ring)` && asdonFualable(37))
  );
}

/**
 * Pass 1 of two-pass outfitting (user design, 2026-08-07): speculate WITHOUT familiar
 * help — is the 18-res cap reachable from gear/effects alone? `18 max 18 min` makes the
 * speculative maximize() return false exactly when the cap can't be met. Only constrain
 * player breathing, and only when it isn't already effect-covered (user refinement:
 * breathing keywords are needed exactly when an effect doesn't already guarantee air
 * independent of equipment choices).
 */
export function resCapMetWithoutFamiliar(spec: PearlSpec): boolean {
  // The speculation includes the ACTIVE familiar's contributions, which contaminated
  // the benchmark (session log 2026-08-07: res familiar equipped on fight N made
  // fight N+1 conclude "cap met without familiar", drop it, and fight at 8.3%/10% —
  // alternating). Drop the familiar first so the benchmark is honestly familiar-free.
  const priorFamiliar = myFamiliar();
  if (priorFamiliar !== $familiar.none) useFamiliar($familiar.none);
  const breathing = playerAirByEffect() ? "" : ", adventure underwater";
  const met = maximize(`${spec.key} res 18 max 18 min${breathing}`, true);
  // The 2026-08-07 fix above did NOT stop the flip-flop: session 2026-08-09 alternated
  // capMet true/false every Anemone Mine fight even familiar-free, tracking whichever
  // outfit the previous fight left equipped. Log the benchmark's inputs and answer each
  // call so the flapping input can be identified from a normal session log.
  print(
    `[pearlo/resbench] ${spec.key}: capMet=${met} wornRes=${numericModifier(resModifierName(spec.key))} ` +
      `priorFamiliar=${priorFamiliar} airByEffect=${playerAirByEffect()}`,
  );
  return met;
}

/**
 * Familiars worth offering the maximizer via `switch` when resistance still needs help:
 * elemental-res familiars plus the holding hands (whose extra off-hand/weapon slot the
 * maximizer fills with res gear). With `sea` in the string the maximizer also enforces
 * Underwater Familiar — it boot-equips or rejects non-breathers on its own.
 */
export function resFamiliarSwitches(spec: PearlSpec): string {
  const candidates: Familiar[] = [
    ...(spec.element === $element`cold` ? [coolerYeti()] : []),
    $familiar`Exotic Parrot`,
    $familiar`Mu`,
    $familiar`Left-Hand Man`,
    $familiar`Disembodied Hand`,
  ];
  return candidates
    .filter((f) => have(f))
    .map((f) => `switch ${f}`)
    .join(", ");
}

/**
 * Damage/utility familiar plan, independent of the res benchmark: holding hands with a
 * second lantern (breathing-free only), else delevel breathers, else a weight familiar
 * strapped with breathing gear, else no familiar. Used directly by outfit-override zones
 * (whose saved outfit already IS the res plan, so no res-switch offer applies) and as the
 * fallback tail of pickPearlFamiliar's two-pass plan.
 */
export function pickUtilityFamiliar(secondLantern?: Item): FamiliarPlan {
  if (familiarBreathesFree()) {
    for (const hand of [$familiar`Left-Hand Man`, $familiar`Disembodied Hand`]) {
      if (!have(hand)) continue;
      // Left-Hand Man takes the second lantern when we have one; otherwise leave the
      // slot open for the maximizer to fill.
      const holds = hand === $familiar`Left-Hand Man` ? secondLantern : undefined;
      return { familiar: hand, famequip: holds };
    }
  }

  for (const familiar of UTILITY_BREATHERS) {
    if (have(familiar)) return { familiar };
  }

  // Last resorts: strap breathing gear onto a weight familiar, else no familiar.
  const boot = BREATHING_FAMEQUIP.find((i) => have(i));
  if (boot) {
    const any = [$familiar`Exotic Parrot`, $familiar`Mu`, $familiar`Left-Hand Man`].find((f) =>
      have(f),
    );
    if (any) return { familiar: any, famequip: boot };
  }
  return {};
}

/**
 * Two-pass familiar planning (user design, 2026-08-07). Always run a familiar:
 * - Res cap already met without familiar help → the slot goes to damage/utility:
 *   holding hands with a second lantern (breathing-free only), else delevel breathers.
 * - Cap NOT met → hand the choice to the maximizer with `switch` directives over
 *   elemental familiars and the holding hands; it weighs their res contributions
 *   (including hand-held res gear) against the rest of the outfit.
 */
export function pickPearlFamiliar(spec: PearlSpec, secondLantern?: Item): FamiliarPlan {
  if (!resCapMetWithoutFamiliar(spec)) {
    const switches = resFamiliarSwitches(spec);
    if (switches.length > 0) return { extraModifier: switches };
    // No res-capable familiar owned — fall through to damage/utility below.
  }

  return pickUtilityFamiliar(secondLantern);
}
