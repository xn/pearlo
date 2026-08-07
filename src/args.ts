import { Args, ParseError } from "grimoire-kolmafia";
import { abort, Item } from "kolmafia";
import { $item } from "libram";

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
    }),
    minor: Args.group("Minor Options", {}),
    resources: Args.group("Resource Usage", {}),

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
