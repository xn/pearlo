import { Modes } from "grimoire-kolmafia";
import {
  Element,
  Item,
  Location,
  Monster,
  booleanModifier,
  canEquip,
  haveEffect,
  print,
} from "kolmafia";
import {
  $effect,
  $element,
  $item,
  $items,
  $location,
  $monster,
  BooleanProperty,
  NumericProperty,
  get,
  have,
} from "libram";

// Leaf module: zone data and seaworthiness state. Imports nothing project-local, so
// args/combat/outfit/familiar/mood/pearls can all depend on it without cycles.

// The trunks' commas would split inside a comma-separated $items list — keep them singular.
export const waterBreathingEquipment = [
  ...$items`The Crown of Ed the Undying, aerated diving helmet, crappy Mer-kin mask, Mer-kin gladiator mask, Mer-kin scholar mask, old SCUBA tank, Elf Guard SCUBA tank, oxygenated eggnog helmet`,
  $item`really, really nice swimming trunks`,
];
export const familiarWaterBreathingEquipment = $items`das boot, little bitty bathysphere`;

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

/** Resistance level where pearl progress caps at 10%/fight (docs/sea-reference.md §2). */
export const PEARL_RES_CAP = 18;

export type PearlKey = "spooky" | "sleaze" | "hot" | "stench" | "cold";

/** Mafia numeric-modifier name for a pearl element's resistance level. */
export function resModifierName(key: PearlKey): string {
  return `${key.charAt(0).toUpperCase()}${key.slice(1)} Resistance`;
}

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
  /** choiceAdventure automation for the zone's noncombats (id → option). */
  choices?: { [id: number]: number };
  /**
   * Monster to pick when the Peridot of Peril's "Peering Through Your Peridot" NC
   * (choice 1557) fires — first adventure of the day per zone with the Peridot
   * equipped; selection enters that combat immediately, no turn lost. The maximizer
   * likes the Peridot (+15% item, HP/MP regen match the outfit tie-breaker weights),
   * so the NC WILL fire; unanswered it halts the script. Picks are the zone's safest
   * monster per docs/sea-reference.md §3.
   */
  peridotMonster: Monster;
  /** Highest monster HP in the zone (docs/sea-reference.md §3) — the one-shot target. */
  maxHp: number;
  /** Highest monster Defense in the zone (docs/sea-reference.md §3) — the hit-guarantee target. */
  maxDef: number;
  /** Highest monster Attack in the zone (docs/sea-reference.md §3 stat tables). */
  maxAtk: number;
};

export const PEARLS: PearlSpec[] = [
  {
    key: "spooky",
    maxDef: 585,
    maxAtk: 500,
    maxHp: 750,
    loc: $location`Anemone Mine`,
    element: $element`spooky`,
    after: [],
    modifier: "spooky res",
    parkaMode: "ghostasaurus",
    obtained: "_unblemishedPearlAnemoneMine",
    progress: "_unblemishedPearlAnemoneMineProgress",
    // NEVER equip the digpick here — it swaps the whole zone to the mining mini-game
    // (no combats, no pearl progress). docs/sea-reference.md §3.1.
    avoid: $items`Mer-kin digpick`,
    // Not a Micro Fish (306, one-time SC/TT chain): option 1 is the only button and
    // teaches Harpoon!/Summon Leviatuga.
    choices: { 306: 1 },
    // Dodges the Anemone combatant's Majorly Poisoned spiral; the clownfish's sleaze/
    // spooky hits are half-soaked by the zone's 18 spooky res, and its seltzer drop
    // restores 150–200 MP (§3.1).
    peridotMonster: $monster`killer clownfish`,
  },
  {
    key: "sleaze",
    maxDef: 630,
    maxAtk: 600,
    maxHp: 800,
    loc: $location`The Dive Bar`,
    element: $element`sleaze`,
    after: [],
    modifier: "sleaze res",
    parkaMode: "spikolodon",
    obtained: "_unblemishedPearlDiveBar",
    progress: "_unblemishedPearlDiveBarProgress",
    // Barback (choice 309, appears only with Salacious Cocktailcrafting): option 2 =
    // leave — pearl progress comes from combats; seaode collection isn't pearlo's job.
    // The one-time AT/DB chains (307/308) are class-gated text the engine can't reach
    // for other classes; their terminal choices are single-option anyway.
    choices: { 309: 2 },
    // Lowest HP (550) and Attack (400) in the zone; the tippler's 600 Attack is the
    // Sea's hardest hitter (§3.2).
    peridotMonster: $monster`lounge lizardfish`,
  },
  {
    key: "hot",
    maxDef: 450,
    maxAtk: 550,
    maxHp: 800,
    loc: $location`The Marinara Trench`,
    element: $element`hot`,
    after: [],
    modifier: "hot res",
    parkaMode: "pterodactyl",
    obtained: "_unblemishedPearlMarinaraTrench",
    progress: "_unblemishedPearlMarinaraTrenchProgress",
    // You've Hit Bottom (302 Sauceror / 303 Pastamancer, one-time): option 1 teaches
    // Deep Saucery / Tempuramancy — Tempuramancy unlocks the tempura air supply.
    // A Vent Horizon (304): conjure bubbling tempura batter for 200 MP, 3/day — feeds
    // the breathing task's tempura air path; failure costs nothing.
    // There is Sauce at the Bottom of the Ocean (305): leave — globes aren't pearlo's job.
    // Into the Abyss (1220, Space Jellyfish ≥400 lbs, once/ascension): nevermind.
    choices: { 302: 1, 303: 1, 304: 1, 305: 2, 1220: 2 },
    // Lowest HP (700) in the zone and its only elemental attack is hot — fully soaked
    // by the zone's 18 hot res; the belle deals unmitigated spooky (§3.4).
    peridotMonster: $monster`Mer-kin diver`,
  },
  {
    key: "stench",
    maxDef: 450,
    maxAtk: 500,
    maxHp: 750,
    loc: $location`Madness Reef`,
    element: $element`stench`,
    after: [],
    modifier: "stench res",
    parkaMode: "dilophosaur",
    obtained: "_unblemishedPearlMadnessReef",
    progress: "_unblemishedPearlMadnessReefProgress",
    // Heavily Invested in Pun Futures (311, free, Grandpa-gated): leave; The Economist
    // of Scales (310, nested, free): take your leave (option 3). Scale trading is a
    // manual activity, not pearl farming.
    choices: { 310: 3, 311: 2 },
    // 0 initiative — we always win init, so the parka stagger lands before its
    // poison-on-hit can. The dragonfish's The Colors... (−5 all res) threatens pearl
    // progress and the pufferfish jabs its spine even on a miss (§3.3).
    peridotMonster: $monster`jamfish`,
  },
  {
    key: "cold",
    maxDef: 360,
    maxAtk: 425,
    maxHp: 800,
    loc: $location`The Briniest Deepests`,
    element: $element`cold`,
    after: [],
    modifier: "cold res",
    parkaMode: "kachungasaur",
    obtained: "_unblemishedPearlTheBriniestDeepests",
    progress: "_unblemishedPearlTheBriniestDeepestsProgress",
    // Never the acoustic electric eel (counters every landed melee for ~89–100); the
    // ganger's 800 HP is the harder one-shot (§3.5).
    peridotMonster: $monster`decent white shark`,
  },
];
