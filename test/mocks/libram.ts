/**
 * Fake `libram` module (see vitest.config.ts aliases). Implemented on top of the fake
 * kolmafia module so every fake object shares one identity registry per test.
 */
import {
  Class,
  Effect,
  Element,
  Familiar,
  Item,
  Location,
  Monster,
  Phylum,
  Skill,
  Slot,
  Stat,
  __state,
  haveEffect,
  itemAmount,
} from "./kolmafia";

// ---------- template tags ----------

type Gettable<T> = { get(name: string): T };

function joinTemplate(parts: TemplateStringsArray, values: unknown[]): string {
  return parts.raw.reduce((acc, part, i) => acc + part + (i < values.length ? values[i] : ""), "");
}

function singular<T>(cls: Gettable<T> & { none?: T }) {
  const tag = (parts: TemplateStringsArray, ...values: unknown[]): T =>
    cls.get(joinTemplate(parts, values).trim());
  tag.none = cls.none as T;
  return tag;
}

function plural<T>(cls: Gettable<T>) {
  return (parts: TemplateStringsArray, ...values: unknown[]): T[] =>
    joinTemplate(parts, values)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => cls.get(s));
}

export const $class = singular(Class);
export const $effect = singular(Effect);
export const $effects = plural(Effect);
export const $element = singular(Element);
export const $elements = plural(Element);
export const $familiar = singular(Familiar);
export const $familiars = plural(Familiar);
export const $item = singular(Item);
export const $items = plural(Item);
export const $location = singular(Location);
export const $monster = singular(Monster);
export const $monsters = plural(Monster);
export const $phylum = singular(Phylum);
export const $phyla = plural(Phylum);
export const $skill = singular(Skill);
export const $slot = singular(Slot);
export const $stat = singular(Stat);

// ---------- properties ----------

export type BooleanProperty = string;
export type NumericProperty = string;

export function get(name: string, def?: unknown): unknown {
  const stored = __state.properties.get(name);
  if (stored !== undefined) return stored;
  if (def !== undefined) return def;
  return "";
}

export function set(name: string, value: unknown): void {
  __state.properties.set(name, value);
}

export function withProperties(properties: Record<string, unknown>, callback: () => void): void {
  const saved = new Map<string, unknown>();
  for (const key of Object.keys(properties)) {
    saved.set(key, __state.properties.get(key));
    __state.properties.set(key, properties[key]);
  }
  try {
    callback();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) __state.properties.delete(key);
      else __state.properties.set(key, value);
    }
  }
}

// ---------- general helpers ----------

export function have(thing: Item | Effect | Familiar | Skill): boolean {
  if (thing instanceof Item) {
    if (itemAmount(thing) > 0) return true;
    for (const worn of __state.equipped.values()) if (worn === thing) return true;
    return false;
  }
  if (thing instanceof Effect) return haveEffect(thing) > 0;
  if (thing instanceof Familiar) return __state.familiarsOwned.has(thing);
  if (thing instanceof Skill) return __state.skillsKnown.has(thing);
  return false;
}

export function sum<T>(list: T[], mapper: (t: T) => number): number {
  return list.reduce((acc, t) => acc + mapper(t), 0);
}

export function maxBy<T>(list: T[], scorer: (t: T) => number, invert = false): T {
  if (list.length === 0) throw new Error("maxBy: empty list");
  let best = list[0];
  let bestScore = scorer(best);
  for (const t of list.slice(1)) {
    const score = scorer(t);
    if (invert ? score < bestScore : score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

export function getSaleValue(item: Item): number {
  return __state.saleValues.get(item) ?? 0;
}

export function uneffect(effect: Effect): boolean {
  __state.effects.delete(effect);
  return true;
}

export function unequip(slot: Slot): boolean {
  __state.equipped.delete(slot);
  return true;
}

export function sinceKolmafiaRevision(revision: number): void {
  void revision;
}

// ---------- Macro ----------

export class Macro {
  steps: string[] = [];
  private step(text: string): this {
    this.steps.push(text);
    return this;
  }
  attack(): this {
    return this.step("attack");
  }
  repeat(): this {
    return this.step("repeat");
  }
  skill(skill: Skill): this {
    return this.step(`skill ${skill}`);
  }
  trySkill(skill: Skill): this {
    return this.step(`tryskill ${skill}`);
  }
  tryItem(item: Item): this {
    return this.step(`tryitem ${item}`);
  }
  tryFunkslingItem(item1: Item, item2: Item): this {
    return this.step(`tryitem ${item1}, ${item2}`);
  }
  abort(): this {
    return this.step("abort");
  }
  static abort(): Macro {
    return new Macro().abort();
  }
}

// ---------- resource shims ----------

export const AprilingBandHelmet = {
  have: (): boolean => false,
  canPlay: (): boolean => false,
  play: (): boolean => false,
};

export const AugustScepter = {
  have: (): boolean => false,
  canCast: (): boolean => false,
};

export const AsdonMartin = {
  installed: (): boolean => __state.workshed === Item.get("Asdon Martin keyfob (on ring)"),
  drive: (): boolean => true,
  Driving: { Waterproofly: Effect.get("Driving Waterproofly") },
};

export const Witchess = {
  have: (): boolean => false,
};

export const EternityCodpiece = {
  have: (): boolean => false,
  currentGems: (): Item[] => [],
  SLOTS: [] as Slot[],
};

export class PropertiesManager {}
