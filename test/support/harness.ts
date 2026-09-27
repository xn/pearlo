/**
 * Per-test loader. Each call resets the module registry, resets the fake game state,
 * lets the test configure that state, and only THEN imports the src modules — ordering
 * that matters because src reads game state at import time (args defaults read
 * `valueOfAdventure`, zone lists intern items, etc.) and holds module-level caches
 * (verdict cache, outlay cache, warned-once sets) that must start fresh per test.
 *
 * Everything tests hand to src functions is typed as the real kolmafia types (the
 * `import type` below resolves to the real package under tsc; at runtime it is erased),
 * while the fake object model lives in test/mocks/kolmafia.ts.
 */
import type { Effect, Familiar, Item, Skill } from "kolmafia";
import { vi } from "vitest";

import type { GameState } from "../mocks/kolmafia";

type Mocks = typeof import("../mocks/kolmafia");

export type ItemOptions = {
  /** Mall asking price (what buying costs). Unset/0 = no mall listing. */
  mall?: number;
  /** NPC store price. Unset/0 = no NPC store. */
  npc?: number;
  historical?: number;
  /** garboValue / getSaleValue — the SALE side, distinct from mall on purpose. */
  sale?: number;
  /** Effect granted on use, with its turn count. */
  effect?: string;
  duration?: number;
  /** Resistance the granted effect provides, per element name or "all". */
  res?: Partial<Record<"spooky" | "sleaze" | "hot" | "stench" | "cold" | "all", number>>;
  /** False marks the item owned but unwearable, as Standard restriction does. */
  canEquip?: boolean;
  /** Copies in inventory. */
  count?: number;
  tradeable?: boolean;
};

export const RES_NAMES = [
  "Spooky Resistance",
  "Sleaze Resistance",
  "Hot Resistance",
  "Stench Resistance",
  "Cold Resistance",
] as const;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type Tools = {
  state: GameState;
  mocks: Mocks;
  /** Look up / configure an item. Prices, effect, resistance, inventory in one call. */
  item: (name: string, options?: ItemOptions) => Item;
  effect: (name: string, mods?: Record<string, number>) => Effect;
  familiar: (name: string, opts?: { owned?: boolean; underwater?: boolean }) => Familiar;
  skill: (name: string, opts?: { known?: boolean; mp?: number }) => Skill;
  prop: (name: string, value: unknown) => void;
  /** Turns of Fishy currently active. */
  fishy: (turns: number) => void;
  /** Make any effect active for `turns`. */
  active: (name: string, turns: number) => void;
  /** What dressing an outfit yields. `spec.modifier` says which build it is. */
  onDress: (handler: (modifier: string) => void) => void;
  /**
   * What every speculative maximize reports: per-element resistance plus a satisfied
   * Adventure Underwater requirement. Also `maximizeReturn` stays true unless a test
   * flips it — charter case 1 exercises exactly that flip.
   */
  specRes: (res: number | Partial<Record<string, number>>, extra?: Record<string, boolean>) => void;
  /** The player's own measured modifier (numericModifier(name)). */
  playerRes: (element: string, value: number) => void;
};

function makeTools(mocks: Mocks, state: GameState): Tools {
  const item = (name: string, options: ItemOptions = {}): Item => {
    const it = mocks.Item.get(name);
    if (options.mall !== undefined) state.mallPrices.set(it, options.mall);
    if (options.npc !== undefined) state.npcPrices.set(it, options.npc);
    if (options.historical !== undefined) state.historicalPrices.set(it, options.historical);
    if (options.sale !== undefined) state.saleValues.set(it, options.sale);
    if (options.count !== undefined) state.inventory.set(it, options.count);
    if (options.canEquip === false) state.unequippable.add(it);
    else if (options.canEquip === true) state.unequippable.delete(it);
    if (options.tradeable === false) state.untradeable.add(it);
    const mods = state.itemMods.get(it) ?? {};
    if (options.duration !== undefined) mods["Effect Duration"] = options.duration;
    state.itemMods.set(it, mods);
    if (options.effect !== undefined) {
      const ef = mocks.Effect.get(options.effect);
      state.itemEffects.set(it, ef);
      if (options.res !== undefined) {
        const effectMods = state.effectMods.get(ef) ?? {};
        for (const [element, value] of Object.entries(options.res)) {
          if (element === "all") {
            for (const resName of RES_NAMES) effectMods[resName] = value;
          } else {
            effectMods[`${capitalize(element)} Resistance`] = value;
          }
        }
        state.effectMods.set(ef, effectMods);
      }
    }
    return it as unknown as Item;
  };

  return {
    state,
    mocks,
    item,
    effect: (name, mods = {}) => {
      const ef = mocks.Effect.get(name);
      state.effectMods.set(ef, { ...(state.effectMods.get(ef) ?? {}), ...mods });
      return ef as unknown as Effect;
    },
    familiar: (name, opts = {}) => {
      const fam = mocks.Familiar.get(name);
      if (opts.owned) state.familiarsOwned.add(fam);
      if (opts.underwater) state.underwaterFamiliars.add(fam);
      return fam as unknown as Familiar;
    },
    skill: (name, opts = {}) => {
      const sk = mocks.Skill.get(name);
      if (opts.known) state.skillsKnown.add(sk);
      if (opts.mp !== undefined) state.skillMpCosts.set(sk, opts.mp);
      return sk as unknown as Skill;
    },
    prop: (name, value) => {
      state.properties.set(name, value);
    },
    fishy: (turns) => {
      state.effects.set(mocks.Effect.get("Fishy"), turns);
    },
    active: (name, turns) => {
      state.effects.set(mocks.Effect.get(name), turns);
    },
    onDress: (handler) => {
      state.onDress = (spec) => {
        const modifier = (spec as { modifier?: string | string[] } | undefined)?.modifier;
        handler(Array.isArray(modifier) ? modifier.join(", ") : (modifier ?? ""));
      };
    },
    specRes: (res, extra = {}) => {
      if (typeof res === "number") {
        for (const resName of RES_NAMES) state.specMods[resName] = res;
      } else {
        for (const [element, value] of Object.entries(res)) {
          if (value !== undefined) state.specMods[`${capitalize(element)} Resistance`] = value;
        }
      }
      state.specMods["Adventure Underwater"] = true;
      Object.assign(state.specMods, extra);
    },
    playerRes: (element, value) => {
      state.playerMods[`${capitalize(element)} Resistance`] = value;
    },
  };
}

export type Game = Tools & {
  zones: typeof import("../../src/zones");
  combat: typeof import("../../src/combat");
  economics: typeof import("../../src/economics");
  mood: typeof import("../../src/mood");
  organs: typeof import("../../src/organs");
  outfit: typeof import("../../src/outfit");
  familiarModule: typeof import("../../src/familiar");
  fishyModule: typeof import("../../src/fishy");
  pearls: typeof import("../../src/pearls");
  args: typeof import("../../src/args").args;
};

/**
 * Reset everything and import a fresh copy of the script against a fresh game state.
 * `configure` runs BEFORE any src module loads.
 */
export async function loadGame(configure?: (tools: Tools) => void): Promise<Game> {
  vi.resetModules();
  const mocks = (await import("../mocks/kolmafia")) as Mocks;
  const state = mocks.__resetState();
  const tools = makeTools(mocks, state);
  configure?.(tools);
  const zones = await import("../../src/zones");
  const combat = await import("../../src/combat");
  const argsModule = await import("../../src/args");
  const organs = await import("../../src/organs");
  const outfit = await import("../../src/outfit");
  const familiarModule = await import("../../src/familiar");
  const economics = await import("../../src/economics");
  const mood = await import("../../src/mood");
  const fishyModule = await import("../../src/fishy");
  const pearls = await import("../../src/pearls");
  return {
    ...tools,
    zones,
    combat,
    economics,
    mood,
    organs,
    outfit,
    familiarModule,
    fishyModule,
    pearls,
    args: argsModule.args,
  };
}

/**
 * The standard hand-computable scenario the model tests build on:
 * - value of an adventure 1,000 meat; unblemished pearl sells for 50,000
 * - restores, cures and MP are free (all NPC healing prices 0), so
 *   profit = 50,000 − turns×1,000 − potion cost − refresh cost, exactly
 * - the speculative maximizer reports `res` in every element with air satisfied
 * - `fishyTurns` of Fishy are active (fights beyond them cost 2 turns)
 */
export function standardScenario(
  tools: Tools,
  { res = 18, fishyTurns = 0, voa = 1000, pearlValue = 50_000 } = {},
): void {
  tools.prop("valueOfAdventure", voa);
  tools.item("unblemished pearl", { sale: pearlValue });
  tools.specRes(res);
  if (fishyTurns > 0) tools.fishy(fishyTurns);
}

export const PEARL_VALUE = 50_000;
export const VOA = 1000;
