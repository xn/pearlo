import { makeValue } from "garbo-lib";
import type { ValueFunctions } from "garbo-lib";
import {
  Familiar,
  Item,
  historicalPrice,
  maximize,
  myBuffedstat,
  myFamiliar,
  npcPrice,
  print,
  useFamiliar,
} from "kolmafia";
import { $effect, $familiar, $item, $skill, $stat, get, have, maxBy, sum } from "libram";

import { args } from "./args";
import { damagePlan, wineglassAccessible } from "./combat";
import { familiarBreathesFree, playerAirByEffect, resFamiliarSwitches } from "./familiar";
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
function roundsExposed(casts: number, wineglass: boolean): number {
  const stagger = have($item`Jurassic Parka`) ? 1 : 0.5;
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
 * the granularity that matters. Speculative maximizes are local computation. The
 * familiar-switch directives mirror the real outfit's two-pass planning; the Stooper
 * configuration pins the familiar instead (its +1 liver only counts while active).
 */
function speculativeResFloor(spec: PearlSpec, forceEquip: Item[], familiar?: Familiar): number {
  const saved = myFamiliar();
  try {
    useFamiliar(familiar ?? $familiar.none);
    const breathing = playerAirByEffect() ? "" : ", adventure underwater";
    const equips = forceEquip.map((i) => `, +equip ${i}`).join("");
    const switches = familiar === undefined ? resFamiliarSwitches(spec) : "";
    const suffix = switches.length > 0 ? `, ${switches}` : "";
    for (const n of RES_STEPS) {
      if (maximize(`${spec.key} res ${n} max ${n} min${breathing}${equips}${suffix}`, true)) {
        return n;
      }
    }
    return 0;
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
  pearlMeat: number;
  turnCost: number;
  mpCost: number;
  hpCost: number;
  cureCost: number;
  profit: number;
  go: boolean;
};

function evaluateZone(spec: PearlSpec, mode: LiverMode): ZoneEconomics {
  const wineglass = mode === "wineglass";
  const forced = args.major.overcapped ? allOrganEquipment(mode) : requiredOrganEquipment(mode);
  const equips = [...forced];
  if (wineglass) equips.push($item`Drunkula's wineglass`);
  const familiar = mode === "stooper" ? $familiar`Stooper` : undefined;

  const res = speculativeResFloor(spec, equips, familiar);
  const ratePct = progressRatePct(res);
  const fights = Math.ceil((100 - get(spec.progress, 0)) / ratePct);
  const turns = fights * (have($effect`Fishy`) ? 1 : 2);

  const plan = damagePlan(spec.maxHp);
  // Wineglass fights are one-shot-or-abort (pearls.ts prepare guard), so 1 cast.
  const casts = wineglass ? 1 : plan.casts;
  const exposed = roundsExposed(casts, wineglass);

  const pearlMeat = pearlValue();
  const turnCost = turns * args.major.voa;
  const mpCost = wineglass ? 0 : plan.mpPerFight * fights * meatPerMp();
  const hpCost = expectedHpLossPerRound(spec.maxAtk) * exposed * fights * meatPerHp();
  const cureCost = cureCostPerFight(spec, exposed) * fights;
  const profit = pearlMeat - turnCost - mpCost - hpCost - cureCost;

  return {
    key: spec.key,
    mode,
    res,
    ratePct,
    fights,
    turns,
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
      : maxBy(candidates, (mode) => sum(selected, (spec) => evaluateZone(spec, mode).profit));
  setLiverMode(best);
  return best;
}

// ---------- verdicts + report ----------

const verdictCache = new Map<PearlKey, ZoneEconomics>();

/** Cached per-zone verdict under the chosen liver mode — cheap enough for ready(). */
export function zoneVerdict(spec: PearlSpec): ZoneEconomics {
  const cached = verdictCache.get(spec.key);
  if (cached !== undefined) return cached;
  const verdict = evaluateZone(spec, liverMode());
  verdictCache.set(spec.key, verdict);
  return verdict;
}

export function printProfitReport(selected: PearlSpec[]): void {
  const fmt = (n: number) => Math.round(n).toLocaleString();
  print(`pearlo profit (VOA ${fmt(args.major.voa)}, liver mode ${liverMode()}):`, "blue");
  print(` unblemished pearl value: ${fmt(pearlValue())} meat`);
  for (const spec of selected) {
    const v = zoneVerdict(spec);
    print(` --- ${spec.key} (${spec.loc}) ---`, "blue");
    print(
      `  res ${v.res} → ${v.ratePct}%/fight → ${v.fights} fights, ${v.turns} turns` +
        `${have($effect`Fishy`) ? " (Fishy)" : " (NO Fishy: 2 turns each)"}`,
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
