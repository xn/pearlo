import { makeValue } from "garbo-lib";
import type { ValueFunctions } from "garbo-lib";
import {
  Effect,
  Familiar,
  Item,
  Slot,
  booleanModifier,
  canEquip,
  equippedItem,
  effectModifier,
  haveEffect,
  historicalPrice,
  itemAmount,
  mallPrice,
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
import { DamagePlan, damagePlan, wineglassAccessible } from "./combat";
import { familiarBreathesFree, predictedPlayerAirByEffect, resFamiliarSwitches } from "./familiar";
import {
  FISHY_PIPE_TURNS,
  HAGGLING_FISHY_TURNS,
  LUTZ_FISHY_TURNS,
  luckyRefreshCosts,
  lutzFishyAvailable,
  refreshNetTurns,
} from "./fishy";
import { resItems, uncastResBuffBonus } from "./mood";
import {
  LiverMode,
  allOrganEquipment,
  effectivelyOverDrunk,
  overage,
  ownedExtenders,
  requiredOrganEquipment,
  setLiverMode,
  liverMode,
  wineglassMode,
} from "./organs";
import {
  pearlAvoidTerms,
  pearlDamagePlan,
  pearlOutfitWeights,
  pearlPlannedEquipment,
  pearlResObjective,
} from "./outfit";
import {
  PEARL_RES_CAP,
  PearlKey,
  PearlSpec,
  familiarWaterBreathingEquipment,
  progressRatePct,
  resModifierName,
} from "./zones";

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
  if (pearlValueCache === undefined) {
    // mallPrice answers from mafia's rollover-day cache. A max age of 0 searches the mall.
    if (mallPrice($item`unblemished pearl`, 0) <= 0) {
      print("pearlo: the first mall search found no price for unblemished pearl", "red");
    }
    pearlValueCache = garboValue($item`unblemished pearl`);
  }
  return pearlValueCache;
}

/** What we'd pay to obtain one: NPC price when the store sells it, else mall value. */
function acquisitionCost(item: Item): number {
  const npc = npcPrice(item);
  const mall = garboValue(item);
  return npc > 0 ? Math.min(npc, mall) : mall;
}

/**
 * What one costs to BUY. Deliberately not garboValue: that is a sale value, and for
 * anything resting on the 100-meat mall floor libram returns its autosell price instead
 * — around a tenth of what the listing actually costs.
 */
function purchaseCost(item: Item): number {
  const npc = npcPrice(item);
  const mall = mallPrice(item);
  // Unpriceable is not free. mafia reads a buy limit of 0 as "pay anything", so an item
  // with no listing and no store price must drop out rather than reach buy().
  return Math.min(npc > 0 ? npc : Infinity, mall > 0 ? mall : Infinity);
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

/** Fights coverable by free Fishy already on hand — active turns, Lutz, unused pipe. */
function baseFishyFights(): number {
  return (
    haveEffect($effect`Fishy`) +
    (lutzFishyAvailable() ? LUTZ_FISHY_TURNS : 0) +
    (have($item`fishy pipe`) && !get("_fishyPipeUsed") ? FISHY_PIPE_TURNS : 0)
  );
}

// Most refreshes the model plans with: all five zones cost ≤ ~50 capped fights,
// and each refresh nets 19 (see evaluateZone) — 6 leaves slack for uncapped-rate days.
const MAX_MODEL_REFRESHES = 6;

/**
 * Adventures `fights` underwater fights cost on the LIVE Fishy pool. costZone's
 * arithmetic without the refresh cascade — the executor's sizing figure, where the
 * live pool is ground truth. The gate sizes with the threaded budget instead.
 */
export function turnsForFights(fights: number): number {
  const pool = baseFishyFights();
  const covered = Math.min(pool, fights);
  return covered + (fights - covered) * 2;
}

/**
 * Resources threaded across the zones as they are priced, consumed mutably as each zone
 * claims its share: Fishy fights, the Lucky!-refresh cascade as a queue of estimated
 * meat costs (free sources first), potion copies the farming zones have claimed, and the
 * potion effects still running when a later zone starts. The same potion sits in every
 * zone's default list, so without the last two each zone prices as though it alone owns
 * the inventory.
 */
export type FishyBudget = {
  fights: number;
  refreshCosts: number[];
  reserved: Map<Item, number>;
  /** Effects an earlier zone's potions will still have running when this one starts. */
  carried: { effect: Effect; turnsLeft: number }[];
};

export function fishyBudget(): FishyBudget {
  return {
    fights: baseFishyFights(),
    refreshCosts: luckyRefreshCosts(MAX_MODEL_REFRESHES),
    reserved: new Map(),
    carried: [],
  };
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
 * Is the Jurassic Parka's round-one stagger unavailable? The devilbone corset takes the
 * shirt slot the parka wants, and an outfit override answers for itself. Shared so the
 * gate and the execution-time re-test cannot disagree about how exposed a fight is.
 */
function parkaIsDisplaced(spec: PearlSpec, mode: LiverMode): boolean {
  const outfitName = outfitOverride(spec.key);
  if (outfitName !== undefined) {
    return !outfitPieces(outfitName).includes($item`Jurassic Parka`);
  }
  const forced = args.major.overcapped ? allOrganEquipment(mode) : requiredOrganEquipment(mode);
  return forced.includes($item`devilbone corset`);
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

/**
 * Resistance a speculative maximize reaches, or undefined when the configuration is not
 * actually reachable. Read from the result rather than the boolean — maximize() also
 * returns false when nothing beat the outfit already worn — but when every candidate
 * fails, `best` is the highest-scoring *failed* spec, so the requirements have to be
 * re-checked here or an unreachable configuration prices as its unconstrained best.
 */
function speculativeRes(
  modifier: string,
  spec: PearlSpec,
  forceEquip: Item[],
  flags: string[],
): number | undefined {
  // mafia drops unequippable items before it honours `+equip`, so a forced item we
  // cannot wear yields an outfit silently missing it rather than a failure we can see.
  if (!forceEquip.every((i) => have(i) && canEquip(i))) return undefined;
  maximize(modifier, true);
  if (flags.some((f) => !booleanModifier("Generated:_spec", f))) return undefined;
  return numericModifier("Generated:_spec", resModifierName(spec.key));
}

/**
 * Highest progress-relevant resistance this configuration can reach.
 *
 * Two flavors are evaluated when the familiar slot is free, and the better wins, because
 * none of resFamiliarSwitches' candidates (Exotic Parrot, Mu, Left-Hand Man, Disembodied
 * Hand, Cooler Yeti) breathe underwater innately:
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
 *
 * Clamped to the cap: progress stops improving there, and callers print this figure. The
 * free resistance buffs are already cast when this runs, so they are measured, not added.
 */
function speculativeResFloor(
  spec: PearlSpec,
  forceEquip: Item[],
  mode: LiverMode,
  familiar?: Familiar,
): number {
  const saved = myFamiliar();
  try {
    // predicted, not current: this model runs at startup, before the Breathe Underwater
    // task grants effect air — modeling gear air on a day the cascade will free the
    // slot minutes later understated every zone's res floor.
    // Speculate the expression the run will really maximize, weights and refusals and
    // all: a pure-resistance maximize reaches gear the dress never picks.
    const wineglass = mode === "wineglass";
    const weaponForced =
      wineglass && (forceEquip.includes($item`angelbone totem`) || have(args.major.drunkweapon));
    const equips =
      forceEquip.map((i) => `, +equip ${i}`).join("") +
      pearlOutfitWeights(wineglass, weaponForced) +
      pearlAvoidTerms(spec);
    const airByEffect = predictedPlayerAirByEffect();
    const playerBreathing = airByEffect ? "" : ", adventure underwater";
    const playerFlags = airByEffect ? [] : ["Adventure Underwater"];
    const resObjective = pearlResObjective(spec, wineglass);

    const capped = (res: number) => Math.min(res, PEARL_RES_CAP);

    if (familiar === undefined) {
      useFamiliar($familiar.none);
      const free = speculativeRes(
        `${resObjective}${playerBreathing}${equips}`,
        spec,
        forceEquip,
        playerFlags,
      );
      let best = free ?? 0;

      const switches = capped(best) < PEARL_RES_CAP ? resFamiliarSwitches(spec) : [];
      if (switches.length > 0) {
        const familiarBreathing = airByEffect ? ", underwater familiar" : ", sea";
        const switched = speculativeRes(
          `${resObjective}${familiarBreathing}${equips}, ${switches}`,
          spec,
          forceEquip,
          [...playerFlags, "Underwater Familiar"],
        );
        if (switched !== undefined) best = Math.max(best, switched);
      }
      return free === undefined && best === 0 ? 0 : capped(best);
    }

    useFamiliar(familiar);
    const familiarNeedsGear = !familiarBreathesFree() && !familiar.underwater;
    const familiarBreathing = familiarNeedsGear ? ", underwater familiar" : "";
    const pinned = speculativeRes(
      `${resObjective}${playerBreathing}${familiarBreathing}${equips}`,
      spec,
      forceEquip,
      familiarNeedsGear ? [...playerFlags, "Underwater Familiar"] : playerFlags,
    );
    return pinned === undefined ? 0 : capped(pinned);
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
 * (they keep whatever the breathing-only maximize leaves there) — conservative. The
 * zone's free resistance buffs are counted, as they are for non-override zones.
 */
function overrideResEstimate(spec: PearlSpec, forcedItems: Item[]): number {
  const saved = myFamiliar();
  try {
    useFamiliar($familiar.none);
    const resName = `${spec.key.charAt(0).toUpperCase()}${spec.key.slice(1)} Resistance`;
    const equippedContribution = sum(Slot.all(), (s) => numericModifier(equippedItem(s), resName));
    const nonEquipment = Math.max(0, numericModifier(resName) - equippedContribution);
    return Math.min(
      nonEquipment + sum(forcedItems, (i) => numericModifier(i, resName)),
      PEARL_RES_CAP,
    );
  } finally {
    useFamiliar(saved);
  }
}

// ---------- resistance as a purchase ----------

/** Above this many candidates, exhaustive subset search gives way to a greedy order. */
const SUBSET_SEARCH_LIMIT = 12;

export type ResPotionPlan = {
  /** Resistance reached once the plan is used. */
  res: number;
  /** Meat it costs: purchase price for copies we lack, mall value for copies we spend. */
  cost: number;
  use: { item: Item; count: number; buyPrice: number; saleValue: number }[];
};

/**
 * Copies of `it` needed to cover `coverTurns`, and what they cost. The two sides are
 * priced differently on purpose: spending one we own forfeits its sale value, while one
 * we lack has to be bought at the asking price.
 */
type Outlay = { count: number; cost: number; buyPrice: number; buying: number };
const outlayCache = new Map<string, Outlay>();

function potionOutlay(it: Item, coverTurns: number, claimed: number): Outlay {
  const key = `${it.id}:${coverTurns}:${claimed}:${itemAmount(it)}`;
  const cached = outlayCache.get(key);
  if (cached) return cached;
  const outlay = computeOutlay(it, coverTurns, claimed);
  outlayCache.set(key, outlay);
  return outlay;
}

function computeOutlay(it: Item, coverTurns: number, claimed: number): Outlay {
  const duration = Math.max(1, numericModifier(it, "Effect Duration"));
  const count = Math.ceil(coverTurns / duration);
  const owned = Math.min(Math.max(0, itemAmount(it) - claimed), count);
  const buying = count - owned;
  const buyPrice = purchaseCost(it);
  const cost = owned * garboValue(it) + (buying > 0 ? buying * buyPrice : 0);
  return { count, buyPrice, buying, cost };
}

/**
 * Every potion combination worth considering, priced but not yet judged. Which one wins
 * is decided by costZone, so nothing here needs its own model of what a turn is worth —
 * an approximation living beside the real cost model is what kept diverging from it.
 *
 * Combinations rather than single potions: progress only improves in 3-res steps, so two
 * that each cross none can cross one together, and a pricey potion must not shut out a
 * cheaper one behind it.
 */
export function candidateResPlans(
  spec: PearlSpec,
  startRes: number,
  remainingPct: number,
  reserved: Map<Item, number>,
  covered: Effect[] = [],
  // The zone's adventures at a given resistance. evaluateZone passes its threaded
  // figure; the default is the executor's live-pool arithmetic.
  turnsNeeded: (res: number) => number = (res) =>
    turnsForFights(Math.ceil(remainingPct / progressRatePct(res))),
): ResPotionPlan[] {
  if (startRes >= PEARL_RES_CAP || remainingPct <= 0) return [];

  const resName = resModifierName(spec.key);
  const ceiling = args.resources.potionprice;
  const gains = new Map<Item, number>();
  for (const it of resItems(spec.key)) {
    // Must grant an effect: an item whose resistance comes from wearing it would be
    // "used" to no effect and re-planned, and re-bought, every fight.
    // Skip only what is covered for the whole zone. An effect running now but expiring
    // part-way through is not: it needs a re-up in the plan, or nothing can restore the
    // tier when it lapses mid-farm.
    const ef = effectModifier(it, "Effect");
    if (ef === $effect.none || covered.includes(ef)) continue;
    const gain = numericModifier(ef, resName);
    if (gain > 0) gains.set(it, gain);
  }
  const items = [...gains.keys()];
  if (items.length === 0) return [];

  // Beyond the exhaustive limit, fall back to prefixes of a cheapest-resistance-first
  // ordering rather than of whatever order the list happens to be written in. Copies
  // reserved by earlier zones are spoken for: the marginal copy is then a purchase.
  const marginalCost = (it: Item) =>
    itemAmount(it) - (reserved.get(it) ?? 0) > 0 ? garboValue(it) : purchaseCost(it);
  const ordered = [...items].sort(
    (a, b) => marginalCost(a) / (gains.get(a) ?? 1) - marginalCost(b) / (gains.get(b) ?? 1),
  );
  const subsets =
    items.length <= SUBSET_SEARCH_LIMIT
      ? Array.from({ length: 1 << items.length }, (_, mask) =>
          items.filter((_it, i) => mask & (1 << i)),
        )
      : ordered.map((_it, i) => ordered.slice(0, i + 1));

  const plans: ResPotionPlan[] = [];
  for (const subset of subsets) {
    if (subset.length === 0) continue;
    const res = Math.min(startRes + sum(subset, (it) => gains.get(it) ?? 0), PEARL_RES_CAP);
    if (progressRatePct(res) <= progressRatePct(startRes)) continue; // crosses no step
    // Size the stacks against the adventures this subset's own farming rate needs, plus
    // 2 of slack for non-fight turns, so a stack cannot run out mid-zone.
    const outlays = subset.map((it) => ({
      item: it,
      ...potionOutlay(it, turnsNeeded(res) + 2, reserved.get(it) ?? 0),
    }));
    if (outlays.some((o) => o.count <= 0 || !Number.isFinite(o.cost))) continue;
    // Buying needs an explicit ceiling: unset means inventory only, as it always has.
    // Spending copies already owned is still decided on value alone.
    if (outlays.some((o) => o.buying > 0 && o.buyPrice > ceiling)) continue;
    plans.push({
      res,
      cost: sum(outlays, (o) => o.cost),
      use: outlays.map((o) => ({
        item: o.item,
        count: o.count,
        buyPrice: o.buyPrice,
        saleValue: garboValue(o.item),
      })),
    });
  }
  return plans;
}

/**
 * Would this resistance step still pay for itself, judged by the model that priced the
 * zone? The executor cannot answer this itself — every approximation of costZone that
 * has lived beside it has disagreed with it — so it asks through here instead.
 *
 * Built on a fresh fishyBudget(), not the gate's threaded remainder: zones execute in
 * pricing order, so at this moment the live Fishy state IS that remainder, realized.
 * When they differ, live is the better figure and no meat is spent on the stale one.
 */
export function resStepWorthIt(
  spec: PearlSpec,
  fromRes: number,
  gain: number,
  cost: number,
): boolean {
  const remainingPct = 100 - get(spec.progress, 0);
  if (remainingPct <= 0) return false;
  const wineglass = wineglassMode();
  const damage = damagePlan(spec.maxHp);
  const exposed = roundsExposed(
    wineglass ? 1 : damage.casts,
    wineglass,
    parkaIsDisplaced(spec, liverMode()),
  );
  const budget = fishyBudget();
  const to = Math.min(fromRes + gain, PEARL_RES_CAP);
  const without = costZone(spec, wineglass, exposed, damage, fromRes, 0, remainingPct, budget);
  const withStep = costZone(spec, wineglass, exposed, damage, to, cost, remainingPct, budget);
  return withStep.profit > without.profit;
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
  potionCost: number;
  /** The potion plan this verdict was priced with; the run spends no more than it. */
  potionPlan: ResPotionPlan;
  profit: number;
  /** Profitable — `force` and the task's own obtained/adventure gates are separate. */
  go: boolean;
  /** Will actually be farmed (not obtained, and profitable or forced); what the
   * threaded budget was charged for. */
  willFarm: boolean;
};

type ZoneCosting = {
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
  /** Fishy pool this option would leave behind; only the chosen one is committed. */
  budgetAfter: { fights: number; refreshCosts: number[] };
};

/**
 * The zone's res effects that are running now, split by whether they outlast it. An
 * expiring one is in the measured resistance but will not be there for the whole run,
 * so it is discounted from the estimate and left available to be planned as a re-up.
 */
function activeResEffects(
  spec: PearlSpec,
  zoneTurns: number,
): { lasting: Effect[]; expiring: Effect[] } {
  const lasting: Effect[] = [];
  const expiring: Effect[] = [];
  for (const ef of new Set(resItems(spec.key).map((it) => effectModifier(it, "Effect")))) {
    if (ef === $effect.none || !have(ef)) continue;
    (haveEffect(ef) >= zoneTurns ? lasting : expiring).push(ef);
  }
  return { lasting, expiring };
}

/**
 * Price a zone at a given resistance. Takes the Fishy budget by value so an option can
 * be costed without spending it, which is what lets the potion decision be made by this
 * same model rather than by a cheaper approximation of it standing outside.
 */
function costZone(
  spec: PearlSpec,
  wineglass: boolean,
  exposed: number,
  damage: DamagePlan,
  res: number,
  potionCost: number,
  remainingPct: number,
  budget: FishyBudget,
): ZoneCosting {
  const ratePct = progressRatePct(res);
  const fights = Math.ceil(remainingPct / ratePct);
  // A fishy fight costs 1 turn, a non-fishy fight costs 2 — spend the (threaded) budget
  // on this zone's fights, topping it up with Lucky! refreshes while each pays for
  // itself. ESTIMATE: a refresh is modeled as +19 fishy fights and +1 trip turn — the
  // Get Fishy task triggers at ≤1 Fishy turn remaining, so the trip rides the old
  // block's last turn (The Haggling grants HAGGLING_FISHY_TURNS = 20; one goes to the
  // next trip at steady state).
  let pool = budget.fights;
  const refreshCosts = [...budget.refreshCosts];
  let refreshesUsed = 0;
  let refreshCost = 0;
  let fishyUsed = Math.min(fights, pool);
  while (fishyUsed < fights && refreshCosts.length > 0) {
    const meat = refreshCosts[0];
    if (refreshNetTurns(fights - fishyUsed) * args.major.voa < meat) break;
    refreshCosts.shift();
    refreshesUsed += 1;
    refreshCost += meat;
    pool += HAGGLING_FISHY_TURNS - 1;
    fishyUsed = Math.min(fights, pool);
  }
  const turns = fights * 2 - fishyUsed + refreshesUsed;

  const pearlMeat = pearlValue();
  const turnCost = turns * args.major.voa;
  const mpCost = wineglass ? 0 : damage.mpPerFight * fights * meatPerMp();
  const hpCost = expectedHpLossPerRound(spec.maxAtk) * exposed * fights * meatPerHp();
  const cureCost = cureCostPerFight(spec, exposed) * fights;
  return {
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
    profit: pearlMeat - turnCost - mpCost - hpCost - cureCost - refreshCost - potionCost,
    budgetAfter: { fights: pool - fishyUsed, refreshCosts },
  };
}

function evaluateZone(spec: PearlSpec, mode: LiverMode, budget: FishyBudget): ZoneEconomics {
  const wineglass = mode === "wineglass";
  // The slots the real dress commits: organ extenders, the wineglass and drunkweapon,
  // the lantern gear and the cape's back slot, plus an override's own pieces.
  // Speculating with any of them free reports resistance the run cannot reach.
  // Predicted air, not current: this prices before the breathing task runs, and whether
  // the back slot goes to the cape or to a SCUBA tank follows from it.
  const equips = pearlPlannedEquipment(spec, mode, predictedPlayerAirByEffect);
  const outfitName = outfitOverride(spec.key);
  const familiar = mode === "stooper" ? $familiar`Stooper` : familiarOverride(spec.key);

  // speculativeResFloor lets the maximizer fill outfit-free slots with res gear and
  // offer familiar switches — help the real override run never gets (its outfit is
  // forced verbatim, its familiar is a plain breathing/utility pick). Price override
  // zones with a conservative arithmetic estimate instead.
  const rawGearRes =
    outfitName !== undefined
      ? overrideResEstimate(spec, equips)
      : speculativeResFloor(spec, equips, mode, familiar);
  const remainingPct = 100 - get(spec.progress, 0);
  const damage = pearlDamagePlan(spec, mode);
  // Wineglass fights are one-shot-or-abort (pearls.ts prepare guard), so 1 cast.
  const casts = wineglass ? 1 : damage.casts;
  // The devilbone corset (stomach extender) occupies the shirt slot, displacing the
  // Jurassic Parka's round-1 stagger. An outfit override instead displaces the parka
  // whenever the saved outfit itself doesn't include it.
  const parkaDisplaced = parkaIsDisplaced(spec, mode);
  const exposed = roundsExposed(casts, wineglass, parkaDisplaced);
  // Adventures the zone takes at a given resistance, on the threaded budget — the
  // model's own turn count, so stack sizing and carried-credit cannot disagree with it.
  const turnsAt = (res: number) =>
    costZone(spec, wineglass, exposed, damage, res, 0, remainingPct, budget).turns;

  // Most res potions are all-element and appear in several zones' lists, so a stack an
  // earlier zone buys is often still running here. Credit only what outlasts this zone
  // outright — a stack that expires part-way through would leave the tier unpriced.
  const resName = resModifierName(spec.key);
  const gearTurns = turnsAt(rawGearRes);
  const carried = budget.carried.filter((c) => c.turnsLeft >= gearTurns);
  const { lasting, expiring } = activeResEffects(spec, gearTurns);
  // Each effect counts once. One that is running now is already inside rawGearRes, so
  // only a carried stack for an effect we do NOT have adds resistance; and an expiring
  // one is only discounted when no carried stack covers the rest of the zone.
  const carriedRescues = (ef: Effect) => carried.some((c) => c.effect === ef);
  const gearRes = Math.min(
    rawGearRes +
      sum(
        carried.filter((c) => !haveEffect(c.effect)),
        (c) => numericModifier(c.effect, resName),
      ) -
      sum(
        expiring.filter((ef) => !carriedRescues(ef)),
        (ef) => numericModifier(ef, resName),
      ),
    PEARL_RES_CAP,
  );

  // Resistance is purchasable, so every combination is costed by the same model that
  // prices the zone and the best profit wins. Deciding inside the cost model rather than
  // beside it is the whole point: an approximation living next to it kept disagreeing.
  const candidates = candidateResPlans(
    spec,
    gearRes,
    remainingPct,
    budget.reserved,
    [...carried.map((c) => c.effect), ...lasting],
    turnsAt,
  );
  const gearOnly = costZone(spec, wineglass, exposed, damage, gearRes, 0, remainingPct, budget);
  // Every candidate is scored by the same function that prices the zone, so there is no
  // second model to disagree with — a combination wins only if the full profit, its own
  // cost included, beats buying nothing.
  let costed = gearOnly;
  let potionPlan: ResPotionPlan = { res: gearRes, cost: 0, use: [] };
  for (const candidate of candidates) {
    const priced = costZone(
      spec,
      wineglass,
      exposed,
      damage,
      candidate.res,
      candidate.cost,
      remainingPct,
      budget,
    );
    if (priced.profit > costed.profit) {
      costed = priced;
      potionPlan = candidate;
    }
  }

  // Only a zone that will actually be farmed spends the threaded pools; one priced SKIP
  // — or already won, which resets its progress preference to 0 and so prices as a full
  // farm — would otherwise charge its Fishy and its potions to the zones priced after it.
  const willFarm = !get(spec.obtained) && (costed.profit >= 0 || args.major.force);
  if (willFarm) {
    budget.fights = costed.budgetAfter.fights;
    budget.refreshCosts = costed.budgetAfter.refreshCosts;
    // Age the stacks this zone ran through first, then add its own leftovers — those
    // are already net of it, and ageing them again would expire them early.
    budget.carried = budget.carried
      .map((c) => ({ effect: c.effect, turnsLeft: c.turnsLeft - costed.turns }))
      .filter((c) => c.turnsLeft > 0);
    for (const { item, count } of potionPlan.use) {
      budget.reserved.set(item, (budget.reserved.get(item) ?? 0) + count);
      // Whatever this zone does not drink through is available to the zones after it.
      // One entry per effect: a re-up of a still-running stack extends it — KoL merges
      // the turns — so a second entry would double-credit the resistance downstream.
      const effect = effectModifier(item, "Effect");
      if (effect === $effect.none) continue;
      const stackTurns = count * numericModifier(item, "Effect Duration");
      const existing = budget.carried.find((c) => c.effect === effect);
      if (existing) existing.turnsLeft += stackTurns;
      else if (stackTurns > costed.turns) {
        budget.carried.push({ effect, turnsLeft: stackTurns - costed.turns });
      }
    }
  }

  const res = potionPlan.res;
  const potionCost = potionPlan.cost;
  const { ratePct, fights, turns, fishyUsed, refreshesUsed, refreshCost } = costed;
  const { pearlMeat, turnCost, mpCost, hpCost, cureCost, profit } = costed;

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
    potionCost,
    potionPlan,
    profit,
    // Profitability only: `force` still overrides this at pearlTask.ready, obtained
    // zones are the task's completed() check, and the profit report should keep
    // saying a losing zone is losing.
    go: costed.profit >= 0,
    willFarm,
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
    // Only what will actually be farmed counts: a zone already won today prices as a
    // full farm it will never run, and a force-farmed loss is still a loss.
    const verdict = evaluateZone(spec, mode, budget);
    total += verdict.willFarm ? verdict.profit : 0;
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
    const uncast = uncastResBuffBonus(spec);
    if (uncast > 0) {
      print(
        `  note: +${uncast} res of castable free buffs is not active — a real run casts them before pricing, so this estimate is conservative.`,
      );
    }
    print(
      `  res ${v.res} → ${v.ratePct.toFixed(1)}%/fight → ${v.fights} fights, ${v.turns} turns` +
        ` (Fishy covers ${v.fishyUsed} of ${v.fights} fights${
          v.refreshesUsed > 0
            ? `, incl. ${v.refreshesUsed} Lucky! refresh trip(s) costing ${fmt(v.refreshCost)} meat`
            : ""
        })`,
    );
    print(
      `  costs: turns ${fmt(v.turnCost)} + MP ${fmt(v.mpCost)} + HP ${fmt(v.hpCost)} + cures ${fmt(v.cureCost)}${
        v.potionCost > 0 ? ` + res potions ${fmt(v.potionCost)}` : ""
      }`,
    );
    const verdict = v.go ? "GO" : `SKIP${args.major.force ? " (overridden by force)" : ""}`;
    const obtained = get(spec.obtained) ? " (already obtained today — will not farm)" : "";
    print(
      `  expected profit: ${fmt(v.profit)} meat — ${verdict}${obtained}`,
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
