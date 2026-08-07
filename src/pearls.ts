import { Quest, Task, OutfitSpec, CombatStrategy } from "grimoire-kolmafia";
import {
  availableAmount,
  booleanModifier,
  canEquip,
  Effect,
  getWorkshed,
  haveEffect,
  Item,
  Location,
  print,
  retrieveItem,
  use,
} from "kolmafia";
import {
  $effect,
  $item,
  $items,
  $location,
  AsdonMartin,
  BooleanProperty,
  get,
  have,
  NumericProperty,
  set,
} from "libram";

import { asdonFualable, fuelUp, tryAcquiringEffect } from "./lib";

/** Log Fishy / underwater state (call from main or when debugging seaworthy). */
export function printSeaworthyDebug(where: string): void {
  const fishyTurns = haveEffect($effect`Fishy`);
  print(
    `[pearlo/seaworthy ${where}] Fishy turns=${fishyTurns} | adventure underwater modifier=${booleanModifier("Adventure Underwater")} | _subAquaEquipBreathing=${get("_subAquaEquipBreathing", false)} | canBreathUnderwater=${canBreathUnderwater()} | isFishy=${isFishy()} | isSeaworthy=${isSeaworthy()}`,
  );
}

export function isSeaworthy(): boolean {
  return isFishy() && canBreathUnderwater();
}

export function isFishy(): boolean {
  return have($effect`Fishy`);
}

export function canBreathUnderwater(): boolean {
  return (
    booleanModifier("Adventure Underwater") ||
    (get("_subAquaEquipBreathing", false) &&
      waterBreathingEquipment.some((item) => have(item) && canEquip(item)))
  );
}

export const waterBreathingEquipment = $items`The Crown of Ed the Undying, aerated diving helmet, crappy Mer-kin mask, Mer-kin gladiator mask, Mer-kin scholar mask, old SCUBA tank, Elf Guard SCUBA tank`;
export const familiarWaterBreathingEquipment = $items`das boot, little bitty bathysphere`;

type PearlSpec = {
  loc: Location;
  after: string[];
  modifier: string;
  obtained: BooleanProperty;
  progress: NumericProperty;
  avoid?: Item[];
};

const PEARLS: PearlSpec[] = [
  {
    loc: $location`Anemone Mine`,
    after: [],
    modifier: "spooky res",
    obtained: "_unblemishedPearlAnemoneMine",
    progress: "_unblemishedPearlAnemoneMineProgress",
    avoid: $items`Mer-kin digpick`,
  },
  {
    loc: $location`The Dive Bar`,
    after: [],
    modifier: "sleaze res",
    obtained: "_unblemishedPearlDiveBar",
    progress: "_unblemishedPearlDiveBarProgress",
  },
  {
    loc: $location`The Marinara Trench`,
    after: [],
    modifier: "hot res",
    obtained: "_unblemishedPearlMarinaraTrench",
    progress: "_unblemishedPearlMarinaraTrenchProgress",
  },
  {
    loc: $location`Madness Reef`,
    after: [],
    modifier: "stench res",
    obtained: "_unblemishedPearlMadnessReef",
    progress: "_unblemishedPearlMadnessReefProgress",
  },
  {
    loc: $location`The Briniest Deepests`,
    after: [],
    modifier: "cold res",
    obtained: "_unblemishedPearlTheBriniestDeepests",
    progress: "_unblemishedPearlTheBriniestDeepestsProgress",
  },
];

export const PearlsQuest: Quest<Task> = {
  name: "Pearls",
  tasks: [
    {
      name: "Breathe Underwater",
      completed: () => canBreathUnderwater(),
      do: () => {
        print('[pearlo/seaworthy] task "Breathe Underwater": picking a breathing strategy…');
        const tryAcquireAndUse = (item: Item, label: string): boolean => {
          print(`[pearlo/seaworthy] → ${label}`);
          if (availableAmount(item) <= 0) retrieveItem(item);
          if (availableAmount(item) <= 0) {
            print(`[pearlo/seaworthy] ${label} unavailable; trying next breathing strategy`);
            return false;
          }
          if (!use(item)) {
            print(`[pearlo/seaworthy] ${label} failed to use; trying next breathing strategy`);
            return false;
          }
          return true;
        };

        let strategySucceeded = false;

        if (have($item`ballast turtle`) && !get("_ballastTurtleUsed")) {
          print("[pearlo/seaworthy] → using ballast turtle");
          strategySucceeded = use($item`ballast turtle`);
        }
        if (strategySucceeded) {
          printSeaworthyDebug("after Breathe Underwater do()");
          return;
        }

        if (have($item`hyperinflated seal lung`) && !get("_hyperinflatedSealLungUsed", false)) {
          print("[pearlo/seaworthy] → using hyperinflated seal lung");
          strategySucceeded = use($item`hyperinflated seal lung`);
        }
        if (strategySucceeded) {
          printSeaworthyDebug("after Breathe Underwater do()");
          return;
        }

        if (!get("_pneumaticityPotionUsed", false)) {
          strategySucceeded = tryAcquireAndUse(
            $item`pressurized potion of pneumaticity`,
            "pressurized potion of pneumaticity",
          );
        }
        if (strategySucceeded) {
          printSeaworthyDebug("after Breathe Underwater do()");
          return;
        }

        if (!get("_tempuraAirUsed", false)) {
          strategySucceeded = tryAcquireAndUse($item`tempura air`, "tempura air");
        }
        if (strategySucceeded) {
          printSeaworthyDebug("after Breathe Underwater do()");
          return;
        }

        if (getWorkshed() === $item`Asdon Martin keyfob (on ring)` && asdonFualable(37)) {
          print("[pearlo/seaworthy] → Asdon Waterproofly");
          fuelUp();
          strategySucceeded = AsdonMartin.drive(AsdonMartin.Driving.Waterproofly);
        }

        if (!strategySucceeded) {
          print(
            "[pearlo/seaworthy] → no consumable/Asdon path succeeded; setting _subAquaEquipBreathing (equip breathing gear)",
          );
          set("_subAquaEquipBreathing", true);
        }

        printSeaworthyDebug("after Breathe Underwater do()");
      },
      limit: { soft: 1000 },
    },
    ...PEARLS.map((p: PearlSpec): Task => ({
      name: `${p.loc}`,
      after: p.after,
      completed: () => get(p.obtained),
      prepare: () => {
        const usefulEffects: Effect[] = [
          $effect`Astral Shell`,
          $effect`Egged On`,
          $effect`Elemental Saucesphere`,
          $effect`Feeling Peaceful`,
          $effect`Blood Bond`,
          $effect`Empathy`,
          $effect`Scarysauce`,
          $effect`Scariersauce`,
          $effect`Feeling Peaceful`,
          $effect`Leash of Linguini`,
          $effect`A Few Extra Pounds`,
          $effect`Big`,
          $effect`Mariachi Mood`,
          $effect`Patience of the Tortoise`,
          $effect`Power Ballad of the Arrowsmith`,
          $effect`Quiet Determination`,
          $effect`Reptilian Fortitude`,
          $effect`Saucemastery`,
          $effect`Seal Clubbing Frenzy`,
          $effect`Song of Starch`,
          $effect`Stevedave's Shanty of Superiority`,
        ];
        usefulEffects.forEach((ef) => tryAcquiringEffect(ef, true));
      },
      do: p.loc,
      combat: new CombatStrategy(),
      outfit: () => {
        const result: OutfitSpec = {
          modifier: p.modifier,
          avoid: p.avoid,
        };
        return result;
      },
      limit: { soft: 20 },
    })),
  ],
};
