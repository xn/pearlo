import { Quest, Task, CombatStrategy, Outfit, OutfitSpec } from "grimoire-kolmafia";
import {
  abort,
  availableAmount,
  canAdventure,
  cliExecute,
  getWorkshed,
  haveEffect,
  haveEquipped,
  Item,
  myAdventures,
  numericModifier,
  print,
  retrieveItem,
  use,
} from "kolmafia";
import { $effect, $familiar, $item, $location, AsdonMartin, get, have, Macro, set } from "libram";

import { args } from "./args";
import { buildPearlMacro, damagePlan, weaponAttackPlan, wineglassAccessible } from "./combat";
import { zoneVerdict } from "./economics";
import { pickUtilityFamiliar, playerAirByEffect } from "./familiar";
import { acquireLucky, luckySourceAvailable, remainingPearlFights } from "./fishy";
import { abortIfBeatenUp, asdonFualable, fuelUp } from "./lib";
import { pearlMood } from "./mood";
import { wineglassMode } from "./organs";
import { buildPearlOutfit, familiarPlanPathFor } from "./outfit";
import {
  PEARL_RES_CAP,
  PEARLS,
  PearlKey,
  PearlSpec,
  canBreathUnderwater,
  printSeaworthyDebug,
  resModifierName,
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

/**
 * Fishy refresh (docs/superpowers/specs/2026-08-08-lucky-fishy-design.md): when Fishy
 * is down to ≤1 turn, acquire Lucky! and adventure in The Brinier Deepers — its lucky
 * NC "The Haggling" grants 20 turns of Fishy. Placed before the zone tasks: list
 * position is grimoire priority, so this preempts zones whenever Fishy runs low. NOT
 * in any zone's `after` — with no Lucky! source left this task simply never readies
 * and zones fall back to 2-turn fights.
 */
function getFishyTask(selected: PearlSpec[]): Task {
  return {
    name: "Get Fishy",
    after: ["Breathe Underwater"],
    // >1 (not >0): with exactly 1 turn left the trip itself still rides the old
    // Fishy turn (The Haggling costs 1 adventure with Fishy, 2 without).
    completed: () => haveEffect($effect`Fishy`) > 1,
    ready: () =>
      args.resources.luckyfishy &&
      canBreathUnderwater() &&
      // The free fishy pipe is strictly cheaper (no turn, no Lucky!) — let
      // pearlMood spend it first; this task covers the post-pipe day.
      !(have($item`fishy pipe`) && !get("_fishyPipeUsed")) &&
      remainingPearlFights(selected) > 0 &&
      (have($effect`Lucky!`) || luckySourceAvailable(remainingPearlFights(selected))) &&
      myAdventures() - args.debug.halt >= (haveEffect($effect`Fishy`) > 0 ? 1 : 2),
    prepare: () => {
      // A worn Peridot of Peril could fire its monster-select NC (1557) here instead
      // of the guaranteed Haggling — and any combat trips this task's abort macro.
      // The trip outfit doesn't ask for the Peridot, but a copy left equipped by a
      // previous dress survives (this outfit maximizes nothing beyond breathing).
      if (haveEquipped($item`Peridot of Peril`)) cliExecute("unequip Peridot of Peril");
      if (!acquireLucky(remainingPearlFights(selected))) {
        abort(
          "pearlo: could not acquire Lucky! for the Fishy refresh — every source in " +
            "the cascade failed. The Brinier Deepers is not safe without it.",
        );
      }
    },
    do: $location`The Brinier Deepers`,
    outfit: (): OutfitSpec => {
      // Noncombat trip: only breathing matters. pickUtilityFamiliar guarantees a
      // familiar that can breathe (or none); the maximizer patches player breathing
      // only when no effect already covers it.
      const plan = pickUtilityFamiliar();
      const spec: OutfitSpec = { familiar: plan.familiar ?? $familiar.none };
      if (plan.famequip !== undefined) spec.famequip = plan.famequip;
      if (!playerAirByEffect()) spec.modifier = "adventure underwater";
      return spec;
    },
    // With Lucky! up the encounter is guaranteed to be The Haggling; a combat means
    // the plan is broken (out-of-plan monsters here) — fail loudly.
    combat: new CombatStrategy().macro(Macro.abort()),
    limit: { soft: 10 }, // realistic ceiling ~6 refreshes/day
  };
}

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
      // Wineglass farming needs the glass reachable in inventory — closeted copies
      // satisfy have() but not the maximizer or dress.
      (!wineglassMode() || wineglassAccessible()) &&
      // Profit gate: zoneVerdict is cached after its first computation, so this stays
      // cheap for the engine's per-iteration ready() polling.
      (args.major.force || zoneVerdict(spec).go) &&
      canAdventure(spec.loc) &&
      myAdventures() - args.debug.halt >= turnsNeeded(spec),
    prepare: () => {
      abortIfBeatenUp(`before adventuring in ${spec.loc}`);
      // Post-dress res verification (session 2026-08-09): switch-path builds landed at
      // 15–17 real res while the maximizer's model said 18 — 8.3%/fight instead of 10%.
      // When that happens, re-dress with the utility-familiar build, which hit the cap
      // every fight that session. Runs before damagePlan/mood so both see final gear.
      const dressedRes = numericModifier(resModifierName(spec.key));
      if (dressedRes < PEARL_RES_CAP && familiarPlanPathFor(spec.key) === "switch") {
        print(
          `pearlo: ${spec.loc} dressed to ${dressedRes} ${spec.key} res (< ${PEARL_RES_CAP} cap) on the ` +
            `maximizer switch path — re-dressing with the utility-familiar build`,
          "red",
        );
        Outfit.from(
          buildPearlOutfit(spec, true),
          new Error(`pearlo: fallback outfit for ${spec.loc} could not be built`),
        ).dress();
        print(
          `pearlo: ${spec.loc} fallback build reaches ${numericModifier(resModifierName(spec.key))} ${spec.key} res`,
        );
      }
      plan = damagePlan(spec.maxHp); // post-dress: real equipped modifiers
      pearlMood(spec, plan.mpPerFight);
      if (wineglassMode()) {
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
        const res = numericModifier(resModifierName(spec.key));
        if (res < PEARL_RES_CAP) {
          abort(
            `pearlo: ${spec.key} res is ${res} (< ${PEARL_RES_CAP} cap) in ${spec.loc} and requirecap is set — fights would yield ${1.7 * Math.floor(res / 3)}% instead of 10%. Add resistance or drop requirecap.`,
          );
        }
      }
    },
    do: spec.loc,
    // 1557 = Peering Through Your Peridot (first adventure of the day per zone with
    // the Peridot of Peril equipped — the maximizer picks it for its +item/regen).
    // Selecting a monster enters that fight immediately (no turn lost), so answer with
    // the zone's safest pick; unanswered, the NC halts the script. Property format
    // "1&bandersnatch=<monsterid>" is mafia's Map-the-Monsters-style encoding.
    choices: { ...(spec.choices ?? {}), 1557: `1&bandersnatch=${spec.peridotMonster.id}` },
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
  return [breatheUnderwaterTask, getFishyTask(selected), ...selected.map(pearlTask)];
}

export const PearlsQuest: Quest<Task> = {
  name: "Pearls",
  tasks: pearlTasks(PEARLS),
};
