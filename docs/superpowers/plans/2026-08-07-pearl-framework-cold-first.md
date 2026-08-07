# Pearl Framework (Cold First) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pearlo` run in KoLmafia's gCLI farms the unblemished pearl in The Briniest Deepests end-to-end on a sober Pastamancer, on a framework that scales to all five pearl zones.

**Architecture:** grimoire-kolmafia task engine (`PearloEngine extends Engine`); data-driven `PEARLS` zone table; shared builders for outfit (res-cap-first + lantern damage gear) and combat (Entangling Noodles + Saucegeyser, cast count from a conservative damage calculator); mood-idiom buffs and explicit restores with mafia auto-recovery disabled.

**Tech Stack:** TypeScript → rollup bundle for KoLmafia's Rhino runtime; `kolmafia` ambient typings (r29133), `libram` 0.11.x, `grimoire-kolmafia` 0.3.x. Yarn 4.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-pearl-framework-cold-first-design.md` — read it before starting any task.
- Domain reference: `docs/sea-reference.md`, `docs/consumption-reference.md`, `docs/maximizer-reference.md`. **Never invent game facts** (item/effect/skill names, numbers). Every `$item`/`$effect`/`$skill` literal used in this plan is already verified; do not add new ones without checking `node_modules/libram/dist/propertyTypes.d.ts` / the wiki refs.
- No unit test framework exists and none is possible (the `kolmafia` package is throw-stubs outside mafia). The per-task verification cycle is: `yarn lint` (eslint + prettier) and `yarn build` (rollup) both exit 0. In-game behavior is verified at the end via `pearlo sim`.
- Maximizer strings: cap markers attach to the _previous_ keyword and `sea` resets that pointer — `"cold res 18 max, sea"`, never `"cold res, sea, 18 max"`.
- Never hard-code organ capacities; always `fullnessLimit()`/`inebrietyLimit()`/`spleenLimit()`.
- No +ML modifiers anywhere.
- Free/owned resources only (no mall buying) in v1.
- Existing code style: 2-space indent, double quotes, semicolons, `@trivago` import sort (eslint enforces). Match it.
- Commit after each task with the message given in the task.

---

### Task 0: Git hygiene (.gitignore + initial commit)

**Files:**

- Create: `.gitignore`

**Interfaces:**

- Consumes: nothing
- Produces: a clean repo baseline every later task commits onto

- [ ] **Step 1: Write `.gitignore`**

```gitignore
node_modules/
dist/
.yarn/*
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/sdks
!.yarn/versions
*.log
```

- [ ] **Step 2: Verify tracked set looks right**

Run: `git add -A -n | head -30`
Expected: adds `src/`, `docs/`, config files, `yarn.lock`, `.yarnrc.yml`; does NOT add `node_modules/` or `.yarn/cache`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: initial commit — pearlo scaffolding, docs, spec"
```

---

### Task 1: Real organ predicates in `lib.ts`

**Files:**

- Modify: `src/lib.ts` (the four stub functions at the bottom, currently returning `false`)

**Interfaces:**

- Consumes: `kolmafia` `myFullness/fullnessLimit/myInebriety/inebrietyLimit/mySpleenUse/spleenLimit`
- Produces: `isStomachCapped(): boolean`, `isLiverCapped(): boolean`, `isSpleenCapped(): boolean`, `isOverDrunk(): boolean` — used by Task 7 (guards)

- [ ] **Step 1: Replace the four stubs**

Replace the block from `export function isLiverCapped()` to the end of the file with:

```ts
export function isLiverCapped(): boolean {
  return myInebriety() >= inebrietyLimit();
}
export function isStomachCapped(): boolean {
  return myFullness() >= fullnessLimit();
}
export function isSpleenCapped(): boolean {
  return mySpleenUse() >= spleenLimit();
}
export function isOverDrunk(): boolean {
  return myInebriety() > inebrietyLimit();
}
```

Add to the existing `kolmafia` import list: `fullnessLimit, inebrietyLimit, myFullness, myInebriety, mySpleenUse, spleenLimit`.

- [ ] **Step 2: Lint + build**

Run: `yarn lint && yarn build`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib.ts
git commit -m "feat: real organ predicates (query limits at runtime, never hard-code)"
```

---

### Task 2: Zone data — extend `PEARLS` and export `PearlSpec`

**Files:**

- Modify: `src/pearls.ts` (the `PearlSpec` type and `PEARLS` array)

**Interfaces:**

- Consumes: existing `PEARLS` entries
- Produces: `export type PearlSpec` with new fields `element: Element`, `parkaMode: string`, `key: PearlKey`; `export type PearlKey = "spooky" | "sleaze" | "hot" | "stench" | "cold"`; `export const PEARLS: PearlSpec[]` — consumed by Tasks 3, 5, 6, 7, 8

- [ ] **Step 1: Extend the type and table**

Change the type (and export it):

```ts
export type PearlKey = "spooky" | "sleaze" | "hot" | "stench" | "cold";

export type PearlSpec = {
  key: PearlKey;
  loc: Location;
  element: Element;
  after: string[];
  modifier: string;
  parkaMode: string;
  obtained: BooleanProperty;
  progress: NumericProperty;
  avoid?: Item[];
};
```

Add to each `PEARLS` entry (zone → element → parka mode, per `docs/sea-reference.md`):

| loc                   | key        | element            | parkaMode        |
| --------------------- | ---------- | ------------------ | ---------------- |
| Anemone Mine          | `"spooky"` | `$element`spooky`` | `"ghostasaurus"` |
| The Dive Bar          | `"sleaze"` | `$element`sleaze`` | `"spikolodon"`   |
| The Marinara Trench   | `"hot"`    | `$element`hot``    | `"pterodactyl"`  |
| Madness Reef          | `"stench"` | `$element`stench`` | `"dilophosaur"`  |
| The Briniest Deepests | `"cold"`   | `$element`cold``   | `"kachungasaur"` |

Import `Element` from `kolmafia` and `$element` from `libram`. Keep every existing field
(including `avoid: $items`Mer-kin digpick`` on Anemone Mine) unchanged.

Note: `PEARLS` order stays as-is; selection order comes from args (Task 3).

- [ ] **Step 2: Lint + build**

Run: `yarn lint && yarn build`
Expected: exit 0. (`main.ts` doesn't consume the new fields yet — that's fine.)

- [ ] **Step 3: Commit**

```bash
git add src/pearls.ts
git commit -m "feat: extend PEARLS zone table with element, parka mode, and key"
```

---

### Task 3: `pearls=` argument and selection parsing

**Files:**

- Modify: `src/args.ts`

**Interfaces:**

- Consumes: `PearlKey`, `PEARLS`, `PearlSpec` from `src/pearls.ts`
- Produces: `args.pearls: string` (grimoire arg, default `"spooky,sleaze,hot,stench,cold"`); `export function selectedPearls(): PearlSpec[]` — ordered, validated; throws (via `abort`) on unknown or duplicate keys. Consumed by Tasks 7, 8.

- [ ] **Step 1: Add the arg and parser**

In `src/args.ts`, replace the commented-out `pearls` block with a real arg (top level, next to `sim`/`version`):

```ts
    pearls: Args.string({
      help: "Comma-separated ordered subset of pearls to farm: spooky,sleaze,hot,stench,cold. No duplicates.",
      default: "spooky,sleaze,hot,stench,cold",
    }),
```

Append at the bottom of the file:

```ts
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
    result.push(spec as PearlSpec);
  }
  if (result.length === 0) abort(`pearls=${args.pearls}: no pearls selected`);
  return result;
}
```

Imports to add: `abort` from `kolmafia`; `PEARLS, PearlKey, PearlSpec` from `./pearls`.
(`abort` returns `never`, so the `find` narrowing works without non-null assertions.)

- [ ] **Step 2: Lint + build**

Run: `yarn lint && yarn build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/args.ts
git commit -m "feat: pearls= ordered-subset argument with validation"
```

---

### Task 4: `PearloEngine` with the restore-pattern properties

**Files:**

- Create: `src/engine.ts`

**Interfaces:**

- Consumes: `grimoire-kolmafia` `Engine`, `Task`; `libram` `PropertiesManager`, `get`
- Produces: `export class PearloEngine extends Engine<never, Task>` — consumed by Task 8 (`main.ts`)

- [ ] **Step 1: Write the engine**

```ts
import { Engine, Task } from "grimoire-kolmafia";
import { PropertiesManager, get } from "libram";

export class PearloEngine extends Engine<never, Task> {
  initPropertiesManager(manager: PropertiesManager): void {
    super.initPropertiesManager(manager);
    const bannedAutoRestorers = [
      "sleep on your clan sofa",
      "rest in your campaway tent",
      "rest at the chateau",
      "rest at your campground",
      "free rest",
    ]; // free rests are for closers
    const hpItems = get("hpAutoRecoveryItems")
      .split(";")
      .filter((s) => !bannedAutoRestorers.includes(s))
      .join(";");
    const mpItems = Array.from(
      new Set([...get("mpAutoRecoveryItems").split(";"), "doc galaktik's invigorating tonic"]),
    )
      .filter((s) => !bannedAutoRestorers.includes(s))
      .join(";");
    manager.set({
      autoSatisfyWithCloset: false,
      hpAutoRecovery: -0.05,
      mpAutoRecovery: -0.05,
      maximizerCombinationLimit: 0,
      hpAutoRecoveryItems: hpItems,
      mpAutoRecoveryItems: mpItems,
    });
  }
}
```

Note: if `libram` does not export `PropertiesManager` under that name in this version, check `node_modules/libram/dist/index.d.ts` for the export (it re-exports from `propertyTyping`/`property`); adjust the import path, not the pattern. If `get("hpAutoRecoveryItems")` is typed as a non-string property type, use `get("hpAutoRecoveryItems", "")`.

- [ ] **Step 2: Lint + build**

Run: `yarn lint && yarn build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/engine.ts
git commit -m "feat: PearloEngine — auto-recovery off, curated restorers, no free rests"
```

---

### Task 5: Combat — damage calculator and macro builder

**Files:**

- Modify: `src/combat.ts` (currently a 2-line comment stub)

**Interfaces:**

- Consumes: `PearlSpec` from `./pearls`; `kolmafia` `haveEquipped, myBuffedstat, numericModifier, mpCost`; `libram` `$item, $skill, $stat, Macro, have`
- Produces (consumed by Tasks 6, 7, 8):
  - `export type DamagePlan = { perCast: number; casts: number; mpPerFight: number; oneShot: boolean }`
  - `export function saucegeyserDamage(prospectiveLanterns?: number): number` — conservative floor
  - `export function damagePlan(targetHp?: number, prospectiveLanterns?: number): DamagePlan`
  - `export function equippedLanternComponents(): number`
  - `export function ownedLanternProspect(): number`
  - `export function buildPearlMacro(spec: PearlSpec, plan: DamagePlan): Macro`
  - `export const ZONE_MAX_HP = 800;`

- [ ] **Step 1: Write the module**

Replace `src/combat.ts` with:

```ts
import { haveEquipped, mpCost, myBuffedstat, numericModifier } from "kolmafia";
import { $item, $skill, $stat, Macro, get, have } from "libram";

import { PearlSpec } from "./pearls";

export const ZONE_MAX_HP = 800; // ganger, giant squid — highest in any pearl zone

// Lantern components added per equipped source, conservative counts
// (CMoI rolls 3 random elements; worst case one collides with the geyser's tune → 2).
// See docs/sea-reference.md and the Lanterns wiki mechanics in the spec.
const LANTERN_COMPONENTS: [Item, number][] = [
  [$item`Congressional Medal of Insanity`, 2],
  [$item`petrified wood water purifier`, 2], // cold AND sleaze
  [$item`meteorb`, 1],
  [$item`snow mobile`, 1],
  [$item`big hot pepper`, 1],
];

function capeIsKillLantern(): boolean {
  return (
    haveEquipped($item`unwrapped knock-off retro superhero cape`) &&
    get("retroCapeSuperhero") === "heck" &&
    get("retroCapeWashingInstructions") === "kill"
  );
}

export function equippedLanternComponents(): number {
  let n = 0;
  for (const [item, components] of LANTERN_COMPONENTS) {
    if (haveEquipped(item)) n += components;
  }
  if (capeIsKillLantern()) n += 1;
  return n;
}

/** Upper bound on lantern components if we equip everything we own (planning pass). */
export function ownedLanternProspect(): number {
  let n = 0;
  for (const [item, components] of LANTERN_COMPONENTS) {
    if (have(item)) n += components;
  }
  if (have($item`unwrapped knock-off retro superhero cape`)) n += 1;
  return n;
}

/**
 * Conservative (guaranteed-floor) Saucegeyser damage.
 * Formula per docs (Calculating_Spell_Damage): worst-case base roll 60, 40% Myst,
 * flat bonuses pre-multiplier, percent applied after; uncapped. Lanterns duplicate the
 * highest component — modeled pre-multiplier (worst case) and non-compounding.
 */
export function saucegeyserDamage(prospectiveLanterns?: number): number {
  const myst = myBuffedstat($stat`Mysticality`);
  const flat = numericModifier("Spell Damage");
  const elem = Math.min(numericModifier("Hot Spell Damage"), numericModifier("Cold Spell Damage"));
  const pct = numericModifier("Spell Damage Percent");
  const preMult = 60 + Math.floor(0.4 * myst) + flat + elem;
  const base = Math.ceil((1 + pct / 100) * preMult);
  const lanterns = prospectiveLanterns ?? equippedLanternComponents();
  return base + lanterns * Math.max(0, preMult);
}

export function damagePlan(targetHp = ZONE_MAX_HP, prospectiveLanterns?: number): DamagePlan {
  const perCast = Math.max(1, saucegeyserDamage(prospectiveLanterns));
  const casts = Math.max(1, Math.ceil(targetHp / perCast));
  const mpPerFight =
    (have($skill`Entangling Noodles`) ? mpCost($skill`Entangling Noodles`) : 0) +
    casts * mpCost($skill`Saucegeyser`);
  return { perCast, casts, mpPerFight, oneShot: casts === 1 };
}

export type DamagePlan = {
  perCast: number;
  casts: number;
  mpPerFight: number;
  oneShot: boolean;
};

/**
 * Non-melee everywhere: the acoustic electric eel counters landed melee attacks
 * (~89-100 HP each) — spells never trigger it. Noodles (if known) buys 3-5 stunned
 * rounds; Saucegeyser repeats until the fight ends.
 */
export function buildPearlMacro(spec: PearlSpec, plan: DamagePlan): Macro {
  void spec; // per-monster branches (stench-zone pufferfish/dragonfish stun) arrive with those zones
  const macro = new Macro();
  if (!plan.oneShot && have($skill`Entangling Noodles`)) {
    macro.trySkill($skill`Entangling Noodles`);
  }
  return macro.skill($skill`Saucegeyser`).repeat();
}
```

Also add `Item` to the `kolmafia` import (for the tuple type) and `get` is already in the `libram` import above.

- [ ] **Step 2: Lint + build**

Run: `yarn lint && yarn build`
Expected: exit 0. If eslint-plugin-libram rejects any `$item`/`$skill` name, STOP — the name is wrong; check `docs/sea-reference.md` / the wiki before "fixing" the string.

- [ ] **Step 3: Verify the two cape preference names exist**

Run: `grep -c '"retroCapeSuperhero"\|"retroCapeWashingInstructions"' node_modules/libram/dist/propertyTypes.d.ts`
Expected: `2` (both names present). If not, find the real names with `grep -o '"retroCape[^"]*"' node_modules/libram/dist/propertyTypes.d.ts | sort -u` and use those.

- [ ] **Step 4: Commit**

```bash
git add src/combat.ts
git commit -m "feat: conservative Saucegeyser damage plan and pearl-zone kill macro"
```

---

### Task 6: Outfit builder (res cap first, lantern gear, cape mode, familiar)

**Files:**

- Modify: `src/outfit.ts` (currently a stub)

**Interfaces:**

- Consumes: `PearlSpec` from `./pearls`; `damagePlan, ownedLanternProspect` from `./combat`; `OutfitSpec` from `grimoire-kolmafia`; `libram` `$familiar, $item, $items, AsdonMartin, have`; `kolmafia` `Familiar`
- Produces: `export function buildPearlOutfit(spec: PearlSpec): OutfitSpec` — consumed by Task 7. Cape mode decision: `export function capeMode(): "kill" | "hold"`.

- [ ] **Step 1: Write the builder**

Replace `src/outfit.ts` with:

```ts
import { OutfitSpec } from "grimoire-kolmafia";
import { Familiar } from "kolmafia";
import { $familiar, $item, $items, AsdonMartin, have } from "libram";

import { damagePlan, ownedLanternProspect } from "./combat";
import { PearlSpec } from "./pearls";

const OFFHAND_LANTERNS = $items`petrified wood water purifier, meteorb, snow mobile, big hot pepper`;

/** Familiar breathing that leaves the famequip slot free (see docs/sea-reference.md §5). */
function familiarBreathesFree(): boolean {
  return AsdonMartin.installed() && have($effect`Driving Waterproofly`);
}

/**
 * Kill Me (spooky lantern) when the plan one-shots within Noodles coverage;
 * Hold Me (3-round stun) when we need more control than Noodles provides.
 */
export function capeMode(): "kill" | "hold" {
  const plan = damagePlan(undefined, ownedLanternProspect());
  return plan.casts <= 3 ? "kill" : "hold";
}

export function buildPearlOutfit(spec: PearlSpec): OutfitSpec {
  const equip = [];
  if (have($item`Congressional Medal of Insanity`))
    equip.push($item`Congressional Medal of Insanity`);
  const lantern = OFFHAND_LANTERNS.find((i) => have(i));
  if (lantern) equip.push(lantern);

  const modes: OutfitSpec["modes"] = {};
  if (have($item`Jurassic Parka`)) modes.parka = spec.parkaMode;

  let familiar: Familiar = $familiar.none;
  let famequip;
  if (familiarBreathesFree() && have($familiar`Left-Hand Man`)) {
    const second = OFFHAND_LANTERNS.filter((i) => have(i)).at(1);
    if (second) {
      familiar = $familiar`Left-Hand Man`;
      famequip = second;
    }
  }

  const result: OutfitSpec = {
    modifier: `${spec.key} res 18 max, sea, 0.05 hp regen, 0.05 mp regen, 0.1 init`,
    equip,
    modes,
    familiar,
    avoid: spec.avoid,
  };
  if (famequip) result.famequip = famequip;
  return result;
}
```

Notes for the implementer:

- Add `$effect` to the libram import.
- The retro cape is intentionally NOT equipped here yet: it needs non-back air. v1 rule: only add `$item`unwrapped knock-off retro superhero cape`` to `equip` (and set `modes.retrocape`) when the character has a *hat* breathing source or an air *effect* active — implement as: `if (have($item`unwrapped knock-off retro superhero cape`) && !airRequiresBackSlot()) { equip.push(cape); modes.retrocape = ["heck", capeMode() === "kill" ? "kill" : "hold"]; }` where `airRequiresBackSlot()` returns true when the only owned breathing option is `$item`old SCUBA tank`` (reuse `waterBreathingEquipment` from `./pearls` minus back-slot items to decide). Check the exact `Modes` shape for `retrocape` in `node_modules/libram/dist/maximize.d.ts` before writing it — if it is a single string, use `"heck kill"` form.
- Res cap keeps priority per spec: grimoire's `equip` list on an OutfitSpec is best-effort when merged through `Outfit.from` (items that can't fit are skipped), and the maximizer only optimizes leftover slots — but a forced `equip` that _fits_ yet ruins resistance is possible. v1 accepts this risk for the two damage items only (they occupy acc + offhand; res lives mostly in hat/back/pants/effects), and `sim` (Task 8) reports the post-dress res score so regressions are visible. Do not force anything else.

- [ ] **Step 2: Lint + build**

Run: `yarn lint && yarn build`
Expected: exit 0. Same rule as Task 5 for name errors: stop and verify, don't guess.

- [ ] **Step 3: Commit**

```bash
git add src/outfit.ts
git commit -m "feat: pearl outfit builder — res cap first, lantern gear, cape/parka modes"
```

---

### Task 7: Mood + task factory (buffs, restores, guards, budget)

**Files:**

- Create: `src/mood.ts`
- Modify: `src/pearls.ts` (replace the inline `PEARLS.map` task body with the factory; keep the Breathe Underwater task)

**Interfaces:**

- Consumes: everything above
- Produces: `export function pearlMood(spec: PearlSpec, mpPerFight: number): void` (mood.ts); `export function pearlTasks(selected: PearlSpec[]): Task[]` (pearls.ts) — consumed by Task 8

- [ ] **Step 1: Write `src/mood.ts`**

```ts
import { myHp, myMaxhp, myMaxmp, myMp, restoreHp, restoreMp, use } from "kolmafia";
import { $effect, $effects, $item, get, have } from "libram";

import { tryAcquiringEffect } from "./lib";
import { PearlSpec } from "./pearls";

// Verified spell-damage effects (Bonus_Spell_Damage wiki page):
// Carol of the Hells +100% spell dmg; Song of Sauce +100% and +50 hot;
// Jackasses' Symphony +12 flat. All acquisition is free-first via canAcquireEffect.
const SPELL_DAMAGE_EFFECTS = $effects`Carol of the Hells, Song of Sauce, Jackasses' Symphony of Destruction`;

// The user-authored defensive/res effect list, moved verbatim from the old inline
// prepare() in pearls.ts (copy it exactly — do not add or rename effects):
export const RESISTANCE_EFFECTS = $effects`Astral Shell, Egged On, Elemental Saucesphere, Feeling Peaceful, Blood Bond, Empathy, Scarysauce, Scariersauce, Leash of Linguini, A Few Extra Pounds, Big, Mariachi Mood, Patience of the Tortoise, Power Ballad of the Arrowsmith, Quiet Determination, Reptilian Fortitude, Saucemastery, Seal Clubbing Frenzy, Song of Starch, Stevedave's Shanty of Superiority`;

export function pearlMood(spec: PearlSpec, mpPerFight: number): void {
  void spec; // per-zone res effect pruning is a later refinement; current list is all-elements
  // Fishy: free pipe only in v1 (docs/consumption-reference.md)
  if (!have($effect`Fishy`) && have($item`fishy pipe`) && !get("_fishyPipeUsed")) {
    use($item`fishy pipe`);
  }
  for (const ef of RESISTANCE_EFFECTS) tryAcquiringEffect(ef);
  for (const ef of SPELL_DAMAGE_EFFECTS) tryAcquiringEffect(ef);
  // Explicit restores — auto-recovery is disabled by PearloEngine
  if (myMp() < 1.5 * mpPerFight) restoreMp(Math.min(myMaxmp(), 3 * mpPerFight));
  if (myHp() < 0.6 * myMaxhp()) restoreHp(myMaxhp());
}
```

- [ ] **Step 2: Replace the pearl task body in `src/pearls.ts`**

Replace the `...PEARLS.map(...)` expression inside `PearlsQuest` with a factory, and export a
tasks function. Keep the existing "Breathe Underwater" task object EXACTLY as it is; move it
into the factory output:

```ts
const observedProgressRate = new Map<PearlKey, number>();

function turnsNeeded(spec: PearlSpec): number {
  const remaining = 100 - get(spec.progress, 0);
  const optimistic = 10; // 1.7 * floor(18/3), capped — see docs/sea-reference.md
  const rate = observedProgressRate.get(spec.key) ?? optimistic;
  const perTurn = have($effect`Fishy`) ? 1 : 2;
  return Math.ceil(remaining / Math.max(1.7, rate)) * perTurn;
}

function pearlTask(spec: PearlSpec): Task {
  let plan = damagePlan();
  return {
    name: `${spec.loc}`,
    after: ["Breathe Underwater", ...spec.after],
    completed: () => get(spec.obtained),
    ready: () =>
      !isOverDrunk() &&
      canAdventure(spec.loc) &&
      myAdventures() - args.debug.halt >= turnsNeeded(spec),
    prepare: () => {
      plan = damagePlan(); // post-dress: real equipped modifiers
      pearlMood(spec, plan.mpPerFight);
    },
    do: spec.loc,
    post: () => {
      const before = observedProgressRate.get(spec.key);
      const progress = get(spec.progress, 0);
      const last = lastRecordedProgress.get(spec.key);
      if (last !== undefined && progress > last) {
        const delta = progress - last;
        observedProgressRate.set(spec.key, before === undefined ? delta : (before + delta) / 2);
      }
      lastRecordedProgress.set(spec.key, progress);
    },
    outfit: () => buildPearlOutfit(spec),
    combat: new CombatStrategy().macro(() => buildPearlMacro(spec, plan)),
    limit: { soft: 30 },
  };
}
const lastRecordedProgress = new Map<PearlKey, number>();

export function pearlTasks(selected: PearlSpec[]): Task[] {
  return [breatheUnderwaterTask, ...selected.map(pearlTask)];
}
```

Where `breatheUnderwaterTask` is the existing "Breathe Underwater" task object extracted to
a `const breatheUnderwaterTask: Task = { ... }` (unchanged body). Keep `PearlsQuest` exported
for compatibility but have it call `pearlTasks(PEARLS)`. The old inline `prepare`'s
20-effect `usefulEffects` list moves verbatim into `src/mood.ts` as `RESISTANCE_EFFECTS`
(Step 1 above shows it) and is applied inside `pearlMood` — delete the old inline `prepare`
from `pearls.ts` after the move (note the duplicate `Feeling Peaceful` in the original list
collapses to one entry). Imports to add in
`pearls.ts`: `canAdventure, myAdventures` (kolmafia); `CombatStrategy, Task` (grimoire);
`get, have, $effect` (libram — some already present); `args` from `./args`;
`buildPearlOutfit` from `./outfit`; `buildPearlMacro, damagePlan` from `./combat`;
`pearlMood` from `./mood`; `isOverDrunk` from `./lib`.

Note: `args.debug.halt` is the existing halt arg (debug group). Circular-import check:
`args.ts` imports `pearls.ts` (for PEARLS), and `pearls.ts` now imports `args` — ES modules
tolerate this cycle only if neither uses the other at module-eval time. `selectedPearls()`
and `ready()` both run post-init, so this is safe; but if rollup complains, break the cycle
by moving `PearlKey`/`PearlSpec`/`PEARLS` into a new `src/zones.ts` imported by both.

- [ ] **Step 3: Lint + build**

Run: `yarn lint && yarn build`
Expected: exit 0, no circular-dependency warnings that error the build.

- [ ] **Step 4: Commit**

```bash
git add src/mood.ts src/pearls.ts
git commit -m "feat: mood (buffs, fishy pipe, explicit restores) and pearl task factory"
```

---

### Task 8: `main.ts` — wiring, sim report, run loop

**Files:**

- Modify: `src/main.ts` (currently a hello-world stub)

**Interfaces:**

- Consumes: everything above
- Produces: the `main(command?: string)` entry KoLmafia invokes

- [ ] **Step 1: Write main**

Replace `src/main.ts` with:

```ts
import { Args, getTasks } from "grimoire-kolmafia";
import {
  canAdventure,
  myAdventures,
  myMeat,
  myTurncount,
  print,
  sinceKolmafiaRevision,
} from "kolmafia";
import { sinceKolmafiaRevision as libramSince } from "libram";

import { args, selectedPearls } from "./args";
import { damagePlan, ownedLanternProspect } from "./combat";
import { PearloEngine } from "./engine";
import { canBreathUnderwater, pearlTasks } from "./pearls";

export function main(command?: string): void {
  sinceKolmafiaRevision(28100);
  Args.fill(args, command);
  if (args.help) {
    Args.showHelp(args);
    return;
  }
  const selected = selectedPearls();
  if (args.sim) {
    const plan = damagePlan(undefined, ownedLanternProspect());
    print("pearlo sim:", "blue");
    print(` pearls selected: ${selected.map((p) => p.key).join(", ")}`);
    print(` can breathe underwater: ${canBreathUnderwater()}`);
    for (const p of selected) print(` canAdventure(${p.loc}): ${canAdventure(p.loc)}`);
    print(
      ` saucegeyser floor (best gear): ${plan.perCast} → ${plan.casts} cast(s)/fight, ${plan.mpPerFight} MP/fight`,
    );
    print(` adventures available: ${myAdventures()}`);
    return;
  }

  const startTurns = myTurncount();
  const startMeat = myMeat();
  const engine = new PearloEngine(getTasks([{ name: "Pearls", tasks: pearlTasks(selected) }]));
  try {
    engine.run();
  } finally {
    engine.destruct();
  }
  print(`pearlo: spent ${myTurncount() - startTurns} turns, meat ${myMeat() - startMeat}`, "blue");
  for (const p of selected) {
    print(` ${p.key}: obtained=${get(p.obtained)} progress=${get(p.progress, 0)}%`);
  }
}
```

Implementer notes:

- `sinceKolmafiaRevision` exists in BOTH `kolmafia` (ASH builtin) and `libram`; use ONE —
  prefer the libram one (throws `KolmafiaVersionError` cleanly) and delete the other import.
  Pick revision 28100 (the peer-dep floor); do not invent a higher number.
- Add `get` from `libram` to imports for the summary loop.
- `getTasks` wraps quests → tasks with `"Pearls/"` prefixes; task `after: ["Breathe Underwater"]`
  references must therefore be written as they appear post-flatten. Check grimoire's rename
  rule (Quest name prefix, `docs/CLAUDE.md` §grimoire): inside the same quest, local names
  in `after` are rewritten automatically — verify by building and running `pearlo debug.list`
  if available, else by reading `getTasks` behavior in
  `node_modules/grimoire-kolmafia/dist/task.js`.
- `version` flag: `if (args.version) { print("pearlo v0.0.0"); return; }` — add it, it exists in args.

- [ ] **Step 2: Lint + build**

Run: `yarn lint && yarn build`
Expected: exit 0; `dist/` contains the bundle with `require("kolmafia")` kept external — verify with: `grep -c "Cannot access the KoLmafia standard library" dist/*.js` returning `0` (the stub body must NOT be inlined).

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: main entry — args, sim report, engine run with destruct guard"
```

---

### Task 9: Final verification + docs touch-up

**Files:**

- Modify: `CLAUDE.md` (source-layout section)

**Interfaces:**

- Consumes: the finished build
- Produces: shippable v1

- [ ] **Step 1: Full clean check**

Run: `yarn lint && yarn build`
Expected: exit 0, zero warnings that indicate unused exports or cycles.

- [ ] **Step 2: Update CLAUDE.md source layout**

In `CLAUDE.md`'s "Source layout" section, update the file list: `main.ts` (real entry:
args → sim/run → engine with destruct guard), `engine.ts` (PearloEngine, restore pattern),
`combat.ts` (damage plan + macro), `outfit.ts` (res-cap-first builder), `mood.ts`
(buffs/fishy/restores), `pearls.ts` (zone table + task factory), `args.ts` (+`pearls=` arg,
`selectedPearls`). Remove the "stubs" wording.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md source layout reflects implemented v1"
```

- [ ] **Step 4: Hand off for in-game verification (user action)**

The implementer cannot run KoLmafia. Tell the user:

```
Build ready. To verify in-game on the Pastamancer:
1. yarn install-mafia          # builds + copies into mafia's scripts/
2. In the gCLI: pearlo sim     # capability report — check breathing, casts/fight, MP
3. pearlo pearls=cold          # live run: Briniest Deepests only
Expected: dresses with cold res (18 cap) + sea, fights with Noodles+Saucegeyser,
pearl pref _unblemishedPearlTheBriniestDeepests flips true, properties restored after.
```
