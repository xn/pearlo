import { Quest, Task, CombatStrategy } from "grimoire-kolmafia";
import {
  abort,
  availableAmount,
  canAdventure,
  getWorkshed,
  Item,
  myAdventures,
  numericModifier,
  print,
  retrieveItem,
  use,
} from "kolmafia";
import { $effect, $item, AsdonMartin, get, have, set } from "libram";

import { args } from "./args";
import { buildPearlMacro, damagePlan, weaponAttackPlan } from "./combat";
import { abortIfBeatenUp, asdonFualable, fuelUp, isOverDrunk } from "./lib";
import { pearlMood } from "./mood";
import { buildPearlOutfit } from "./outfit";
import {
  PEARL_RES_CAP,
  PEARLS,
  PearlKey,
  PearlSpec,
  canBreathUnderwater,
  printSeaworthyDebug,
} from "./zones";

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
  let plan = damagePlan(spec.maxHp);
  return {
    name: `${spec.loc}`,
    after: ["Breathe Underwater", ...spec.after],
    completed: () => get(spec.obtained),
    ready: () =>
      // Overdrunk farming is allowed only with Drunkula's wineglass (auto-detect).
      (!isOverDrunk() || have($item`Drunkula's wineglass`)) &&
      canAdventure(spec.loc) &&
      myAdventures() - args.debug.halt >= turnsNeeded(spec),
    prepare: () => {
      abortIfBeatenUp(`before adventuring in ${spec.loc}`);
      plan = damagePlan(spec.maxHp); // post-dress: real equipped modifiers
      pearlMood(spec, plan.mpPerFight);
      if (isOverDrunk()) {
        // Wineglass combat is attack-only: no stuns, no items. Policy (user): halt
        // entirely unless the equipped weapon one-shots the zone's toughest monster
        // with a guaranteed hit. Residual ~1/22 fumble risk is accepted.
        const attack = weaponAttackPlan(spec.maxDef, spec.maxHp);
        if (!attack.canOneShot) {
          abort(
            `pearlo: overdrunk in ${spec.loc} but the equipped weapon can't guarantee a one-shot ` +
              `(damage floor ${attack.damage} vs ${spec.maxHp} HP, hit ${attack.hitGuaranteed ? "guaranteed" : `NOT guaranteed vs Def ${spec.maxDef}`}). ` +
              `Attack-only combat can't stun — improve weapon damage/${attack.ranged ? "Moxie" : "Muscle"} or wait for rollover.`,
          );
        }
      }
      if (args.major.requirecap) {
        const resName = `${spec.key.charAt(0).toUpperCase()}${spec.key.slice(1)} Resistance`;
        const res = numericModifier(resName);
        if (res < PEARL_RES_CAP) {
          abort(
            `pearlo: ${spec.key} res is ${res} (< ${PEARL_RES_CAP} cap) in ${spec.loc} and requirecap is set — fights would yield ${1.7 * Math.floor(res / 3)}% instead of 10%. Add resistance or drop requirecap.`,
          );
        }
      }
    },
    do: spec.loc,
    choices: spec.choices ?? {},
    post: () => {
      abortIfBeatenUp(`after a combat in ${spec.loc}`);
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
