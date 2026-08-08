# Overcapped Mode + Profit Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep pearlo adventuring when stomach/liver/spleen are past their no-gear baselines (force-equip organ extenders, rescue mild overdrunk), and add a VOA-based profit model that picks the liver configuration (extenders vs Stooper vs wineglass), prices each zone, and gates unprofitable farming.

**Architecture:** Two new modules — `src/organs.ts` (call-time organ state, extender selection, liver mode) and `src/economics.ts` (garbo-lib valuation, per-zone per-configuration profit, chooser, report) — plus mode plumbing through `combat.ts`/`mood.ts`/`outfit.ts`/`pearls.ts`/`main.ts` that replaces raw `isOverDrunk()` with the chosen liver mode.

**Tech Stack:** TypeScript → rollup → KoLmafia Rhino runtime. Libraries: `kolmafia` (ambient, stays `external`), `libram`, `grimoire-kolmafia`, `garbo-lib` (already in package.json; bundled by rollup like libram).

**Spec:** `docs/superpowers/specs/2026-08-08-overcapped-profit-design.md` — read it first.

## Global Constraints

- **No unit tests exist and none can run** — every `kolmafia` stub throws outside mafia (CLAUDE.md). The test cycle for every task is: `yarn lint` clean + `yarn build` clean. In-game verification happens at the end (user runs `pearlo profit` / `pearlo sim`).
- `$item`/`$effect`/`$familiar`/... template constants must be **hoisted to module level** (eslint-plugin-libram enforces; it also validates names at lint time — a lint pass proves the game names are real).
- **Never hard-code organ capacities** — always `fullnessLimit()` / `inebrietyLimit()` / `spleenLimit()` at call time. No module-level organ state.
- `kolmafia` stays `external` in rollup (already configured — don't touch `rollup.config.ts`).
- `completed()`/`ready()` task callbacks must stay cheap — anything expensive they touch must be cached after first computation.
- Estimated (non-wiki-verified) constants in the cost model must carry an `ESTIMATE` comment marking them as guesses; wiki-verified numbers carry the fetch date.
- Commit after every task with a `feat:`/`refactor:` message ending in the standard co-author trailer.

## Verified game facts used below (do not re-derive)

- Extenders (wiki data pages, 2026-08-08), all "+1 capacity while equipped":
  angelbone chopsticks = accessory/Stomach; devilbone corset = shirt/Stomach (+13 ML);
  angelbone dice = accessory/Liver; devilbone rosary = accessory/Liver (+13 ML);
  angelbone totem = 1-handed weapon/Spleen; devilbone greaves = pants/Spleen (+13 ML).
- Stomach over limit = Food Coma, **cannot adventure**; spleen over limit = jaundiced,
  **cannot adventure**; liver over limit = falling-down drunk (wineglass adventuring OK).
- Doc Galaktik's Invigorating Tonic restores 9–11 MP (avg 10); Doc Galaktik's
  Restorative Balm heals 13–15 HP (avg 14). Both NPC-priced via `npcPrice()`.
- Monster damage (wiki Monsters page, 2026-08-08):
  `(max(0, Atk − Moxie) + 20–25% × Atk − DR) × resistance fractions`; monster hit% ≈
  `clamp(55 + (Atk − Moxie) × 5.5, 0, 100)% × 0.88 + 6% crit`.
- Max monster Atk per zone (docs/sea-reference.md §3 tables): spooky/Anemone Mine 500
  (killer clownfish), sleaze/Dive Bar 600 (Mer-kin tippler), hot/Marinara Trench 550
  (fisherfish), stench/Madness Reef 500 (magic dragonfish), cold/Briniest Deepests 425
  (decent white shark).
- Debuff cures: Majorly Poisoned → anti-anti-antidote (zones: Mine, Reef); The
  Colors... → soft green echo eyedrop antidote (zone: Reef). Proc rates undocumented.
- Progress: `1.7% × floor(res/3)` per fight, min 1.7, cap 10 at res 18; underwater
  turns cost 2 without Fishy, 1 with.

---

### Task 1: `src/organs.ts` — organ state + extender selection

**Files:**

- Create: `src/organs.ts`

**Interfaces:**

- Consumes: `kolmafia` (`fullnessLimit`, `inebrietyLimit`, `spleenLimit`, `myFullness`, `myInebriety`, `mySpleenUse`, `myFamiliar`, `haveEquipped`, `Item`), `libram` (`$familiar`, `$item`, `have`).
- Produces (used by every later task):
  - `type Organ = "stomach" | "liver" | "spleen"`
  - `type LiverMode = "sober" | "items" | "stooper" | "wineglass"`
  - `setLiverMode(mode: LiverMode | undefined): void` / `liverMode(): LiverMode` / `wineglassMode(): boolean`
  - `baselineLimit(organ: Organ): number` / `overage(organ: Organ): number`
  - `ownedExtenders(organ: Organ, mode?: LiverMode): Item[]`
  - `requiredOrganEquipment(mode?: LiverMode): Item[]` / `allOrganEquipment(mode?: LiverMode): Item[]`
  - `effectivelyOverDrunk(): boolean` / `canFixOvercap(): boolean`
  - `organStatusReport(): string[]`

- [ ] **Step 1: Write `src/organs.ts`**

```ts
import {
  Item,
  fullnessLimit,
  haveEquipped,
  inebrietyLimit,
  myFamiliar,
  myFullness,
  myInebriety,
  mySpleenUse,
  spleenLimit,
} from "kolmafia";
import { $familiar, $item, have } from "libram";

export type Organ = "stomach" | "liver" | "spleen";

/**
 * Liver play mode (spec: "chosen configuration is the single source of truth").
 * "sober": inebriety within the no-gear baseline. "items"/"stooper": over baseline but
 * rescued back under the effective limit by liver extenders (plus Stooper's +1 for
 * "stooper") — spell combat works. "wineglass": drunk beyond rescue, attack-only.
 * src/economics.ts chooses and sets the mode at startup; the fallback computation in
 * liverMode() only covers contexts that run before the chooser.
 */
export type LiverMode = "sober" | "items" | "stooper" | "wineglass";

// 2026 Standard rewards, +1 capacity while equipped (wiki data pages, 2026-08-08).
// Preference order: angelbone first — no +13 ML (bonus ML feeds stun resistance and
// monster stats, docs/sea-reference.md §6) and no shirt cost (corset competes with the
// Jurassic Parka).
const STOMACH_EXTENDERS = [$item`angelbone chopsticks`, $item`devilbone corset`];
const LIVER_EXTENDERS = [$item`angelbone dice`, $item`devilbone rosary`];
// totem = 1-handed weapon, greaves = pants. Sober spell combat leaves the weapon slot
// cheap (totem first); wineglass combat needs it for the drunkweapon (greaves first,
// totem only as a required last resort — best-effort attack combat, user decision).
const SPLEEN_EXTENDERS_SOBER = [$item`angelbone totem`, $item`devilbone greaves`];
const SPLEEN_EXTENDERS_WINEGLASS = [$item`devilbone greaves`, $item`angelbone totem`];

let chosenLiverMode: LiverMode | undefined;

export function setLiverMode(mode: LiverMode | undefined): void {
  chosenLiverMode = mode;
}

export function liverMode(): LiverMode {
  if (chosenLiverMode !== undefined) return chosenLiverMode;
  if (overage("liver") === 0) return "sober";
  if (effectivelyOverDrunk()) return "wineglass";
  // Explicit mode argument — ownedExtenders' default parameter is liverMode(), so
  // letting it default here would recurse forever. The liver list is mode-independent.
  if (ownedExtenders("liver", "sober").length >= overage("liver")) return "items";
  return have($familiar`Stooper`) ? "stooper" : "wineglass";
}

export function wineglassMode(): boolean {
  return liverMode() === "wineglass";
}

function extenders(organ: Organ, mode: LiverMode): Item[] {
  switch (organ) {
    case "stomach":
      return STOMACH_EXTENDERS;
    case "liver":
      return LIVER_EXTENDERS;
    case "spleen":
      return mode === "wineglass" ? SPLEEN_EXTENDERS_WINEGLASS : SPLEEN_EXTENDERS_SOBER;
  }
}

export function ownedExtenders(organ: Organ, mode: LiverMode = liverMode()): Item[] {
  return extenders(organ, mode).filter((i) => have(i));
}

function equippedExtenderCount(organ: Organ): number {
  return extenders(organ, "sober").filter((i) => haveEquipped(i)).length;
}

/** The organ limit with every equipped extender's +1 (and Stooper's, for liver) stripped. */
export function baselineLimit(organ: Organ): number {
  switch (organ) {
    case "stomach":
      return fullnessLimit() - equippedExtenderCount("stomach");
    case "liver":
      return (
        inebrietyLimit() -
        equippedExtenderCount("liver") -
        (myFamiliar() === $familiar`Stooper` ? 1 : 0)
      );
    case "spleen":
      return spleenLimit() - equippedExtenderCount("spleen");
  }
}

function organUsage(organ: Organ): number {
  switch (organ) {
    case "stomach":
      return myFullness();
    case "liver":
      return myInebriety();
    case "spleen":
      return mySpleenUse();
  }
}

/** How far past the no-gear baseline this organ currently is. */
export function overage(organ: Organ): number {
  return Math.max(0, organUsage(organ) - baselineLimit(organ));
}

/** Drunk beyond any conceivable rescue (items + Stooper) — wineglass mode is certain. */
export function effectivelyOverDrunk(): boolean {
  return (
    myInebriety() >
    baselineLimit("liver") +
      LIVER_EXTENDERS.filter((i) => have(i)).length +
      (have($familiar`Stooper`) ? 1 : 0)
  );
}

/**
 * Minimal owned equipment that makes every organ legal for adventuring. Stomach/spleen
 * overcap (Food Coma / jaundiced) blocks adventuring entirely, so their extenders are
 * mandatory — flag or no flag. Liver extenders appear only in the rescue modes; in
 * wineglass mode they are dead slots (user rule: more overdrunk than extenders can
 * handle → adventure via wineglass instead).
 */
export function requiredOrganEquipment(mode: LiverMode = liverMode()): Item[] {
  const required: Item[] = [
    ...ownedExtenders("stomach", mode).slice(0, overage("stomach")),
    ...ownedExtenders("spleen", mode).slice(0, overage("spleen")),
  ];
  if (mode === "items" || mode === "stooper") {
    const fromStooper = mode === "stooper" ? 1 : 0;
    required.push(
      ...ownedExtenders("liver", mode).slice(0, Math.max(0, overage("liver") - fromStooper)),
    );
  }
  return required;
}

/**
 * Every owned extender, for the `overcapped` flag (max consumption headroom while
 * running turns) — minus wineglass-mode dead weight: liver extenders always, and the
 * totem unless it is actually required (the drunkweapon owns the weapon slot).
 */
export function allOrganEquipment(mode: LiverMode = liverMode()): Item[] {
  const required = requiredOrganEquipment(mode);
  const all = [
    ...ownedExtenders("stomach", mode),
    ...ownedExtenders("spleen", mode),
    ...ownedExtenders("liver", mode),
  ];
  return all.filter((i) => {
    if (required.includes(i)) return true;
    if (mode !== "wineglass") return true;
    if (LIVER_EXTENDERS.includes(i)) return false;
    if (i === $item`angelbone totem`) return false;
    return true;
  });
}

/** Stomach/spleen overages coverable by owned extenders? False → nothing can adventure. */
export function canFixOvercap(): boolean {
  return (
    overage("stomach") <= ownedExtenders("stomach").length &&
    overage("spleen") <= ownedExtenders("spleen").length
  );
}

/** Human-readable organ state for sim/profit output. */
export function organStatusReport(): string[] {
  const organs: Organ[] = ["stomach", "liver", "spleen"];
  const lines = organs.map((organ) => {
    const over = overage(organ);
    const owned = ownedExtenders(organ);
    return (
      ` ${organ}: ${organUsage(organ)} used / ${baselineLimit(organ)} baseline` +
      (over > 0 ? ` — OVER by ${over}` : "") +
      ` (extenders owned: ${owned.length > 0 ? owned.join(", ") : "none"})`
    );
  });
  lines.push(` liver mode: ${liverMode()}`);
  return lines;
}
```

- [ ] **Step 2: Lint**

Run: `yarn lint`
Expected: clean. (This also validates the six item names and `Stooper` against libram's data — a failure here means a name is wrong; stop and re-verify against the wiki, do not "fix" by inventing a name.)

- [ ] **Step 3: Build**

Run: `yarn build`
Expected: rollup completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/organs.ts
git commit -m "feat: organs module — extender selection, liver mode, overcap state"
```

---

### Task 2: args — `overcapped`, `voa`, `force`, `profit`

**Files:**

- Modify: `src/args.ts`

**Interfaces:**

- Consumes: existing `Args.create` structure (`src/args.ts:22-107`).
- Produces: `args.major.overcapped: boolean`, `args.major.voa: number`, `args.major.force: boolean`, `args.profit: boolean`. Later tasks reference exactly these paths.

- [ ] **Step 1: Add the args**

In `src/args.ts`, add `get` to the libram import (line 3 becomes):

```ts
import { $item, get } from "libram";
```

Add `profit` to the top-level (Information) group, directly after the `drunk` flag (after line 30):

```ts
    profit: Args.flag({
      help: "Print the expected profit report (per-zone liver configuration, costs, verdict) and exit without spending turns.",
      setting: "",
    }),
```

Add three entries to the `major` group, after `drunkweapon` (after line 44):

```ts
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
```

- [ ] **Step 2: Lint + build**

Run: `yarn lint && yarn build`
Expected: both clean. (`get("valueOfAdventure")` is a typed numeric preference; if lint complains about the import order, run `yarn format` first.)

- [ ] **Step 3: Commit**

```bash
git add src/args.ts
git commit -m "feat: overcapped, voa, force, and profit args"
```

---

### Task 3: `zones.ts` — `maxAtk` per zone

**Files:**

- Modify: `src/zones.ts` (PearlSpec type ~line 49, the five PEARLS entries)

**Interfaces:**

- Produces: `PearlSpec.maxAtk: number` — consumed by the economics HP-cost model in Task 4.

- [ ] **Step 1: Add the field**

In the `PearlSpec` type, directly after `maxDef: number;` add:

```ts
/** Highest monster Attack in the zone (docs/sea-reference.md §3 stat tables). */
maxAtk: number;
```

Add to each PEARLS entry, next to its existing `maxDef`/`maxHp` (values from the §3 tables — the zone keys identify the entries):

| key (zone)                     | add                                 |
| ------------------------------ | ----------------------------------- |
| `spooky` (Anemone Mine)        | `maxAtk: 500,` (killer clownfish)   |
| `sleaze` (The Dive Bar)        | `maxAtk: 600,` (Mer-kin tippler)    |
| `hot` (The Marinara Trench)    | `maxAtk: 550,` (fisherfish)         |
| `stench` (Madness Reef)        | `maxAtk: 500,` (magic dragonfish)   |
| `cold` (The Briniest Deepests) | `maxAtk: 425,` (decent white shark) |

- [ ] **Step 2: Lint + build**

Run: `yarn lint && yarn build`
Expected: clean. A missing `maxAtk` on any entry is a type error — the compiler enforces completeness.

- [ ] **Step 3: Commit**

```bash
git add src/zones.ts
git commit -m "feat: per-zone max monster attack data for the profit model"
```

---

### Task 4: `src/economics.ts` — valuation, cost model, chooser, report

**Files:**

- Create: `src/economics.ts`
- Modify: `src/familiar.ts` (export one existing private function)

**Interfaces:**

- Consumes: Task 1's organs API, Task 2's `args.major.voa`/`args.major.overcapped`, Task 3's `spec.maxAtk`; `damagePlan`, `wineglassAccessible` from `src/combat.ts`; `playerAirByEffect`, `familiarBreathesFree` from `src/familiar.ts`; `familiarWaterBreathingEquipment` from `src/zones.ts`; `makeValue` from `garbo-lib`.
- Produces (consumed by Task 6):
  - `type ZoneEconomics = { key: PearlKey; mode: LiverMode; res: number; ratePct: number; fights: number; turns: number; pearlMeat: number; turnCost: number; mpCost: number; hpCost: number; cureCost: number; profit: number; go: boolean }`
  - `chooseLiverConfiguration(selected: PearlSpec[]): LiverMode` (also calls `setLiverMode`)
  - `zoneVerdict(spec: PearlSpec): ZoneEconomics` (cached — safe in `ready()`)
  - `printProfitReport(selected: PearlSpec[]): void`
  - `pearlValue(): number`

- [ ] **Step 1: Export `resFamiliarSwitches` from `src/familiar.ts`**

Change `function resFamiliarSwitches(` (src/familiar.ts:68) to `export function resFamiliarSwitches(`. No other change — the speculative res pass offers the maximizer the same familiar switches the real outfit does, so configurations that keep the familiar slot free aren't underestimated relative to the Stooper configuration.

- [ ] **Step 2: Write `src/economics.ts`**

```ts
import { makeValue } from "garbo-lib";
import type { ValueFunctions } from "garbo-lib";
import {
  Familiar,
  Item,
  historicalPrice,
  maximize,
  myBuffedstat,
  myFamiliar,
  npcPrice,
  print,
  useFamiliar,
} from "kolmafia";
import { $effect, $familiar, $item, $skill, $stat, get, have, maxBy, sum } from "libram";

import { args } from "./args";
import { damagePlan, wineglassAccessible } from "./combat";
import { familiarBreathesFree, playerAirByEffect, resFamiliarSwitches } from "./familiar";
import {
  LiverMode,
  allOrganEquipment,
  effectivelyOverDrunk,
  overage,
  ownedExtenders,
  requiredOrganEquipment,
  setLiverMode,
  liverMode,
} from "./organs";
import { PearlKey, PearlSpec, familiarWaterBreathingEquipment } from "./zones";

// ---------- valuation (garbo-lib preferred over raw mallPrice — user directive) ----------

let valueFunctions: ValueFunctions | undefined;
let valuationWarned = false;

export function garboValue(item: Item): number {
  try {
    valueFunctions ??= makeValue();
    return valueFunctions.value(item);
  } catch (e) {
    if (!valuationWarned) {
      print(`pearlo: garbo-lib valuation failed (${e}) — falling back to historical prices`, "red");
      valuationWarned = true;
    }
    return historicalPrice(item);
  }
}

let pearlValueCache: number | undefined;

export function pearlValue(): number {
  pearlValueCache ??= garboValue($item`unblemished pearl`);
  return pearlValueCache;
}

/** What we'd pay to obtain one: NPC price when the store sells it, else mall value. */
function acquisitionCost(item: Item): number {
  const npc = npcPrice(item);
  const mall = garboValue(item);
  return npc > 0 ? Math.min(npc, mall) : mall;
}

// ---------- restore economics (wiki-verified restore ranges, 2026-08-08) ----------

const TONIC_AVG_MP = 10; // Doc Galaktik's Invigorating Tonic restores 9-11 MP
const BALM_AVG_HP = 14; // Doc Galaktik's Restorative Balm heals 13-15 HP

function meatPerMp(): number {
  return npcPrice($item`Doc Galaktik's Invigorating Tonic`) / TONIC_AVG_MP;
}

function meatPerHp(): number {
  return npcPrice($item`Doc Galaktik's Restorative Balm`) / BALM_AVG_HP;
}

// ---------- progress / turns ----------

/** 1.7% × floor(res/3), min 1.7, cap 10 (docs/sea-reference.md §2). */
export function progressRatePct(res: number): number {
  return Math.max(1.7, Math.min(10, 1.7 * Math.floor(res / 3)));
}

// ---------- rough combat-cost model ----------

/**
 * Expected HP lost per monster action (wiki Monsters page, fetched 2026-08-08):
 * damage = max(0, Atk − Moxie) + 20-25% of Atk (we use the 22.5% midpoint; DR and DA
 * ignored — rough, slightly pessimistic); hit% ≈ clamp(55 + (Atk−Mox)×5.5, 0, 100)%
 * × 0.88 plus the flat 6% crit, clamped to [0.06, 0.94].
 */
function expectedHpLossPerRound(maxAtk: number): number {
  const moxie = myBuffedstat($stat`Moxie`);
  const damage = Math.max(0, maxAtk - moxie) + 0.225 * maxAtk;
  const base = (55 + (maxAtk - moxie) * 5.5) / 100;
  const hitChance = Math.min(0.94, Math.max(0.06, Math.min(1, Math.max(0, base)) * 0.88 + 0.06));
  return damage * hitChance;
}

/**
 * Monster actions we expect to be exposed to per fight. The Jurassic Parka staggers
 * round 1 in every combat; without it the 0.5 reflects init being a coin flip at best
 * under pressure penalties (ESTIMATE). Entangling Noodles buys ~3 stunned rounds in
 * sober multi-cast fights (docs/sea-reference.md §6).
 */
function roundsExposed(casts: number, wineglass: boolean): number {
  const stagger = have($item`Jurassic Parka`) ? 1 : 0.5;
  const stun = !wineglass && casts > 1 && have($skill`Entangling Noodles`) ? 3 : 0;
  return Math.max(0, casts - stagger - stun);
}

// Debuff sources per zone (docs/sea-reference.md §3): Majorly Poisoned in the Mine and
// Reef (anti-anti-antidote), The Colors... in the Reef (soft green echo eyedrop antidote).
const ZONE_CURES: Partial<Record<PearlKey, Item[]>> = {
  spooky: [$item`anti-anti-antidote`],
  stench: [$item`anti-anti-antidote`, $item`soft green echo eyedrop antidote`],
};

// ESTIMATE: debuff procs per exposed monster action — the wiki documents no rates.
const DEBUFF_PROC_PER_ROUND = 0.1;

function cureCostPerFight(spec: PearlSpec, exposedRounds: number): number {
  const cures = ZONE_CURES[spec.key] ?? [];
  return sum(cures, (cure) => acquisitionCost(cure)) * DEBUFF_PROC_PER_ROUND * exposedRounds;
}

// ---------- speculative resistance per configuration ----------

const RES_STEPS = [18, 15, 12, 9, 6, 3];

/**
 * Highest progress-relevant resistance floor this configuration can reach. Progress
 * only moves in steps of 3 res (floor(res/3)), so stepping down RES_STEPS is exact at
 * the granularity that matters. Speculative maximizes are local computation. The
 * familiar-switch directives mirror the real outfit's two-pass planning; the Stooper
 * configuration pins the familiar instead (its +1 liver only counts while active).
 */
function speculativeResFloor(spec: PearlSpec, forceEquip: Item[], familiar?: Familiar): number {
  const saved = myFamiliar();
  try {
    useFamiliar(familiar ?? $familiar.none);
    const breathing = playerAirByEffect() ? "" : ", adventure underwater";
    const equips = forceEquip.map((i) => `, +equip ${i}`).join("");
    const switches = familiar === undefined ? resFamiliarSwitches(spec) : "";
    const suffix = switches.length > 0 ? `, ${switches}` : "";
    for (const n of RES_STEPS) {
      if (maximize(`${spec.key} res ${n} max ${n} min${breathing}${equips}${suffix}`, true)) {
        return n;
      }
    }
    return 0;
  } finally {
    useFamiliar(saved);
  }
}

// ---------- per-zone economics ----------

export type ZoneEconomics = {
  key: PearlKey;
  mode: LiverMode;
  res: number;
  ratePct: number;
  fights: number;
  turns: number;
  pearlMeat: number;
  turnCost: number;
  mpCost: number;
  hpCost: number;
  cureCost: number;
  profit: number;
  go: boolean;
};

function evaluateZone(spec: PearlSpec, mode: LiverMode): ZoneEconomics {
  const wineglass = mode === "wineglass";
  const forced = args.major.overcapped ? allOrganEquipment(mode) : requiredOrganEquipment(mode);
  const equips = [...forced];
  if (wineglass) equips.push($item`Drunkula's wineglass`);
  const familiar = mode === "stooper" ? $familiar`Stooper` : undefined;

  const res = speculativeResFloor(spec, equips, familiar);
  const ratePct = progressRatePct(res);
  const fights = Math.ceil((100 - get(spec.progress, 0)) / ratePct);
  const turns = fights * (have($effect`Fishy`) ? 1 : 2);

  const plan = damagePlan(spec.maxHp);
  // Wineglass fights are one-shot-or-abort (pearls.ts prepare guard), so 1 cast.
  const casts = wineglass ? 1 : plan.casts;
  const exposed = roundsExposed(casts, wineglass);

  const pearlMeat = pearlValue();
  const turnCost = turns * args.major.voa;
  const mpCost = wineglass ? 0 : plan.mpPerFight * fights * meatPerMp();
  const hpCost = expectedHpLossPerRound(spec.maxAtk) * exposed * fights * meatPerHp();
  const cureCost = cureCostPerFight(spec, exposed) * fights;
  const profit = pearlMeat - turnCost - mpCost - hpCost - cureCost;

  return {
    key: spec.key,
    mode,
    res,
    ratePct,
    fights,
    turns,
    pearlMeat,
    turnCost,
    mpCost,
    hpCost,
    cureCost,
    profit,
    go: profit >= 0,
  };
}

// ---------- liver configuration chooser ----------

/**
 * Rescue modes that are actually reachable from current state. Stooper viability
 * requires the familiar plus underwater breathing for it (famequip gear or a
 * familiar-air effect); the wineglass requires the glass reachable in inventory.
 */
function candidateLiverModes(): LiverMode[] {
  if (overage("liver") === 0) return ["sober"];
  if (effectivelyOverDrunk()) return ["wineglass"];
  const candidates: LiverMode[] = [];
  const liverItems = ownedExtenders("liver", "items").length;
  if (liverItems >= overage("liver")) candidates.push("items");
  if (
    have($familiar`Stooper`) &&
    liverItems >= overage("liver") - 1 &&
    (familiarBreathesFree() || familiarWaterBreathingEquipment.some((i) => have(i)))
  ) {
    candidates.push("stooper");
  }
  if (wineglassAccessible()) candidates.push("wineglass");
  // Nothing viable: report wineglass — the existing wineglass guards will halt with
  // their own explanation rather than silently farming illegally.
  return candidates.length > 0 ? candidates : ["wineglass"];
}

/**
 * Pick the most profitable viable liver mode across the selected zones and lock it in
 * (setLiverMode). Organ state doesn't change mid-run — pearlo neither eats nor drinks —
 * so one choice at startup is sound.
 */
export function chooseLiverConfiguration(selected: PearlSpec[]): LiverMode {
  const candidates = candidateLiverModes();
  const best =
    candidates.length === 1
      ? candidates[0]
      : maxBy(candidates, (mode) => sum(selected, (spec) => evaluateZone(spec, mode).profit));
  setLiverMode(best);
  return best;
}

// ---------- verdicts + report ----------

const verdictCache = new Map<PearlKey, ZoneEconomics>();

/** Cached per-zone verdict under the chosen liver mode — cheap enough for ready(). */
export function zoneVerdict(spec: PearlSpec): ZoneEconomics {
  const cached = verdictCache.get(spec.key);
  if (cached !== undefined) return cached;
  const verdict = evaluateZone(spec, liverMode());
  verdictCache.set(spec.key, verdict);
  return verdict;
}

export function printProfitReport(selected: PearlSpec[]): void {
  const fmt = (n: number) => Math.round(n).toLocaleString();
  print(`pearlo profit (VOA ${fmt(args.major.voa)}, liver mode ${liverMode()}):`, "blue");
  print(` unblemished pearl value: ${fmt(pearlValue())} meat`);
  for (const spec of selected) {
    const v = zoneVerdict(spec);
    print(` --- ${spec.key} (${spec.loc}) ---`, "blue");
    print(
      `  res ${v.res} → ${v.ratePct}%/fight → ${v.fights} fights, ${v.turns} turns` +
        `${have($effect`Fishy`) ? " (Fishy)" : " (NO Fishy: 2 turns each)"}`,
    );
    print(
      `  costs: turns ${fmt(v.turnCost)} + MP ${fmt(v.mpCost)} + HP ${fmt(v.hpCost)} + cures ${fmt(v.cureCost)}`,
    );
    print(
      `  expected profit: ${fmt(v.profit)} meat — ${v.go ? "GO" : `SKIP${args.major.force ? " (overridden by force)" : ""}`}`,
      v.go ? "blue" : "red",
    );
  }
}
```

- [ ] **Step 3: Lint + build**

Run: `yarn lint && yarn build`
Expected: clean. Watch for: garbo-lib resolving through rollup (it is plain CJS/ESM JS — the existing `resolve`+`commonjs` plugins handle it); `maxBy`/`sum` import from libram.

- [ ] **Step 4: Commit**

```bash
git add src/economics.ts src/familiar.ts
git commit -m "feat: economics module — garbo-lib valuation, zone profit, liver-mode chooser"
```

---

### Task 5: mode plumbing — `combat.ts`, `mood.ts`, `outfit.ts`

**Files:**

- Modify: `src/combat.ts:14,156` (macro branch)
- Modify: `src/mood.ts:19,76` (buff selection)
- Modify: `src/outfit.ts` (extender equips, weapon-slot resolution, Stooper pin, breathing)

**Interfaces:**

- Consumes: `wineglassMode`, `liverMode`, `requiredOrganEquipment`, `allOrganEquipment` from Task 1; `args.major.overcapped` from Task 2.
- Produces: no new exports — behavioral change only. After this task the raw `isOverDrunk()` remains only in `src/lib.ts` (state predicate) and nowhere else.

- [ ] **Step 1: `src/combat.ts`**

Replace the import (line 14) `import { isOverDrunk } from "./lib";` with:

```ts
import { wineglassMode } from "./organs";
```

In `buildPearlMacro` (line 156) replace `if (isOverDrunk()) {` with:

```ts
  if (wineglassMode()) {
```

- [ ] **Step 2: `src/mood.ts`**

Import line 19 becomes:

```ts
import { tryAcquiringEffect } from "./lib";
import { wineglassMode } from "./organs";
```

Line 76 becomes:

```ts
    ...(wineglassMode() ? WEAPON_DAMAGE_EFFECTS : SPELL_DAMAGE_EFFECTS),
```

- [ ] **Step 3: `src/outfit.ts`**

Replace the import (line 18) `import { isOverDrunk } from "./lib";` with:

```ts
import { allOrganEquipment, liverMode, requiredOrganEquipment, wineglassMode } from "./organs";
```

Add `familiarWaterBreathingEquipment` to the `./zones` import (line 19):

```ts
import { PearlSpec, familiarWaterBreathingEquipment, waterBreathingEquipment } from "./zones";
```

Add `$familiar` to the libram import (line 3):

```ts
import { $familiar, $item, $items, $slot, have } from "libram";
```

In `buildPearlOutfit`, replace the body from `const overdrunk = isOverDrunk();` (line 61) through the wineglass else-branch (line 80) with:

```ts
const overdrunk = wineglassMode();

// Organ extenders first — they win their slots. Required extenders are the law
// (no adventuring without them); the overcapped flag forces the full set for
// consumption headroom. A forced corset simply occupies the shirt: the parka never
// equips and its mode is a harmless no-op; the maximizer chases res elsewhere.
const organEquip = args.major.overcapped ? allOrganEquipment() : requiredOrganEquipment();
const equip: Item[] = [...organEquip];

// Equip only as much lantern gear (any slot) as the one-shot actually needs —
// a lantern ≈ an extra cast, and we know the per-cast floor, so the need is
// computable (user design). Zero need = zero damage gear forced. Overdrunk:
// lanterns duplicate SPELL components and the wineglass kills spells — skip all.
let secondLantern: Item | undefined;
if (!overdrunk) {
  const needed = lanternComponentsNeededForOneShot(spec.maxHp);
  const lanterns = selectLanternGear(Number.isFinite(needed) ? needed : Infinity);
  equip.push(...lanterns.equip);
  secondLantern = lanterns.secondOffhand;
} else {
  // The wineglass IS the off-hand while overdrunk. A required angelbone totem
  // displaces the configured drunkweapon (best-effort attack combat, user decision);
  // otherwise the drunkweapon (default June cleaver) is forced when owned.
  equip.push($item`Drunkula's wineglass`);
  const totemForced = organEquip.includes($item`angelbone totem`);
  if (!totemForced && have(args.major.drunkweapon)) equip.push(args.major.drunkweapon);
}
```

The `weaponForced` line (currently line 101) must count the totem as a forced weapon too — replace it with:

```ts
const weaponForced =
  overdrunk && (organEquip.includes($item`angelbone totem`) || have(args.major.drunkweapon));
```

Replace the familiar-plan line (line 96, `const familiarPlan = pickPearlFamiliar(spec, secondLantern);`) with:

```ts
// Stooper rescue pins the familiar — its +1 liver only counts while active. It
// breathes via famequip gear unless a familiar-air effect already covers it.
const familiarPlan: FamiliarPlan =
  liverMode() === "stooper"
    ? {
        familiar: $familiar`Stooper`,
        famequip: familiarBreathesFree()
          ? undefined
          : familiarWaterBreathingEquipment.find((i) => have(i)),
      }
    : pickPearlFamiliar(spec, secondLantern);
```

In `breathingKeywords` (line 40), a forced breathing famequip must count as covering the familiar — replace the `familiarCovered` computation with:

```ts
const familiarCovered =
  familiarBreathesFree() ||
  (plan.familiar !== undefined && plan.familiar.underwater) ||
  (plan.famequip !== undefined && familiarWaterBreathingEquipment.includes(plan.famequip));
```

- [ ] **Step 4: Lint + build**

Run: `yarn lint && yarn build`
Expected: clean, and `grep -rn "isOverDrunk" src/` shows hits only in `src/lib.ts`, `src/pearls.ts`, `src/main.ts` (the last two fall in Task 6).

- [ ] **Step 5: Commit**

```bash
git add src/combat.ts src/mood.ts src/outfit.ts
git commit -m "feat: organ extenders and liver mode drive combat, mood, and outfit"
```

---

### Task 6: `pearls.ts` guards + `main.ts` startup, profit action, sim lines

**Files:**

- Modify: `src/pearls.ts:18,126,133` (ready/prepare guards)
- Modify: `src/main.ts` (startup sequencing, profit action, sim additions, unfixable halt)

**Interfaces:**

- Consumes: `chooseLiverConfiguration`, `zoneVerdict`, `printProfitReport` (Task 4); `canFixOvercap`, `effectivelyOverDrunk`, `organStatusReport`, `setLiverMode`, `wineglassMode` (Task 1); `args.major.force`, `args.profit` (Task 2).
- Produces: final behavior. No new exports.

- [ ] **Step 1: `src/pearls.ts`**

Import line 18 becomes:

```ts
import { zoneVerdict } from "./economics";
import { abortIfBeatenUp, asdonFualable, fuelUp } from "./lib";
import { wineglassMode } from "./organs";
```

The `ready` guard (lines 123-128) becomes:

```ts
    ready: () =>
      // Wineglass farming needs the glass reachable in inventory — closeted copies
      // satisfy have() but not the maximizer or dress.
      (!wineglassMode() || wineglassAccessible()) &&
      // Profit gate: zoneVerdict is cached after its first computation, so this stays
      // cheap for the engine's per-iteration ready() polling.
      (args.major.force || zoneVerdict(spec).go) &&
      canAdventure(spec.loc) &&
      myAdventures() - args.debug.halt >= turnsNeeded(spec),
```

In `prepare` (line 133), `if (isOverDrunk()) {` becomes:

```ts
      if (wineglassMode()) {
```

- [ ] **Step 2: `src/main.ts`**

Imports: remove `isOverDrunk` (line 15); add:

```ts
import { chooseLiverConfiguration, printProfitReport, zoneVerdict } from "./economics";
import {
  allOrganEquipment,
  canFixOvercap,
  organStatusReport,
  requiredOrganEquipment,
  setLiverMode,
  wineglassMode,
} from "./organs";
```

Add `abort` to the kolmafia import (line 2).

After `const selected = selectedPearls();` (line 30), insert the mode decision — `drunk` remains the "pretend wineglass" sim flag:

```ts
// Liver mode is chosen once — organ state doesn't change mid-run (pearlo neither
// eats nor drinks). The drunk flag short-circuits the chooser for what-if sims.
if (args.drunk) setLiverMode("wineglass");
else chooseLiverConfiguration(selected);

if (args.profit) {
  if (!canFixOvercap()) {
    print("pearlo: stomach/spleen overcapped beyond owned extenders — the run would halt.", "red");
  }
  printProfitReport(selected);
  return;
}
```

In the sim block, replace `const simDrunk = args.drunk || isOverDrunk();` (line 32) with:

```ts
const simDrunk = wineglassMode();
```

and after the `adventures available` line (line 36) add:

```ts
for (const line of organStatusReport()) print(line);
{
  const forced = args.major.overcapped ? allOrganEquipment() : requiredOrganEquipment();
  print(
    ` forced organ equipment${args.major.overcapped ? " (overcapped flag: full set)" : ""}: ${forced.length > 0 ? forced.join(", ") : "none"}`,
  );
}
if (!canFixOvercap()) {
  print(
    " stomach/spleen overcapped beyond owned extenders — the run would halt (mojo filter / organ cleaners / rollover).",
    "red",
  );
}
```

Before the engine construction (line 84-86, `const startTurns = ...`), insert the run-path gates:

```ts
if (!canFixOvercap()) {
  abort(
    "pearlo: stomach or spleen is overcapped beyond what owned extenders can fix — " +
      "adventuring is impossible (Food Coma / jaundiced). Use a mojo filter or organ " +
      "cleaners, or wait for rollover.",
  );
}
for (const spec of selected) {
  const verdict = zoneVerdict(spec);
  if (!verdict.go && !args.major.force) {
    print(
      `pearlo: skipping ${spec.key} (${spec.loc}) — expected profit ${Math.round(verdict.profit)} meat. Run with force to farm it anyway.`,
      "red",
    );
  }
}
```

- [ ] **Step 3: Lint + build + call-site sweep**

Run: `yarn lint && yarn build && grep -rn "isOverDrunk" src/`
Expected: lint and build clean; `isOverDrunk` appears **only** in `src/lib.ts` (definition). If any other file still references it, that's a missed call site — fix before committing.

- [ ] **Step 4: Commit**

```bash
git add src/pearls.ts src/main.ts
git commit -m "feat: profit-gated zone guards, liver-mode startup choice, profit action"
```

---

### Task 7: in-game verification (user-driven)

**Files:** none — gCLI runs by the user; fix whatever falls out.

- [ ] **Step 1: `yarn install-mafia`**, then in the gCLI: `pearlo profit` — sanity-check the pearl value, per-zone res floors, turn counts, cost magnitudes, and GO/SKIP verdicts against expectation.
- [ ] **Step 2: `pearlo sim`** — organ status lines correct (baselines exclude equipped extenders and Stooper); `pearlo sim drunk` still reports the wineglass plan.
- [ ] **Step 3:** live states as available: sober run unchanged; mildly overdrunk with dice/rosary owned → rescue mode chosen and extenders equipped; deeply overdrunk → wineglass unchanged; `overcapped` flag → full extender set worn.
- [ ] **Step 4:** commit any fixes that came out of verification.
