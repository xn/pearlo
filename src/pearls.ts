import { Quest, Task, CombatStrategy, Modes } from "grimoire-kolmafia";
import {
  availableAmount,
  booleanModifier,
  canAdventure,
  canEquip,
  Element,
  getWorkshed,
  haveEffect,
  Item,
  Location,
  myAdventures,
  print,
  retrieveItem,
  use,
} from "kolmafia";
import {
  $effect,
  $element,
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

import { args } from "./args";
import { buildPearlMacro, damagePlan } from "./combat";
import { asdonFualable, fuelUp, isOverDrunk } from "./lib";
import { pearlMood } from "./mood";
import { buildPearlOutfit } from "./outfit";

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

export type PearlKey = "spooky" | "sleaze" | "hot" | "stench" | "cold";

export type PearlSpec = {
  key: PearlKey;
  loc: Location;
  element: Element;
  after: string[];
  modifier: string;
  parkaMode: Exclude<Modes["parka"], undefined>;
  obtained: BooleanProperty;
  progress: NumericProperty;
  avoid?: Item[];
};

export const PEARLS: PearlSpec[] = [
  {
    key: "spooky",
    loc: $location`Anemone Mine`,
    element: $element`spooky`,
    after: [],
    modifier: "spooky res",
    parkaMode: "ghostasaurus",
    obtained: "_unblemishedPearlAnemoneMine",
    progress: "_unblemishedPearlAnemoneMineProgress",
    avoid: $items`Mer-kin digpick`,
  },
  {
    key: "sleaze",
    loc: $location`The Dive Bar`,
    element: $element`sleaze`,
    after: [],
    modifier: "sleaze res",
    parkaMode: "spikolodon",
    obtained: "_unblemishedPearlDiveBar",
    progress: "_unblemishedPearlDiveBarProgress",
  },
  {
    key: "hot",
    loc: $location`The Marinara Trench`,
    element: $element`hot`,
    after: [],
    modifier: "hot res",
    parkaMode: "pterodactyl",
    obtained: "_unblemishedPearlMarinaraTrench",
    progress: "_unblemishedPearlMarinaraTrenchProgress",
  },
  {
    key: "stench",
    loc: $location`Madness Reef`,
    element: $element`stench`,
    after: [],
    modifier: "stench res",
    parkaMode: "dilophosaur",
    obtained: "_unblemishedPearlMadnessReef",
    progress: "_unblemishedPearlMadnessReefProgress",
  },
  {
    key: "cold",
    loc: $location`The Briniest Deepests`,
    element: $element`cold`,
    after: [],
    modifier: "cold res",
    parkaMode: "kachungasaur",
    obtained: "_unblemishedPearlTheBriniestDeepests",
    progress: "_unblemishedPearlTheBriniestDeepestsProgress",
  },
];

const breatheUnderwaterTask: Task = {
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
};

const observedProgressRate = new Map<PearlKey, number>();
const lastRecordedProgress = new Map<PearlKey, number>();

function turnsNeeded(spec: PearlSpec): number {
  const remaining = 100 - get(spec.progress, 0);
  const optimistic = 10; // 1.7 * floor(18/3), capped at 10 — see docs/sea-reference.md
  const rate = observedProgressRate.get(spec.key) ?? optimistic;
  const perTurn = have($effect`Fishy`) ? 1 : 2;
  return Math.ceil(remaining / Math.max(1.7, rate)) * perTurn;
}

function pearlTask(spec: PearlSpec): Task {
  let plan = damagePlan();
  return {
    name: `${spec.loc}`,
    after: ["Breathe Underwater", ...spec.after],
    completed: () => get(spec.obtained),
    ready: () =>
      !isOverDrunk() &&
      canAdventure(spec.loc) &&
      myAdventures() - args.debug.halt >= turnsNeeded(spec),
    prepare: () => {
      plan = damagePlan(); // post-dress: real equipped modifiers
      pearlMood(spec, plan.mpPerFight);
    },
    do: spec.loc,
    post: () => {
      const previousRate = observedProgressRate.get(spec.key);
      const progress = get(spec.progress, 0);
      const last = lastRecordedProgress.get(spec.key);
      if (last !== undefined && progress > last) {
        const delta = progress - last;
        observedProgressRate.set(
          spec.key,
          previousRate === undefined ? delta : (previousRate + delta) / 2,
        );
      }
      lastRecordedProgress.set(spec.key, progress);
    },
    outfit: () => buildPearlOutfit(spec),
    combat: new CombatStrategy().macro(() => buildPearlMacro(spec, plan)),
    limit: { soft: 30 },
  };
}

export function pearlTasks(selected: PearlSpec[]): Task[] {
  return [breatheUnderwaterTask, ...selected.map(pearlTask)];
}

export const PearlsQuest: Quest<Task> = {
  name: "Pearls",
  tasks: pearlTasks(PEARLS),
};
