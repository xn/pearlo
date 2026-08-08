import {
  buy,
  cliExecute,
  hermit,
  historicalPrice,
  itemAmount,
  mallPrice,
  npcPrice,
  print,
  use,
  useSkill,
} from "kolmafia";
import { $effect, $item, $skill, AugustScepter, get, have, sum } from "libram";

import { args } from "./args";
import { PearlSpec } from "./zones";

// Lucky!-based Fishy refresh (docs/superpowers/specs/2026-08-08-lucky-fishy-design.md).
// The Haggling — The Brinier Deepers' lucky noncombat (wiki-verified 2026-08-08) —
// grants 20 turns of Fishy. Lucky! is an intrinsic, consumed by the next lucky-capable
// zone visited, so acquisition and the Brinier Deepers trip must happen back-to-back
// (the Dive Bar and Madness Reef would eat it with their own lucky NCs).

export const HAGGLING_FISHY_TURNS = 20;

const CLOVER = $item`11-leaf clover`;
const AUG_2 = $skill`Aug. 2nd: Find an Eleven-Leaf Clover Day`;
const HERMIT_CLOVER_LIMIT = 3; // wiki The Hermitage: "(Limit 3 per day)", pref _cloversPurchased

/**
 * Meat cost of a hermit clover — mafia auto-buys chewing gum on a string (one worthless
 * item each) and auto-fetches the hermit permit (HermitRequest.java). ESTIMATE: gum can
 * already be on hand (cost 0) and the permit is a one-time 100 meat; the NPC gum price
 * is the honest steady-state figure.
 */
function hermitCloverCost(): number {
  return npcPrice($item`chewing gum on a string`);
}

type LuckySource = {
  name: string;
  /** Cheap availability check — safe for ready() polling (no mallPrice). */
  available: (remainingFights: number) => boolean;
  /** Perform the acquisition. Lucky! is re-verified by the caller afterward. */
  acquire: (remainingFights: number) => boolean;
};

/** Would a mall clover pay for itself? min(20, remaining fights) turns saved vs price. */
function mallWorthIt(remainingFights: number, price: number): boolean {
  return Math.min(HAGGLING_FISHY_TURNS, remainingFights) * args.major.voa >= price;
}

// Cascade order fixed by user decision (2026-08-08): scepter first, then free-first.
const LUCKY_SOURCES: LuckySource[] = [
  {
    name: "Aug. 2nd scepter skill",
    available: () => AugustScepter.have() && AugustScepter.canCast(2),
    acquire: () => useSkill(AUG_2, 1),
  },
  {
    name: "owned 11-leaf clover",
    available: () => itemAmount(CLOVER) > 0,
    acquire: () => use(CLOVER),
  },
  {
    name: "pill keeper (free Surprise Me)",
    available: () => have($item`Eight Days a Week Pill Keeper`) && !get("_freePillKeeperUsed"),
    acquire: () => cliExecute("pillkeeper free lucky"),
  },
  {
    name: "hermit 11-leaf clover",
    available: () => get("_cloversPurchased") < HERMIT_CLOVER_LIMIT,
    // hermit() auto-acquires the permit and worthless items (chewing gum) as needed.
    acquire: () => hermit(CLOVER, 1) && use(CLOVER),
  },
  {
    name: "mall 11-leaf clover",
    available: (remainingFights) =>
      args.resources.cloverprice > 0 &&
      historicalPrice(CLOVER) <= args.resources.cloverprice &&
      mallWorthIt(remainingFights, historicalPrice(CLOVER)),
    acquire: (remainingFights) => {
      const price = mallPrice(CLOVER);
      if (price > args.resources.cloverprice || !mallWorthIt(remainingFights, price)) {
        return false;
      }
      return buy(CLOVER, 1, args.resources.cloverprice) > 0 && use(CLOVER);
    },
  },
];

/**
 * Fights still wanted across the selected zones, at the optimistic 10%/fight cap —
 * a deliberately LOW estimate so the mall worth-gate never overspends.
 */
export function remainingPearlFights(selected: PearlSpec[]): number {
  return sum(
    selected.filter((spec) => !get(spec.obtained)),
    (spec) => Math.ceil((100 - get(spec.progress, 0)) / 10),
  );
}

/** Any cascade source currently usable? Cheap — safe in ready(). */
export function luckySourceAvailable(remainingFights: number): boolean {
  if (!args.resources.luckyfishy) return false;
  return LUCKY_SOURCES.some((source) => source.available(remainingFights));
}

/** Walk the cascade until Lucky! is up. Verifies the effect after each attempt. */
export function acquireLucky(remainingFights: number): boolean {
  if (have($effect`Lucky!`)) return true;
  if (!args.resources.luckyfishy) return false;
  for (const source of LUCKY_SOURCES) {
    if (!source.available(remainingFights)) continue;
    print(`pearlo: acquiring Lucky! via ${source.name}`);
    if (source.acquire(remainingFights) && have($effect`Lucky!`)) return true;
    print(`pearlo: ${source.name} did not produce Lucky! — trying next source`, "red");
  }
  return have($effect`Lucky!`);
}

/**
 * Estimated meat cost of each refresh the economics model may plan with, cascade
 * order, at most maxCount. Free sources contribute one 0 each; the hermit contributes
 * its remaining daily allotment; the mall (when enabled by cloverprice) fills the rest.
 * The mall worth-gate is NOT applied here — the model itself weighs cost vs turns.
 */
export function luckyRefreshCosts(maxCount: number): number[] {
  if (!args.resources.luckyfishy) return [];
  const costs: number[] = [];
  if (AugustScepter.have() && AugustScepter.canCast(2)) costs.push(0);
  for (let i = 0; i < itemAmount(CLOVER); i++) costs.push(0);
  if (have($item`Eight Days a Week Pill Keeper`) && !get("_freePillKeeperUsed")) {
    costs.push(0);
  }
  const hermitLeft = Math.max(0, HERMIT_CLOVER_LIMIT - get("_cloversPurchased"));
  for (let i = 0; i < hermitLeft; i++) costs.push(hermitCloverCost());
  if (args.resources.cloverprice > 0 && historicalPrice(CLOVER) <= args.resources.cloverprice) {
    while (costs.length < maxCount) costs.push(historicalPrice(CLOVER));
  }
  return costs.slice(0, maxCount);
}

/** Sim-report lines describing refresh availability. */
export function luckySourceReport(): string[] {
  if (!args.resources.luckyfishy) {
    return [" lucky fishy refresh: disabled (luckyfishy=false)"];
  }
  const scepter = !AugustScepter.have()
    ? "not owned"
    : AugustScepter.canCast(2)
      ? "castable"
      : "already cast / no casts left";
  const pillkeeper = !have($item`Eight Days a Week Pill Keeper`)
    ? "not owned"
    : get("_freePillKeeperUsed")
      ? "free use spent"
      : "free use available";
  const mall =
    args.resources.cloverprice > 0
      ? `enabled up to ${args.resources.cloverprice} meat (historical ${historicalPrice(CLOVER)})`
      : "disabled (cloverprice=0)";
  return [
    ` lucky fishy refresh (The Haggling: +${HAGGLING_FISHY_TURNS} Fishy per trip):`,
    `  Aug. 2nd scepter: ${scepter}`,
    `  11-leaf clovers in inventory: ${itemAmount(CLOVER)}`,
    `  pill keeper: ${pillkeeper}`,
    `  hermit clovers left today: ${Math.max(0, HERMIT_CLOVER_LIMIT - get("_cloversPurchased"))}`,
    `  mall clovers: ${mall}`,
  ];
}
