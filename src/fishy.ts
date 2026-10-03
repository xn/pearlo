import {
  booleanModifier,
  buy,
  canEquip,
  cliExecute,
  effectFact,
  equip,
  equippedItem,
  factType,
  haveEffect,
  hermit,
  haveEquipped,
  historicalPrice,
  itemAmount,
  mallPrice,
  npcPrice,
  print,
  use,
  useSkill,
} from "kolmafia";
import {
  $effect,
  $item,
  $monster,
  $skill,
  $slot,
  AprilingBandHelmet,
  AugustScepter,
  get,
  have,
  sum,
} from "libram";

import { args } from "./args";
import { wineglassMode } from "./organs";
import { PearlSpec } from "./zones";

// Lucky!-based Fishy refresh (docs/superpowers/specs/2026-08-08-lucky-fishy-design.md).
// The Haggling — The Brinier Deepers' lucky noncombat (wiki-verified 2026-08-08) —
// grants 20 turns of Fishy. Lucky! is an intrinsic, consumed by the next lucky-capable
// zone visited, so acquisition and the Brinier Deepers trip must happen back-to-back
// (the Dive Bar and Madness Reef would eat it with their own lucky NCs).

export const HAGGLING_FISHY_TURNS = 20;

/** fishy pipe grants 10 turns of Fishy, 1/day (docs/sea-reference.md §1.2, wiki-verified). */
export const FISHY_PIPE_TURNS = 10;

/**
 * Lutz, the Ice Skate grants 30 turns of Fishy on the day's first visit — free, and
 * sea_skatepark.php is not an adventure, so it costs no turn (wiki Lutz, the Ice Skate).
 */
export const LUTZ_FISHY_TURNS = 30;

/**
 * One attempt per run, whatever the outcome. Availability then stops depending on
 * mafia writing _skateBuff1, so a visit can never be counted and collected at once.
 */
let lutzVisitTried = false;

/**
 * Is Lutz's Fishy still on offer? Mafia's SkateParkRequest gates the visit on exactly
 * this pair: the park has to be Ice Skate Territory, and the buff is once a day.
 */
export function lutzFishyAvailable(): boolean {
  return !lutzVisitTried && get("skateParkStatus") === "ice" && !get("_skateBuff1");
}

/**
 * Take Lutz's free Fishy. Water breathing must already be up: mafia's SkateParkRequest
 * only self-equips a short fixed list of gear (aerated diving helmet, Mer-kin masks,
 * SCUBA gear, old SCUBA tank) and errors out otherwise, so the caller dresses for the
 * visit (lutzTask's outfit) and this only refuses when that still left air down.
 * Reports whether Fishy is up afterward.
 */
export function visitLutz(): boolean {
  if (!lutzFishyAvailable()) return false;
  // Spend the attempt up front: a source the run did not collect must leave the budget,
  // or the zones priced on those 30 turns strand.
  lutzVisitTried = true;
  if (!booleanModifier("Adventure Underwater")) {
    print("pearlo: skipping Lutz, the visit needs water breathing already up", "red");
    return false;
  }
  print(`pearlo: taking Lutz's free ${LUTZ_FISHY_TURNS} turns of Fishy`);
  cliExecute("skate lutz");
  if (have($effect`Fishy`)) return true;
  print("pearlo: Lutz granted no Fishy, dropping it from the budget", "red");
  return false;
}

// Book of Facts Fishy (user design 2026-10-03). Sea *dent: Talk to Some Fish turns the
// current opponent into some fish (phylum fish); for some class/path pairs that
// monster's fact is the fish-phylum effect fact, 10 turns of Fishy per kill with no
// daily limit (wiki Just the Facts). Cast inside a pearl-zone fight it costs neither a
// clover nor a turn, and the fight still accrues pearl progress (user-confirmed).

/** The fish-phylum effect fact grants 10 turns of Fishy (wiki Just the Facts). */
export const FISH_FACT_FISHY_TURNS = 10;

/** The skill needs it in the main hand, off-hand or on a Disembodied Hand (wiki). */
export const MONODENT = $item`Monodent of the Sea`;
export const TALK_TO_SOME_FISH = $skill`Sea *dent: Talk to Some Fish`;
const SOME_FISH = $monster`some fish`;
const JUST_THE_FACTS = $skill`Just the Facts`;

/** Facts are deterministic per class and path; mafia computes the current pair's. */
function someFishFactIsFishy(): boolean {
  return factType(SOME_FISH) === "effect" && effectFact(SOME_FISH) === $effect`Fishy`;
}

/**
 * Can this character farm Fishy off some fish? Overdrunk cannot: the wineglass turns
 * every combat skill into a plain attack. Local state only — safe in ready().
 */
export function fishFactAvailable(): boolean {
  return (
    have(JUST_THE_FACTS) &&
    have(MONODENT) &&
    canEquip(MONODENT) &&
    !wineglassMode() &&
    someFishFactIsFishy()
  );
}

/**
 * Every zone an eligible character farms. A saved-outfit override does not opt out: the
 * Monodent displaces the saved weapon on fish fights (outfit.ts withMonodent).
 */
export function fishFactApplies(spec: PearlSpec): boolean {
  void spec;
  return fishFactAvailable();
}

/** fishMaxxing: every fight in the zone becomes some fish. */
export function fishMaxxed(spec: PearlSpec): boolean {
  return args.resources.fishMaxxing && fishFactApplies(spec);
}

/**
 * Should the zone's next fight become some fish? Always under fishMaxxing; otherwise
 * only on the last Fishy turn, so the fight itself still costs one adventure and the
 * other nine in ten keep the weapon slot for resistance.
 */
export function fishWanted(spec: PearlSpec): boolean {
  return fishFactApplies(spec) && (args.resources.fishMaxxing || haveEffect($effect`Fishy`) <= 1);
}

/** fishWanted, and the dress actually put the Monodent in a hand. */
export function fishThisFight(spec: PearlSpec): boolean {
  return fishWanted(spec) && haveEquipped(MONODENT);
}

/** Sim-report line for the Book of Facts fish source. */
export function fishFactReport(): string {
  const status = !have(JUST_THE_FACTS)
    ? "Just the Facts not known"
    : !have(MONODENT)
      ? "Monodent of the Sea not owned"
      : !canEquip(MONODENT)
        ? "Monodent of the Sea not equippable"
        : wineglassMode()
          ? "unavailable overdrunk (the wineglass turns skills into attacks)"
          : !someFishFactIsFishy()
            ? "this class/path's fact for some fish is not Fishy"
            : args.resources.fishMaxxing
              ? `fishMaxxing: every fight becomes some fish (+${FISH_FACT_FISHY_TURNS} turns each)`
              : `available as needed (+${FISH_FACT_FISHY_TURNS} turns per fish)`;
  return ` Book of Facts fish (Sea *dent: Talk to Some Fish): ${status}`;
}

const CLOVER = $item`11-leaf clover`;
const AUG_2 = $skill`Aug. 2nd: Find an Eleven-Leaf Clover Day`;
const HERMIT_CLOVER_LIMIT = 3; // wiki The Hermitage: "(Limit 3 per day)", pref _cloversPurchased
const SAXOPHONE = $item`Apriling band saxophone`; // 3 plays/day, each grants Lucky!
const HEARTSTONE = $item`Heartstone`;
const HEARTSTONE_LUCK = $skill`Heartstone: %luck`; // 1/day, needs Heartstone equipped

/** Heartstone: LUCK unlocked, unused today, and the stone is on hand? */
function heartstoneLuckAvailable(): boolean {
  return have(HEARTSTONE) && get("heartstoneLuckUnlocked") && !get("_heartstoneLuckUsed");
}

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

/**
 * Turns a Lucky! refresh nets: it covers at most HAGGLING_FISHY_TURNS - 1 fights (the
 * block's last turn carries the next trip) and the trip itself costs one.
 */
export function refreshNetTurns(remainingFights: number): number {
  return Math.max(0, Math.min(HAGGLING_FISHY_TURNS - 1, remainingFights) - 1);
}

/** Would a mall clover pay for itself, on the same terms the profit model prices one? */
function mallWorthIt(remainingFights: number, price: number): boolean {
  return refreshNetTurns(remainingFights) * args.major.voa >= price;
}

// Cascade order fixed by user decision (2026-08-12): Lucky!-dedicated daily sources
// (saxophone, Heartstone) before the scepter — its 5 shared Aug. casts are flexible —
// then free-first among the clover-shaped sources.
const LUCKY_SOURCES: LuckySource[] = [
  {
    name: "Apriling band saxophone",
    // canPlay covers helmet ownership, uses left, and conjure-if-missing (all local state).
    available: () => AprilingBandHelmet.canPlay(SAXOPHONE, true),
    acquire: () => AprilingBandHelmet.play(SAXOPHONE, true),
  },
  {
    name: "Heartstone: LUCK",
    available: heartstoneLuckAvailable,
    acquire: () => {
      // The cast only works while the stone is worn — swap it into acc2 and back,
      // the same pattern lib.ts uses for the other Heartstone skills.
      const swap = !haveEquipped(HEARTSTONE);
      const currentAcc2 = equippedItem($slot`acc2`);
      if (swap) equip($slot`acc2`, HEARTSTONE);
      const cast = useSkill(HEARTSTONE_LUCK, 1);
      if (swap) equip($slot`acc2`, currentAcc2);
      return cast;
    },
  },
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
  if (AprilingBandHelmet.canPlay(SAXOPHONE, true)) {
    for (let i = 0; i < SAXOPHONE.dailyusesleft; i++) costs.push(0);
  }
  if (heartstoneLuckAvailable()) costs.push(0);
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
  const saxophone = !AprilingBandHelmet.have()
    ? "helmet not owned"
    : `${SAXOPHONE.dailyusesleft} play(s) left today`;
  const heartstone = !have(HEARTSTONE)
    ? "not owned"
    : !get("heartstoneLuckUnlocked")
      ? "LUCK not unlocked"
      : get("_heartstoneLuckUsed")
        ? "used today"
        : "available";
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
    `  Apriling band saxophone: ${saxophone}`,
    `  Heartstone: LUCK: ${heartstone}`,
    `  Aug. 2nd scepter: ${scepter}`,
    `  11-leaf clovers in inventory: ${itemAmount(CLOVER)}`,
    `  pill keeper: ${pillkeeper}`,
    `  hermit clovers left today: ${Math.max(0, HERMIT_CLOVER_LIMIT - get("_cloversPurchased"))}`,
    `  mall clovers: ${mall}`,
  ];
}

/** Sim-report line for the free, turn-free Fishy sources the budget already counts. */
export function freeFishyReport(): string {
  const lutz = lutzFishyAvailable()
    ? `available (+${LUTZ_FISHY_TURNS} turns)`
    : get("skateParkStatus") !== "ice"
      ? "Skate Park is not Ice Skate Territory"
      : get("_skateBuff1")
        ? "already dined today"
        : "visited this run without gaining Fishy";
  const pipe = !have($item`fishy pipe`)
    ? "not owned"
    : get("_fishyPipeUsed")
      ? "smoked today"
      : `available (+${FISHY_PIPE_TURNS} turns)`;
  return ` free fishy sources: Lutz, the Ice Skate: ${lutz} | fishy pipe: ${pipe}`;
}
