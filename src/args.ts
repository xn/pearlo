import { Args, ParseError } from "grimoire-kolmafia";
import { abort, Familiar, Item } from "kolmafia";
import { $familiar, $item, get } from "libram";

import { PEARLS, PearlKey, PearlSpec } from "./zones";

export const supportedWorksheds = [
  $item`none`,
  $item`model train set`,
  $item`cold medicine cabinet`,
  $item`Asdon Martin keyfob (on ring)`,
  $item`TakerSpace letter of Marque`,
];

export function workshedParser(value: string) {
  const item = Item.get(value);
  if (!supportedWorksheds.includes(item))
    return new ParseError(`received ${value} which was not a supported workshed`);
  return item;
}

export const args = Args.create(
  "pearlo",
  "This is a script for farming unblemished pearls",
  {
    sim: Args.flag({ help: "Check if you have the requirements to run this script.", setting: "" }),
    drunk: Args.flag({
      help: "With sim: report the overdrunk (wineglass, attack-only) plan as if you were falling-down drunk.",
      setting: "",
    }),
    profit: Args.flag({
      help: "Print the expected profit report (per-zone liver configuration, costs, verdict) and exit without spending turns.",
      setting: "",
    }),
    version: Args.flag({ help: "Show script version and exit.", setting: "" }),
    pearls: Args.string({
      help: "Comma-separated ordered subset of pearls to farm: spooky,sleaze,hot,stench,cold. No duplicates.",
      default: "spooky,sleaze,hot,stench,cold",
    }),
    major: Args.group("Major Options", {
      requirecap: Args.flag({
        help: "Halt instead of adventuring whenever the zone's elemental resistance is below the 18-resistance progress cap (default: farm on at the reduced rate).",
        default: false,
      }),
      drunkweapon: Args.item({
        help: "Weapon to wield while farming overdrunk (wineglass attack-only mode).",
        default: $item`June cleaver`,
      }),
      overcapped: Args.flag({
        setting: "",
        help: "Force equip organ expanding equipment such as angelbone totem while running turns.",
        default: false,
      }),
      voa: Args.number({
        help: "Meat value of an adventure, used for all profit decisions.",
        default: get("valueOfAdventure"),
      }),
      force: Args.flag({
        help: "Farm zones even when the profit model expects them to lose meat.",
        default: false,
      }),
    }),
    overrides: Args.group("Zone Overrides", {
      spookyfamiliar: Args.familiar({
        help: "Force this familiar in the Anemone Mine (spooky pearl zone).",
      }),
      sleazefamiliar: Args.familiar({
        help: "Force this familiar in The Dive Bar (sleaze pearl zone).",
      }),
      hotfamiliar: Args.familiar({
        help: "Force this familiar in The Marinara Trench (hot pearl zone).",
      }),
      stenchfamiliar: Args.familiar({
        help: "Force this familiar in the Madness Reef (stench pearl zone).",
      }),
      coldfamiliar: Args.familiar({
        help: "Force this familiar in The Briniest Deepests (cold pearl zone).",
      }),
      spookyoutfit: Args.string({
        help: "Saved KoL custom outfit to wear in the Anemone Mine (spooky pearl zone).",
      }),
      sleazeoutfit: Args.string({
        help: "Saved KoL custom outfit to wear in The Dive Bar (sleaze pearl zone).",
      }),
      hotoutfit: Args.string({
        help: "Saved KoL custom outfit to wear in The Marinara Trench (hot pearl zone).",
      }),
      stenchoutfit: Args.string({
        help: "Saved KoL custom outfit to wear in the Madness Reef (stench pearl zone).",
      }),
      coldoutfit: Args.string({
        help: "Saved KoL custom outfit to wear in The Briniest Deepests (cold pearl zone).",
      }),
    }),
    minor: Args.group("Minor Options", {}),
    resources: Args.group("Resource Usage", {
      luckyfishy: Args.flag({
        help: "Refresh Fishy via Lucky! + The Haggling in The Brinier Deepers when it runs out (Aug. 2nd scepter, owned clovers, free pill keeper, hermit; see cloverprice for mall). Off by default — enable to spend those daily resources on Fishy.",
        default: false,
      }),
      cloverprice: Args.number({
        help: "Max meat to pay per mall 11-leaf clover for the Fishy refresh. 0 (default) never buys from the mall — free/owned sources only.",
        default: 0,
      }),
    }),

    debug: Args.group("Debug Options", {
      verbose: Args.flag({
        help: "Print out a list of possible tasks at each step.",
        default: false,
      }),
      ignoretasks: Args.string({
        help: "A comma-separated list of task names that should not be done. Can be used as a workaround for script bugs where a task is crashing.",
      }),
      completedtasks: Args.string({
        help: "A comma-separated list of task names the should be treated as completed. Can be used as a workaround for script bugs.",
      }),
      list: Args.flag({
        help: "Show the status of all tasks and exit.",
        setting: "",
      }),
      settings: Args.flag({
        help: "Show the parsed value for all arguments and exit.",
        setting: "",
      }),
      lastasdonbumperturn: Args.number({
        help: "Set the last usage of Asdon Martin: Spring-Loaded Front Bumper, in case of a tracking issue",
        hidden: true,
      }),
      ignorekeys: Args.flag({
        help: "Ignore the check that all keys can be obtained. Typically for hardcore, if you plan to get your own keys",
        default: false,
      }),
      halt: Args.number({
        help: "Halt when you have this number of adventures remaining or fewer",
        default: 0,
      }),
      verify: Args.flag({
        help: "Verify that all supported paths pass basic checks",
        hidden: true,
        setting: "",
      }),
      allocate: Args.flag({
        help: "Check the current task resource allocation",
        hidden: true,
        setting: "",
      }),
      pause: Args.flag({
        help: "Pause before running .do() on the next task",
        hidden: true,
        setting: "",
      }),
      prep: Args.flag({
        help: "Do all preparation (breathing, outfit, buffs, restores) for the next zone task, print a state report, and stop without spending an adventure.",
        default: false,
        setting: "",
      }),
    }),
  },
  {
    defaultGroupName: "Information",
    // positionalArgs: ["path"] belongs here once a real `path` arg exists (11,037
    // Leagues support) — grimoire aborts at Args.create when the key is undefined.
  },
);

const scriptName = Args.getMetadata(args).scriptName;
export function toTempPref(name: string) {
  return `_${scriptName}_${name}`;
}

const PEARL_KEYS: PearlKey[] = ["spooky", "sleaze", "hot", "stench", "cold"];

export function selectedPearls(): PearlSpec[] {
  const keys = args.pearls
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const seen = new Set<string>();
  const result: PearlSpec[] = [];
  for (const key of keys) {
    if (!PEARL_KEYS.includes(key as PearlKey)) {
      abort(`pearls=${args.pearls}: unknown pearl "${key}" (valid: ${PEARL_KEYS.join(",")})`);
    }
    if (seen.has(key)) abort(`pearls=${args.pearls}: duplicate pearl "${key}"`);
    seen.add(key);
    const spec = PEARLS.find((p) => p.key === key);
    if (!spec) abort(`internal error: no PearlSpec for "${key}"`);
    result.push(spec);
  }
  if (result.length === 0) abort(`pearls=${args.pearls}: no pearls selected`);
  return result;
}

/**
 * The user's forced familiar for this zone, if any (Zone Overrides group). Args.familiar
 * parses the string "none" to Familiar.none rather than undefined, which would otherwise
 * read as an active (but broken) override — normalize it away here.
 */
export function familiarOverride(key: PearlKey): Familiar | undefined {
  const value = (() => {
    switch (key) {
      case "spooky":
        return args.overrides.spookyfamiliar;
      case "sleaze":
        return args.overrides.sleazefamiliar;
      case "hot":
        return args.overrides.hotfamiliar;
      case "stench":
        return args.overrides.stenchfamiliar;
      case "cold":
        return args.overrides.coldfamiliar;
    }
  })();
  return value === undefined || value === $familiar.none ? undefined : value;
}

/** The user's saved-outfit name for this zone, if any. Empty prefs count as unset. */
export function outfitOverride(key: PearlKey): string | undefined {
  const value = (() => {
    switch (key) {
      case "spooky":
        return args.overrides.spookyoutfit;
      case "sleaze":
        return args.overrides.sleazeoutfit;
      case "hot":
        return args.overrides.hotoutfit;
      case "stench":
        return args.overrides.stenchoutfit;
      case "cold":
        return args.overrides.coldoutfit;
    }
  })();
  return value !== undefined && value.length > 0 ? value : undefined;
}
