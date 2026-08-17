import { makeValue } from "garbo-lib";
import type { ValueFunctions } from "garbo-lib";
import {
  Familiar,
  Item,
  Slot,
  equippedItem,
  haveEffect,
  historicalPrice,
  maximize,
  myBuffedstat,
  myFamiliar,
  npcPrice,
  numericModifier,
  outfitPieces,
  print,
  useFamiliar,
} from "kolmafia";
import { $effect, $familiar, $item, $skill, $stat, get, have, maxBy, sum } from "libram";

import { args, familiarOverride, outfitOverride } from "./args";
import { damagePlan, wineglassAccessible } from "./combat";
import { familiarBreathesFree, predictedPlayerAirByEffect, resFamiliarSwitches } from "./familiar";
import { FISHY_PIPE_TURNS, HAGGLING_FISHY_TURNS, luckyRefreshCosts } from "./fishy";
import {
  LiverMode,
  allOrganEquipment,
  effectivelyOverDrunk,
  overage,
  ownedExtenders,
  requiredOrganEquipment,
  setLiverMode,
  liverMode,
} from "./organs";
import { PearlKey, PearlSpec, familiarWaterBreathingEquipment } from "./zones";

// ---------- valuation (garbo-lib preferred over raw mallPrice — user directive) ----------

let valueFunctions: ValueFunctions | undefined;
let valuationWarned = false;

export function garboValue(item: Item): number {
  try {
    valueFunctions ??= makeValue();
    return valueFunctions.value(item);
  } catch (e) {
    if (!valuationWarned) {
      print(`pearlo: garbo-lib valuation failed (${e}) — falling back to historical prices`, "red");
      valuationWarned = true;
    }
    return historicalPrice(item);
  }
}

let pearlValueCache: number | undefined;

export function pearlValue(): number {
  pearlValueCache ??= garboValue($item`unblemished pearl`);
  return pearlValueCache;
}

/** What we'd pay to obtain one: NPC price when the store sells it, else mall value. */
function acquisitionCost(item: Item): number {
  const npc = npcPrice(item);
  const mall = garboValue(item);
  return npc > 0 ? Math.min(npc, mall) : mall;
}

// ---------- restore economics (wiki-verified restore ranges, 2026-08-08) ----------

const TONIC_AVG_MP = 10; // Doc Galaktik's Invigorating Tonic restores 9-11 MP
const BALM_AVG_HP = 14; // Doc Galaktik's Restorative Balm heals 13-15 HP

function meatPerMp(): number {
  return npcPrice($item`Doc Galaktik's Invigorating Tonic`) / TONIC_AVG_MP;
}

function meatPerHp(): number {
  return npcPrice($item`Doc Galaktik's Restorative Balm`) / BALM_AVG_HP;
}

// ---------- progress / turns ----------

/** 1.7% × floor(res/3), min 1.7, cap 10 (docs/sea-reference.md §2). */
export function progressRatePct(res: number): number {
  return Math.max(1.7, Math.min(10, 1.7 * Math.floor(res / 3)));
}

/** Fights coverable by Fishy sources already on hand — active turns + unused pipe. */
function baseFishyFights(): number {
  return (
    haveEffect($effect`Fishy`) +
    (have($item`fishy pipe`) && !get("_fishyPipeUsed") ? FISHY_PIPE_TURNS : 0)
  );
}

// Most refreshes the model plans with: all five zones cost ≤ ~50 capped fights,
// and each refresh nets 19 (see evaluateZone) — 6 leaves slack for uncapped-rate days.
const MAX_MODEL_REFRESHES = 6;

/**
 * The threaded Fishy budget: fights already covered, plus the Lucky!-refresh cascade
 * as a queue of estimated meat costs (cascade order — free sources first). evaluateZone
 * consumes it mutably as zones claim fights.
 */
export type FishyBudget = { fights: number; refreshCosts: number[] };

export function fishyBudget(): FishyBudget {
  return { fights: baseFishyFights(), refreshCosts: luckyRefreshCosts(MAX_MODEL_REFRESHES) };
}

// ---------- rough combat-cost model ----------

/**
 * Expected HP lost per monster action (wiki Monsters page, fetched 2026-08-08):
 * damage = max(0, Atk − Moxie) + 20-25% of Atk (we use the 22.5% midpoint; DR and DA
 * ignored — rough, slightly pessimistic); hit% ≈ clamp(55 + (Atk−Mox)×5.5, 0, 100)%
 * × 0.88 plus the flat 6% crit, clamped to [0.06, 0.94].
 */
function expectedHpLossPerRound(maxAtk: number): number {
  const moxie = myBuffedstat($stat`Moxie`);
  const damage = Math.max(0, maxAtk - moxie) + 0.225 * maxAtk;
  const base = (55 + (maxAtk - moxie) * 5.5) / 100;
  const hitChance = Math.min(0.94, Math.max(0.06, Math.min(1, Math.max(0, base)) * 0.88 + 0.06));
  return damage * hitChance;
}

/**
 * Monster actions we expect to be exposed to per fight. The Jurassic Parka staggers
 * round 1 in every combat; without it the 0.5 reflects init being a coin flip at best
 * under pressure penalties (ESTIMATE). Entangling Noodles buys ~3 stunned rounds in
 * sober multi-cast fights (docs/sea-reference.md §6).
 */
function roundsExposed(casts: number, wineglass: boolean, parkaDisplaced: boolean): number {
  const stagger = !parkaDisplaced && have($item`Jurassic Parka`) ? 1 : 0.5;
  const stun = !wineglass && casts > 1 && have($skill`Entangling Noodles`) ? 3 : 0;
  return Math.max(0, casts - stagger - stun);
}

// Debuff sources per zone (docs/sea-reference.md §3): Majorly Poisoned in the Mine and
// Reef (anti-anti-antidote), The Colors... in the Reef (soft green echo eyedrop antidote).
const ZONE_CURES: Partial<Record<PearlKey, Item[]>> = {
  spooky: [$item`anti-anti-antidote`],
  stench: [$item`anti-anti-antidote`, $item`soft green echo eyedrop antidote`],
};

// ESTIMATE: debuff procs per exposed monster action — the wiki documents no rates.
const DEBUFF_PROC_PER_ROUND = 0.1;

function cureCostPerFight(spec: PearlSpec, exposedRounds: number): number {
  const cures = ZONE_CURES[spec.key] ?? [];
  return sum(cures, (cure) => acquisitionCost(cure)) * DEBUFF_PROC_PER_ROUND * exposedRounds;
}

// ---------- speculative resistance per configuration ----------

const RES_STEPS = [18, 15, 12, 9, 6, 3];

/**
 * Highest progress-relevant resistance floor this configuration can reach. Progress
 * only moves in steps of 3 res (floor(res/3)), so stepping down RES_STEPS is exact at
 * the granularity that matters. Speculative maximizes are local computation.
 *
 * Two flavors are evaluated when the familiar slot is free, and the better floor wins,
 * because none of resFamiliarSwitches' candidates (Exotic Parrot, Mu, Left-Hand Man,
 * Disembodied Hand, Cooler Yeti) breathe underwater innately:
 * - Familiar-free: no familiar switches offered, so only the player's own breathing is
 *   constrained — always legally reachable regardless of familiar-breathing gear owned.
 * - Switch: offers resFamiliarSwitches(spec), constrained by `sea` (Adventure Underwater
 *   + Underwater Familiar) — or just `underwater familiar` when the player's breathing
 *   is already effect-covered — so the maximizer boot-equips or rejects non-breathing
 *   switch candidates on its own, exactly as the real outfit does (src/familiar.ts).
 * The pinned-familiar case (Stooper) instead pays the familiar-breathing cost directly:
 * `underwater familiar` is added unless the familiar already breathes for free (effect
 * or innately underwater) — its +1 liver only counts while active, so it can't be
 * swapped out the way switch candidates can.
 */
function speculativeResFloor(spec: PearlSpec, forceEquip: Item[], familiar?: Familiar): number {
  const saved = myFamiliar();
  try {
    // predicted, not current: this model runs at startup, before the Breathe Underwater
    // task grants effect air — modeling gear air on a day the cascade will free the
    // slot minutes later understated every zone's res floor.
    const equips = forceEquip.map((i) => `, +equip ${i}`).join("");
    const playerBreathing = predictedPlayerAirByEffect() ? "" : ", adventure underwater";

    if (familiar === undefined) {
      useFamiliar($familiar.none);
      let floor = 0;
      for (const n of RES_STEPS) {
        if (maximize(`${spec.key} res ${n} max ${n} min${playerBreathing}${equips}`, true)) {
          floor = n;
          break;
        }
      }

      const switches = floor < RES_STEPS[0] ? resFamiliarSwitches(spec) : [];
      if (switches.length > 0) {
        const familiarBreathing = predictedPlayerAirByEffect() ? ", underwater familiar" : ", sea";
        for (const n of RES_STEPS) {
          if (
            maximize(
              `${spec.key} res ${n} max ${n} min${familiarBreathing}${equips}, ${switches}`,
              true,
            )
          ) {
            floor = Math.max(floor, n);
            break;
          }
        }
      }
      return floor;
    }

    useFamiliar(familiar);
    const familiarBreathing =
      !familiarBreathesFree() && !familiar.underwater ? ", underwater familiar" : "";
    for (const n of RES_STEPS) {
      if (
        maximize(
          `${spec.key} res ${n} max ${n} min${playerBreathing}${familiarBreathing}${equips}`,
          true,
        )
      ) {
        return n;
      }
    }
    return 0;
  } finally {
    useFamiliar(saved);
  }
}

/**
 * Conservative res estimate for an outfit-override zone: forced items' own res plus
 * the player's non-equipment res (effects, passives). Measured with NO familiar: the
 * real override run picks a utility/breathing familiar (~0 res), so a res familiar
 * active at launch (Exotic Parrot) would otherwise inflate the estimate and break the
 * never-optimistic contract. ESTIMATE: free slots may add a little res in the real run
 * (they keep whatever the breathing-only maximize leaves there) — conservative.
 */
function overrideResEstimate(spec: PearlSpec, forcedItems: Item[]): number {
  const saved = myFamiliar();
  try {
    useFamiliar($familiar.none);
    const resName = `${spec.key.charAt(0).toUpperCase()}${spec.key.slice(1)} Resistance`;
    const equippedContribution = sum(Slot.all(), (s) => numericModifier(equippedItem(s), resName));
    const nonEquipment = Math.max(0, numericModifier(resName) - equippedContribution);
    return nonEquipment + sum(forcedItems, (i) => numericModifier(i, resName));
  } finally {
    useFamiliar(saved);
  }
}

// ---------- per-zone economics ----------

export type ZoneEconomics = {
  key: PearlKey;
  mode: LiverMode;
  res: number;
  ratePct: number;
  fights: number;
  turns: number;
  fishyUsed: number;
  refreshesUsed: number;
  refreshCost: number;
  pearlMeat: number;
  turnCost: number;
  mpCost: number;
  hpCost: number;
  cureCost: number;
  profit: number;
  go: boolean;
};

function evaluateZone(spec: PearlSpec, mode: LiverMode, budget: FishyBudget): ZoneEconomics {
  const wineglass = mode === "wineglass";
  const forced = args.major.overcapped ? allOrganEquipment(mode) : requiredOrganEquipment(mode);
  const equips = [...forced];
  if (wineglass) {
    equips.push($item`Drunkula's wineglass`);
    // Mirror the real outfit: the drunkweapon takes the weapon slot unless the totem
    // forces it for organ capacity — otherwise this would speculate the weapon slot as
    // free res space the real dress never gives it.
    if (!forced.includes($item`angelbone totem`) && have(args.major.drunkweapon)) {
      equips.push(args.major.drunkweapon);
    }
  }
  // Price overrides as they will run: outfit pieces are forced into the speculation
  // and an override familiar is pinned exactly like Stooper (skipping the maximizer's
  // familiar switches). Stooper still displaces the override in stooper mode.
  const outfitName = outfitOverride(spec.key);
  const overridePieces = outfitName !== undefined ? outfitPieces(outfitName) : [];
  equips.push(...overridePieces);
  const familiar = mode === "stooper" ? $familiar`Stooper` : familiarOverride(spec.key);

  // speculativeResFloor lets the maximizer fill outfit-free slots with res gear and
  // offer familiar switches — help the real override run never gets (its outfit is
  // forced verbatim, its familiar is a plain breathing/utility pick). Price override
  // zones with a conservative arithmetic estimate instead.
  const res =
    outfitName !== undefined
      ? overrideResEstimate(spec, equips)
      : speculativeResFloor(spec, equips, familiar);
  const ratePct = progressRatePct(res);
  const fights = Math.ceil((100 - get(spec.progress, 0)) / ratePct);
  // A fishy fight costs 1 turn, a non-fishy fight costs 2 — spend the (threaded) budget
  // on this zone's fights, topping it up with Lucky! refreshes while each pays for
  // itself. ESTIMATE: a refresh is modeled as +19 fishy fights and +1 trip turn — the
  // Get Fishy task triggers at ≤1 Fishy turn remaining, so the trip rides the old
  // block's last turn (The Haggling grants HAGGLING_FISHY_TURNS = 20; one goes to the
  // next trip at steady state).
  let pool = budget.fights;
  let refreshesUsed = 0;
  let refreshCost = 0;
  let fishyUsed = Math.min(fights, pool);
  while (fishyUsed < fights && budget.refreshCosts.length > 0) {
    const meat = budget.refreshCosts[0];
    const coverable = Math.min(HAGGLING_FISHY_TURNS - 1, fights - fishyUsed);
    // Each covered fight saves one turn; the trip costs one — net (coverable-1) turns.
    if ((coverable - 1) * args.major.voa < meat) break;
    budget.refreshCosts.shift();
    refreshesUsed += 1;
    refreshCost += meat;
    pool += HAGGLING_FISHY_TURNS - 1;
    fishyUsed = Math.min(fights, pool);
  }
  budget.fights = pool - fishyUsed; // leftover Fishy turns carry to the next zone
  const turns = fights * 2 - fishyUsed + refreshesUsed;

  const plan = damagePlan(spec.maxHp);
  // Wineglass fights are one-shot-or-abort (pearls.ts prepare guard), so 1 cast.
  const casts = wineglass ? 1 : plan.casts;
  // The devilbone corset (stomach extender) occupies the shirt slot, displacing the
  // Jurassic Parka's round-1 stagger. An outfit override instead displaces the parka
  // whenever the saved outfit itself doesn't include it.
  const parkaDisplaced =
    outfitName !== undefined
      ? !overridePieces.includes($item`Jurassic Parka`)
      : forced.includes($item`devilbone corset`);
  const exposed = roundsExposed(casts, wineglass, parkaDisplaced);

  const pearlMeat = pearlValue();
  const turnCost = turns * args.major.voa;
  const mpCost = wineglass ? 0 : plan.mpPerFight * fights * meatPerMp();
  const hpCost = expectedHpLossPerRound(spec.maxAtk) * exposed * fights * meatPerHp();
  const cureCost = cureCostPerFight(spec, exposed) * fights;
  const profit = pearlMeat - turnCost - mpCost - hpCost - cureCost - refreshCost;

  return {
    key: spec.key,
    mode,
    res,
    ratePct,
    fights,
    turns,
    fishyUsed,
    refreshesUsed,
    refreshCost,
    pearlMeat,
    turnCost,
    mpCost,
    hpCost,
    cureCost,
    profit,
    go: profit >= 0,
  };
}

// ---------- liver configuration chooser ----------

/**
 * Rescue modes that are actually reachable from current state. Stooper viability
 * requires the familiar plus underwater breathing for it (famequip gear or a
 * familiar-air effect); the wineglass requires the glass reachable in inventory.
 */
function candidateLiverModes(): LiverMode[] {
  if (overage("liver") === 0) return ["sober"];
  if (effectivelyOverDrunk()) return ["wineglass"];
  const candidates: LiverMode[] = [];
  const liverItems = ownedExtenders("liver", "items").length;
  if (liverItems >= overage("liver")) candidates.push("items");
  if (
    have($familiar`Stooper`) &&
    liverItems >= overage("liver") - 1 &&
    (familiarBreathesFree() || familiarWaterBreathingEquipment.some((i) => have(i)))
  ) {
    candidates.push("stooper");
  }
  if (wineglassAccessible()) candidates.push("wineglass");
  // Nothing viable: report wineglass — the existing wineglass guards will halt with
  // their own explanation rather than silently farming illegally.
  return candidates.length > 0 ? candidates : ["wineglass"];
}

/** Sum of per-zone profit under `mode`, threading the Fishy-fight budget across zones. */
function scoreLiverMode(selected: PearlSpec[], mode: LiverMode): number {
  const budget = fishyBudget();
  let total = 0;
  for (const spec of selected) {
    total += evaluateZone(spec, mode, budget).profit;
  }
  return total;
}

/**
 * Pick the most profitable viable liver mode across the selected zones and lock it in
 * (setLiverMode). Organ state doesn't change mid-run — pearlo neither eats nor drinks —
 * so one choice at startup is sound.
 */
export function chooseLiverConfiguration(selected: PearlSpec[]): LiverMode {
  const candidates = candidateLiverModes();
  const best =
    candidates.length === 1
      ? candidates[0]
      : maxBy(candidates, (mode) => scoreLiverMode(selected, mode));
  setLiverMode(best);
  return best;
}

// ---------- verdicts + report ----------

const verdictCache = new Map<PearlKey, ZoneEconomics>();

/**
 * Cached per-zone verdict under the chosen liver mode — cheap enough for ready(). A cold
 * cache (or one recomputed after the liver mode changed) falls back to the full Fishy
 * budget for a single zone; call primeZoneVerdicts() first to get budget-threaded
 * verdicts across the whole selected set.
 */
export function zoneVerdict(spec: PearlSpec): ZoneEconomics {
  const cached = verdictCache.get(spec.key);
  if (cached !== undefined && cached.mode === liverMode()) return cached;
  const verdict = evaluateZone(spec, liverMode(), fishyBudget());
  verdictCache.set(spec.key, verdict);
  return verdict;
}

/**
 * Recompute every selected zone's verdict under the chosen liver mode, threading the
 * Fishy-fight budget across zones in the order they'll be farmed, and populate the
 * cache. Call this before any zoneVerdict() lookups so those reads reflect the shared
 * budget instead of each independently assuming the full budget is theirs alone.
 */
export function primeZoneVerdicts(selected: PearlSpec[]): void {
  verdictCache.clear();
  const mode = liverMode();
  const budget = fishyBudget();
  for (const spec of selected) {
    verdictCache.set(spec.key, evaluateZone(spec, mode, budget));
  }
}

export function printProfitReport(selected: PearlSpec[]): void {
  const fmt = (n: number) => Math.round(n).toLocaleString();
  print(`pearlo profit (VOA ${fmt(args.major.voa)}, liver mode ${liverMode()}):`, "blue");
  print(` unblemished pearl value: ${fmt(pearlValue())} meat`);
  for (const spec of selected) {
    const v = zoneVerdict(spec);
    print(` --- ${spec.key} (${spec.loc}) ---`, "blue");
    for (const line of overrideReportLines(spec)) print(line);
    print(
      `  res ${v.res} → ${v.ratePct}%/fight → ${v.fights} fights, ${v.turns} turns` +
        ` (Fishy covers ${v.fishyUsed} of ${v.fights} fights${
          v.refreshesUsed > 0
            ? `, incl. ${v.refreshesUsed} Lucky! refresh trip(s) costing ${fmt(v.refreshCost)} meat`
            : ""
        })`,
    );
    print(
      `  costs: turns ${fmt(v.turnCost)} + MP ${fmt(v.mpCost)} + HP ${fmt(v.hpCost)} + cures ${fmt(v.cureCost)}`,
    );
    print(
      `  expected profit: ${fmt(v.profit)} meat — ${v.go ? "GO" : `SKIP${args.major.force ? " (overridden by force)" : ""}`}`,
      v.go ? "blue" : "red",
    );
  }
}

/** One line per active override for this zone (sim + profit report). */
export function overrideReportLines(spec: PearlSpec): string[] {
  const lines: string[] = [];
  const familiar = familiarOverride(spec.key);
  if (familiar !== undefined) {
    const displaced = liverMode() === "stooper" && familiar !== $familiar`Stooper`;
    lines.push(`  override: familiar ${familiar}${displaced ? " (displaced by Stooper)" : ""}`);
  }
  const outfitName = outfitOverride(spec.key);
  if (outfitName !== undefined) {
    lines.push(`  override: outfit ${outfitName} (${outfitPieces(outfitName).length} pieces)`);
  }
  return lines;
}
