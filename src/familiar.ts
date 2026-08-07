import { Familiar, Item } from "kolmafia";
import { $effects, $element, $familiar, $items, have } from "libram";

import { PearlSpec } from "./pearls";

export type FamiliarPlan = {
  familiar: Familiar;
  famequip?: Item;
};

// Familiar breathing that leaves the famequip slot free (docs/sea-reference.md §5).
const FAMILIAR_AIR_EFFECTS = $effects`Driving Waterproofly, Wet Willied`;

export function familiarBreathesFree(): boolean {
  return FAMILIAR_AIR_EFFECTS.some((ef) => have(ef));
}

// das boot (-10 lbs) preferred over little bitty bathysphere (-20 lbs).
const BREATHING_FAMEQUIP = $items`das boot, little bitty bathysphere`;

// Innate water-breathers useful as utility picks (docs/sea-reference.md §1.5):
// Magic Dragonfish: +spell damage % = 2×weight, uncapped underwater — feeds Saucegeyser.
// Space Jellyfish: 100% start-of-combat delevel + Trench/eel utilities.
// Barrrnacle / Emo Squid: start-of-combat delevelers.
const UTILITY_BREATHERS = [
  $familiar`Magic Dragonfish`,
  $familiar`Space Jellyfish`,
  $familiar`Barrrnacle`,
  $familiar`Emo Squid`,
];

// Cooler Yeti (famid 324): +1 Cold Resistance per 11 lbs, item drops, start-of-combat
// delevel (wiki Data:Cooler Yeti, fetched 2026-08-07). Newer than our typings — resolve
// by name at runtime; Familiar.get returns the none-familiar on mafia versions that
// don't know it, which have() then rejects.
function coolerYeti(): Familiar {
  return Familiar.get("Cooler Yeti");
}

function withBreathing(familiar: Familiar, lanternForHands?: Item): FamiliarPlan | undefined {
  if (familiarBreathesFree()) return { familiar, famequip: lanternForHands };
  // Not free: the famequip slot must carry breathing gear, so holding familiars
  // lose their point entirely and weight familiars pay the boot's weight penalty.
  if (lanternForHands !== undefined) return undefined;
  const boot = BREATHING_FAMEQUIP.find((i) => have(i));
  if (boot) return { familiar, famequip: boot };
  return undefined;
}

/**
 * Always run a familiar (user decision, 2026-08-07). Priority ladder:
 * 1. Elemental-resistance familiar: Cooler Yeti (cold zones, +1/11 lbs), then
 *    Exotic Parrot / Mu (+1 to the zone element per 20 lbs).
 * 2. Left-Hand Man / Disembodied Hand holding a lantern — or, with no lantern to hold,
 *    an empty hand slot the maximizer fills with resistance equipment (it models the
 *    extra slot; see docs/maximizer-reference.md). Needs breathing-free effects.
 * 3. Utility: innate water-breathers (dragonfish for spell damage, jellyfish/barrrnacle/
 *    squid for deleveling) — these need no breathing support at all.
 * Falls back through the ladder by ownership and breathing feasibility.
 */
export function pickPearlFamiliar(spec: PearlSpec, secondLantern?: Item): FamiliarPlan {
  const elementals: Familiar[] = [
    ...(spec.element === $element`cold` ? [coolerYeti()] : []),
    $familiar`Exotic Parrot`,
    $familiar`Mu`,
  ];
  for (const familiar of elementals) {
    if (!have(familiar)) continue;
    const plan = withBreathing(familiar);
    if (plan) return plan;
  }

  if (familiarBreathesFree()) {
    for (const hand of [$familiar`Left-Hand Man`, $familiar`Disembodied Hand`]) {
      if (!have(hand)) continue;
      // Left-Hand Man takes the second lantern when we have one; otherwise leave the
      // slot open for the maximizer to fill with resistance gear.
      const holds = hand === $familiar`Left-Hand Man` ? secondLantern : undefined;
      return { familiar: hand, famequip: holds };
    }
  }

  for (const familiar of UTILITY_BREATHERS) {
    if (have(familiar)) return { familiar };
  }

  // Last resorts: anything we can strap breathing gear onto, else no familiar.
  const boot = BREATHING_FAMEQUIP.find((i) => have(i));
  if (boot) {
    const any = [$familiar`Exotic Parrot`, $familiar`Mu`, $familiar`Left-Hand Man`].find((f) =>
      have(f),
    );
    if (any) return { familiar: any, famequip: boot };
  }
  return { familiar: $familiar.none };
}
