import { Quest, Task, CombatStrategy, Outfit } from "grimoire-kolmafia";
import {
  abort,
  availableAmount,
  canAdventure,
  canEquip,
  cliExecute,
  equip,
  equippedItem,
  getWorkshed,
  haveEffect,
  haveEquipped,
  Item,
  itemAmount,
  maximize,
  myAdventures,
  numericModifier,
  outfitPieces,
  print,
  retrieveItem,
  use,
} from "kolmafia";
import {
  $effect,
  $item,
  $location,
  AsdonMartin,
  EternityCodpiece,
  get,
  have,
  Macro,
  set,
} from "libram";

import { args, outfitOverride } from "./args";
import {
  buildPearlMacro,
  buildWandererMacro,
  damagePlan,
  WANDERER_MONSTERS,
  weaponAttackPlan,
  wineglassAccessible,
} from "./combat";
import { primeZoneVerdicts, resStepWorthIt, turnsForFights, zoneVerdict } from "./economics";
import { resFamiliarSwitches } from "./familiar";
import {
  acquireLucky,
  luckySourceAvailable,
  lutzFishyAvailable,
  remainingPearlFights,
  visitLutz,
} from "./fishy";
import { abortIfBeatenUp, asdonFualable, fuelUp, handlePostCombatBeatenUp } from "./lib";
import { WorthIt, castFreeResBuffs, pearlMood, topUpFamiliarWeight, topUpRes } from "./mood";
import { adventuringBlockedBy, wineglassMode } from "./organs";
import {
  FamiliarMode,
  buildFishyTripOutfit,
  buildPearlOutfit,
  familiarModeApplies,
  familiarModeFor,
  setFamiliarMode,
} from "./outfit";
import {
  PEARL_RES_CAP,
  PEARLS,
  PearlKey,
  PearlSpec,
  canBreathUnderwater,
  printSeaworthyDebug,
  progressRatePct,
  resModifierName,
  waterBreathingEquipment,
} from "./zones";

/** True when this zone's assigned outfit already carries owned, equippable breathing gear. */
function outfitCoversBreathing(spec: PearlSpec): boolean {
  const name = outfitOverride(spec.key);
  if (name === undefined) return false;
  return outfitPieces(name).some(
    (piece) => waterBreathingEquipment.includes(piece) && have(piece) && canEquip(piece),
  );
}

/**
 * airmode=auto speculative gate: does effect-based air (every slot free for res) reach a
 * higher progress tier than gear-based air (the maximizer must keep "adventure underwater"
 * satisfied by equipment)? Both speculations run back-to-back against identical character
 * state, so familiar/mood/leftover-gear contamination cancels out of the comparison; the
 * mandatory equip layer (organ extenders, lanterns) is invisible to both sides equally.
 * A false return from the gear-side maximize means its boolean air requirement is unmet —
 * gear can't cover this zone at all, so the effect is needed regardless of tier.
 */
function effectAirBuysTier(spec: PearlSpec): boolean {
  const gearOk = maximize(`${spec.key} res ${PEARL_RES_CAP} max, adventure underwater`, true);
  const gearRes = numericModifier("Generated:_spec", resModifierName(spec.key));
  maximize(`${spec.key} res ${PEARL_RES_CAP} max`, true);
  const effectRes = numericModifier("Generated:_spec", resModifierName(spec.key));
  // Compared on the real rate model: res 0-2 and 3-5 both farm at the 1.7 floor, so a
  // freed slot that only reaches the first tier buys nothing.
  const buys = !gearOk || progressRatePct(effectRes) > progressRatePct(gearRes);
  print(
    `[pearlo/airmode] ${spec.key}: gear-air res ${gearRes}${gearOk ? "" : " (air requirement unmet)"} vs effect-air res ${effectRes} → effect air ${buys ? "buys a progress tier" : "buys nothing"}`,
  );
  return buys;
}

function breatheUnderwaterTask(selected: PearlSpec[]): Task {
  return {
    name: "Breathe Underwater",
    completed: () => canBreathUnderwater(),
    do: () => {
      print('[pearlo/seaworthy] task "Breathe Underwater": picking a breathing strategy…');

      // The check runs before any zone has dressed, so gear the zone outfits will equip
      // (really, really nice swimming trunks in an assigned outfit) isn't active yet —
      // burning a 1/day consumable on top of it is pure waste. When EVERY remaining zone's
      // assigned outfit carries its own air, take the equip-gear path directly. (Gear must
      // be in waterBreathingEquipment so canBreathUnderwater() turns true afterward.)
      const remaining = selected.filter((spec) => !get(spec.obtained));
      if (remaining.length > 0 && remaining.every(outfitCoversBreathing)) {
        print(
          "[pearlo/seaworthy] → every remaining zone's assigned outfit includes breathing gear; skipping consumables",
        );
        set("_subAquaEquipBreathing", true);
        printSeaworthyDebug("after Breathe Underwater do()");
        return;
      }

      // airmode: gear = never spend consumables; auto = spend them only when the
      // speculative gate says a freed slot buys a progress tier somewhere. Either way
      // the gear-equip path is only safe when gear exists — canBreathUnderwater()
      // stays false otherwise and this task would loop to its limit.
      const airmode = args.resources.airmode;
      if (airmode !== "effects") {
        const gearOwned = waterBreathingEquipment.some((item) => have(item) && canEquip(item));
        if (airmode === "gear") {
          if (!gearOwned) {
            abort(
              "pearlo: airmode=gear but no equippable breathing gear is owned " +
                "(aerated diving helmet, old SCUBA tank, really, really nice swimming trunks, …) — " +
                "acquire some or switch airmode.",
            );
          }
          print("[pearlo/seaworthy] → airmode=gear: equipping breathing gear, no consumables");
          set("_subAquaEquipBreathing", true);
          printSeaworthyDebug("after Breathe Underwater do()");
          return;
        }
        if (gearOwned && remaining.length > 0 && !remaining.some(effectAirBuysTier)) {
          print(
            "[pearlo/seaworthy] → airmode=auto: gear air matches effect air in every remaining zone; skipping consumables",
          );
          set("_subAquaEquipBreathing", true);
          printSeaworthyDebug("after Breathe Underwater do()");
          return;
        }
        print(
          "[pearlo/seaworthy] → airmode=auto: effect air is worth a progress tier; running the consumable cascade",
        );
      }
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
}

/**
 * Lutz's free 30 turns of Fishy, taken before any zone is farmed. The budget counts the
 * visit while it is still only on offer, so whichever way it goes the zones priced
 * against it are re-priced here, while that verdict can still change what runs.
 *
 * The visit needs water breathing up NOW, not merely obtainable: on a gear-air day
 * Breathe Underwater only flags that the zone outfits will wear the gear, and nothing
 * is worn yet when this task runs. Dress for it the way the Get Fishy trip does, or
 * the one attempt is spent on a skip and the day's cheapest Fishy is lost (issue #11).
 */
function lutzTask(selected: PearlSpec[]): Task {
  return {
    name: "Lutz Fishy",
    after: ["Breathe Underwater"],
    // visitLutz spends its one attempt whatever happens, so this always settles.
    completed: () => !lutzFishyAvailable(),
    // Page visit, no combat: breathing, plus the organ layer the zones wear — a dress
    // that drops a spleen extender at the raised cap leaves the character jaundiced
    // (docs/consumption-reference.md §4, issue #13).
    outfit: buildFishyTripOutfit,
    do: () => {
      visitLutz();
      primeZoneVerdicts(selected);
    },
    limit: { tries: 2 },
  };
}

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
      // The free sources — Lutz and the fishy pipe — are strictly cheaper (no turn, no
      // Lucky!), so let pearlMood spend them first; this task covers the day after.
      !lutzFishyAvailable() &&
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
      // Runs after the dress: an organ still over its limit means the adventure would
      // be Food Coma / jaundice (a turn each, never The Haggling) and the abort macro
      // would not see it. Halt before a Lucky! source is spent on it (issue #13).
      const blocked = adventuringBlockedBy();
      if (blocked !== undefined) {
        abort(
          `pearlo: the Fishy trip cannot adventure as dressed — ${blocked}. ` +
            "Equip an organ extender (or the wineglass) and rerun.",
        );
      }
      if (!acquireLucky(remainingPearlFights(selected))) {
        abort(
          "pearlo: could not acquire Lucky! for the Fishy refresh — every source in " +
            "the cascade failed. The Brinier Deepers is not safe without it.",
        );
      }
    },
    do: $location`The Brinier Deepers`,
    // Noncombat trip: breathing, plus the organ layer that keeps adventuring legal at
    // all (issue #13: dressed for breathing alone, an overfull run landed in Food Coma
    // ten times over).
    outfit: buildFishyTripOutfit,
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
  const fights = Math.ceil(remaining / Math.max(1.7, rate));
  // Lucky! refreshes are deliberately not counted: Get Fishy preempts zones while
  // sources remain, and counting them here would approve zones that strand when the
  // cascade comes up dry.
  return turnsForFights(fights);
}

/** The profit model's answer to "does this resistance step still pay", for one zone. */
function worthItFor(spec: PearlSpec): WorthIt {
  return (fromRes, gain, cost) => resStepWorthIt(spec, fromRes, gain, cost);
}

/** Zone-and-direction pairs whose escalation attempt has been spent (win or lose). */
const escalationTried = new Set<string>();

/** Below-cap fights lose progress, so say so every time — never latch this warning. */
function warnBelowCap(spec: PearlSpec, res: number): void {
  print(
    `pearlo: ${spec.loc} is fighting at ${res} ${spec.key} res (< ${PEARL_RES_CAP} cap) — ` +
      `${progressRatePct(res).toFixed(1)}%/fight instead of 10%.`,
    "red",
  );
}

/**
 * Dress-then-verify: measure the real outfit once it is dressed and buffed, and only
 * then, if it is short of the cap, try the res-familiar build and keep whichever
 * measures higher. Each direction is tried at most once per zone, and only while the
 * zone is under the cap. Returns
 * true when it leaves a different build dressed than the mood was sized against.
 */
function escalateFamiliarIfShort(spec: PearlSpec): boolean {
  const worn = numericModifier(resModifierName(spec.key));
  if (worn >= PEARL_RES_CAP) return false;

  // A zone that pins its familiar (stooper, familiar override, outfit override) would
  // rebuild the identical outfit, and with no res familiar owned there is nothing to
  // switch to — in both cases the dress is pure waste.
  if (!familiarModeApplies(spec) || resFamiliarSwitches(spec).length === 0) return false;

  // Always compare against the mode we are NOT in: the outfit hook has already dressed
  // the settled one, so re-dressing it would measure the same number and then "revert"
  // to the loser. The first comparison per zone is the experiment; later ones only run
  // while the zone is under the cap, which is when a re-check is worth a dress.
  // One experiment per direction per zone. Bounding only the utility side let a settled
  // zone re-dress twice on every fight for the rest of its life, and a single inflated
  // measurement could then adopt the worse build with no way back.
  const current = familiarModeFor(spec.key);
  const other: FamiliarMode = current === "switch" ? "utility" : "switch";
  const attempt = `${spec.key}:${other}`;
  if (escalationTried.has(attempt)) return false;
  escalationTried.add(attempt);

  print(`pearlo: ${spec.loc} dressed and buffed to ${worn} ${spec.key} res — trying ${other}`);
  Outfit.from(
    buildPearlOutfit(spec, other),
    new Error(`pearlo: ${other} outfit for ${spec.loc} could not be built`),
  ).dress();
  // The res familiars scale with weight, and the weight potions are only spent on a
  // familiar that scales — the mood ran against the other pick, so top up now or the
  // candidate is judged up to 15 lbs light.
  topUpFamiliarWeight(spec, worthItFor(spec), turnsForFights);

  const alternative = numericModifier(resModifierName(spec.key));
  if (alternative > worn) {
    setFamiliarMode(spec.key, other);
    print(`pearlo: ${spec.loc} ${other} build reaches ${alternative} ${spec.key} res — keeping it`);
    return true;
  }
  Outfit.from(
    buildPearlOutfit(spec, current),
    new Error(`pearlo: ${current} outfit for ${spec.loc} could not be built`),
  ).dress();
  print(
    `pearlo: ${spec.loc} ${other} build reached only ${alternative} ${spec.key} res — kept the ` +
      `${current} build at ${numericModifier(resModifierName(spec.key))}`,
  );
  return false;
}

function pearlTask(spec: PearlSpec): Task {
  // Snapshot for post()'s Beaten Up attribution: a cleaver NC firing mid-chain adds
  // its choice id to this queue (see handlePostCombatBeatenUp).
  let cleaverQueueBefore = "";
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
      // strand: farm down to the halt floor even mid-pearl (screech rundown);
      // otherwise a zone must be finishable above the floor so pearl progress
      // is never stranded.
      myAdventures() - args.debug.halt >=
        (args.major.strand ? (have($effect`Fishy`) ? 1 : 2) : turnsNeeded(spec)),
    prepare: () => {
      abortIfBeatenUp(`before adventuring in ${spec.loc}`);
      cleaverQueueBefore = get("juneCleaverQueue");
      const plan = damagePlan(spec.maxHp); // post-dress: real equipped modifiers
      pearlMood(spec, plan.mpPerFight, worthItFor(spec), turnsForFights);
      // Only now is the outfit both dressed and buffed, so only now is its resistance
      // worth measuring against the cap.
      if (escalateFamiliarIfShort(spec)) {
        // A kept escalation changes both familiar and cast count: re-run the mood so the
        // MP buffer and weight potions match the build we actually fight in.
        pearlMood(spec, damagePlan(spec.maxHp).mpPerFight, worthItFor(spec), turnsForFights);
      }
      // Last, so the free resistance — buffs, then the familiar switch — is already
      // counted and we only ever buy the tier none of it reached.
      // The gate chose and priced this plan; the executor re-asks that same model
      // whether it still pays from the resistance actually dressed.
      topUpRes(spec, zoneVerdict(spec).potionPlan, worthItFor(spec), turnsForFights);
      // Everything that can raise resistance has now run, so this is the first honest
      // reading of what the zone will actually fight at.
      const finalRes = numericModifier(resModifierName(spec.key));
      if (finalRes < PEARL_RES_CAP) warnBelowCap(spec, finalRes);
      if (wineglassMode()) {
        // Wineglass combat is attack-only: no stuns, no items. Policy (user): halt
        // entirely unless the equipped weapon one-shots the zone's toughest monster
        // with a guaranteed hit. Residual ~1/22 fumble risk is accepted. leroyjenkins
        // (user request) downgrades the halt to a warning and charges in anyway.
        const attack = weaponAttackPlan(spec.maxDef, spec.maxHp);
        if (!attack.canOneShot) {
          const shortfall =
            `overdrunk in ${spec.loc} but the equipped weapon can't guarantee a one-shot ` +
            `(damage floor ${attack.damage} vs ${spec.maxHp} HP, hit ${attack.hitGuaranteed ? "guaranteed" : `NOT guaranteed vs Def ${spec.maxDef}`}).`;
          if (args.major.leroyjenkins) {
            print(
              `pearlo: ${shortfall} leroyjenkins is set — fighting on with attack-only combat that can't stun or heal mid-fight.`,
              "red",
            );
          } else {
            abort(
              `pearlo: ${shortfall} ` +
                `Attack-only combat can't stun — improve weapon damage/${attack.ranged ? "Moxie" : "Muscle"}, wait for rollover, or set leroyjenkins to fight anyway.`,
            );
          }
        }
      }
      if (args.major.requirecap) {
        const res = numericModifier(resModifierName(spec.key));
        if (res < PEARL_RES_CAP) {
          abort(
            `pearlo: ${spec.key} res is ${res} (< ${PEARL_RES_CAP} cap) in ${spec.loc} and requirecap is set — fights would yield ${progressRatePct(res).toFixed(1)}% instead of 10%. Add resistance or drop requirecap.`,
          );
        }
      }
    },
    do: spec.loc,
    // 1557 = Peering Through Your Peridot (first adventure of the day per zone with
    // the Peridot of Peril equipped — the maximizer can pick it for its regen).
    // Selecting a monster enters that fight immediately (no turn lost), so answer with
    // the zone's safest pick; unanswered, the NC halts the script. Property format
    // "1&bandersnatch=<monsterid>" is mafia's Map-the-Monsters-style encoding.
    choices: { ...(spec.choices ?? {}), 1557: `1&bandersnatch=${spec.peridotMonster.id}` },
    post: () => {
      handlePostCombatBeatenUp(`after a combat in ${spec.loc}`, cleaverQueueBefore);
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
    outfit: () => {
      // Last hook before the maximizer runs (grimoire dresses before prepare), so the
      // buffs have to be cast here to be in the outfit's model at all.
      castFreeResBuffs(spec);
      return buildPearlOutfit(spec);
    },
    // The plan is computed inside the thunk: grimoire compiles macros AFTER dress but
    // BEFORE prepare (engine.js execute()), so a shared closure variable served fight 1
    // a plan priced on launch gear — optimistic launch gear skipped Entangling Noodles
    // against fights the real outfit can't one-shot. Compile-time here is post-dress,
    // pre-mood: at worst conservative (a spare Noodles cast before buffs land).
    combat: new CombatStrategy()
      .macro(() => buildWandererMacro(), WANDERER_MONSTERS)
      .macro(() => buildPearlMacro(spec, damagePlan(spec.maxHp))),
    limit: { soft: 30 },
  };
}

/**
 * codpiece flag: fill The Eternity Codpiece with unblemished pearls (+1 adventure/day
 * per pearl, wiki-verified 2026-08-15; gems persist across ascensions). Listed last so
 * it only runs once no farming task is available — socketing is an end-of-run step.
 * Non-pearl gems are evicted (mafia returns them to inventory); the codpiece must be
 * worn at rollover for the bonus, which is left to the user.
 */
const prepCodpieceTask: Task = {
  name: "Prep Codpiece",
  completed: () =>
    !args.resources.codpiece ||
    !EternityCodpiece.have() ||
    EternityCodpiece.currentGems().every((gem) => gem === $item`unblemished pearl`),
  ready: () => itemAmount($item`unblemished pearl`) > 0,
  do: () => {
    for (const slot of EternityCodpiece.SLOTS) {
      if (itemAmount($item`unblemished pearl`) === 0) break;
      if (equippedItem(slot) === $item`unblemished pearl`) continue;
      equip($item`unblemished pearl`, slot);
      if (equippedItem(slot) !== $item`unblemished pearl`) {
        // Direct swap over an occupied slot refused — pry the old gem out, retry.
        equip($item.none, slot);
        equip($item`unblemished pearl`, slot);
      }
      if (equippedItem(slot) === $item`unblemished pearl`) {
        print(`pearlo: socketed an unblemished pearl into ${slot}.`);
      } else {
        print(`pearlo: could not socket an unblemished pearl into ${slot}.`, "red");
      }
    }
  },
  limit: { tries: 3 },
};

export function pearlTasks(selected: PearlSpec[]): Task[] {
  return [
    breatheUnderwaterTask(selected),
    lutzTask(selected),
    getFishyTask(selected),
    ...selected.map(pearlTask),
    prepCodpieceTask,
  ];
}

export const PearlsQuest: Quest<Task> = {
  name: "Pearls",
  tasks: pearlTasks(PEARLS),
};
