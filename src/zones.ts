import { Modes } from "grimoire-kolmafia";
import { Element, Item, Location, booleanModifier, canEquip, haveEffect, print } from "kolmafia";
import {
  $effect,
  $element,
  $items,
  $location,
  BooleanProperty,
  NumericProperty,
  get,
  have,
} from "libram";

// Leaf module: zone data and seaworthiness state. Imports nothing project-local, so
// args/combat/outfit/familiar/mood/pearls can all depend on it without cycles.

export const waterBreathingEquipment = $items`The Crown of Ed the Undying, aerated diving helmet, crappy Mer-kin mask, Mer-kin gladiator mask, Mer-kin scholar mask, old SCUBA tank, Elf Guard SCUBA tank`;
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
  /** choiceAdventure automation for the zone's noncombats (id → option). */
  choices?: { [id: number]: number };
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
    // NEVER equip the digpick here — it swaps the whole zone to the mining mini-game
    // (no combats, no pearl progress). docs/sea-reference.md §3.1.
    avoid: $items`Mer-kin digpick`,
    // Not a Micro Fish (306, one-time SC/TT chain): option 1 is the only button and
    // teaches Harpoon!/Summon Leviatuga.
    choices: { 306: 1 },
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
    // Barback (choice 309, appears only with Salacious Cocktailcrafting): option 2 =
    // leave — pearl progress comes from combats; seaode collection isn't pearlo's job.
    // The one-time AT/DB chains (307/308) are class-gated text the engine can't reach
    // for other classes; their terminal choices are single-option anyway.
    choices: { 309: 2 },
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
    // You've Hit Bottom (302 Sauceror / 303 Pastamancer, one-time): option 1 teaches
    // Deep Saucery / Tempuramancy — Tempuramancy unlocks the tempura air supply.
    // A Vent Horizon (304): conjure bubbling tempura batter for 200 MP, 3/day — feeds
    // the breathing task's tempura air path; failure costs nothing.
    // There is Sauce at the Bottom of the Ocean (305): leave — globes aren't pearlo's job.
    // Into the Abyss (1220, Space Jellyfish ≥400 lbs, once/ascension): nevermind.
    choices: { 302: 1, 303: 1, 304: 1, 305: 2, 1220: 2 },
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
    // Heavily Invested in Pun Futures (311, free, Grandpa-gated): leave; The Economist
    // of Scales (310, nested, free): take your leave (option 3). Scale trading is a
    // manual activity, not pearl farming.
    choices: { 310: 3, 311: 2 },
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
