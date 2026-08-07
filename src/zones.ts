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
    avoid: $items`Mer-kin digpick`,
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
