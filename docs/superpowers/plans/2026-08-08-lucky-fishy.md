# Lucky!-based Fishy Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Fishy is about to run out, acquire the Lucky! intrinsic (configurable cost cascade) and adventure in The Brinier Deepers, where the lucky noncombat "The Haggling" grants 20 more turns of Fishy — halving underwater turn costs all day.

**Architecture:** A new leaf-ish module `src/fishy.ts` owns the Lucky! acquisition cascade and refresh-cost estimates (imports only `args` and `zones` — no cycles). `src/pearls.ts` gains a "Get Fishy" task placed between "Breathe Underwater" and the zone tasks (grimoire list position = priority). `src/economics.ts` replaces its flat Fishy-fights number with a `FishyBudget` (base fights + priced refreshes) threaded across zones. `src/main.ts` reports source availability in `sim`.

**Tech Stack:** TypeScript → rollup → KoLmafia Rhino runtime; `kolmafia` ambient typings, `libram` (incl. `AugustScepter` resource module), `grimoire-kolmafia` Task engine.

**Spec:** `docs/superpowers/specs/2026-08-08-lucky-fishy-design.md`

## Global Constraints

- No unit tests exist and none are possible (every `kolmafia` stub throws outside mafia). Verification per task = `yarn lint` && `yarn build`, both must pass clean.
- `kolmafia` must remain `external` in rollup — don't touch rollup config.
- `$item`/`$effect`/`$skill` template constants must be hoisted to module level (lint-enforced by eslint-plugin-libram).
- Never hard-code organ capacities; never invent game names — every name below is already verified (wiki + libram sources, 2026-08-08).
- `ready()`/`completed()` run every engine iteration — no `mallPrice`/`visitUrl` in them; `historicalPrice` is the cheap allowed alternative.
- Commit messages end with the project's Co-Authored-By/Claude-Session trailer (see session config).

## Verified game facts used below (do not re-derive)

- **The Haggling** (The Brinier Deepers, lucky NC): grants Fishy (20 turns), no choice adventure, costs 2 adventures without Fishy / 1 with.
- **Lucky!** is an intrinsic: consumed by the next lucky-capable zone adventured in (Dive Bar and Madness Reef have their own lucky NCs — a stray Lucky! there wastes a pearl turn).
- **Aug. 2nd: Find an Eleven-Leaf Clover Day** — august scepter skill, 0 MP, grants Lucky! directly. Exact libram skill name (no trailing `!`): `$skill`Aug. 2nd: Find an Eleven-Leaf Clover Day``. Gate via `AugustScepter.have() && AugustScepter.canCast(2)` (libram handles the 5-shared-casts/day and once-each rules).
- **Pill keeper**: `cliExecute("pillkeeper free lucky")` takes "Sunday - Surprise Me" → Lucky! (mafia `PillKeeperCommand.java`, keyword `luc`, choice 7; `free` makes it error rather than spend spleen). Gate: `have($item`Eight Days a Week Pill Keeper`) && !get("_freePillKeeperUsed")`.
- **Hermit**: sells 11-leaf clover, **limit 3/day**, tracked in `_cloversPurchased` (numeric pref). `hermit($item`11-leaf clover`, 1)` auto-retrieves the hermit permit AND worthless items (mafia buys chewing gum on a string, 50 meat NPC, as needed) — verified in mafia `HermitRequest.java`.
- **libram exports**: `import { AugustScepter } from "libram"` works (re-exported from resources index).

---

### Task 1: `resources` args + `src/fishy.ts` acquisition module

**Files:**
- Modify: `src/args.ts` (the empty `resources: Args.group("Resource Usage", {})` at line ~96)
- Create: `src/fishy.ts`

**Interfaces:**
- Consumes: `args` from `./args`, `PearlSpec` from `./zones`.
- Produces (used by Tasks 2–4):
  - `HAGGLING_FISHY_TURNS: number` (= 20)
  - `remainingPearlFights(selected: PearlSpec[]): number`
  - `luckySourceAvailable(remainingFights: number): boolean` — cheap, ready()-safe
  - `acquireLucky(remainingFights: number): boolean` — side effects, true iff Lucky! is up after
  - `luckyRefreshCosts(maxCount: number): number[]` — estimated meat cost per available refresh, cascade order
  - `luckySourceReport(): string[]` — sim output lines

- [ ] **Step 1: Add the two args to the Resource Usage group in `src/args.ts`**

Replace `resources: Args.group("Resource Usage", {}),` with:

```ts
    resources: Args.group("Resource Usage", {
      luckyfishy: Args.flag({
        help: "Refresh Fishy via Lucky! + The Haggling in The Brinier Deepers when it runs out (Aug. 2nd scepter, owned clovers, free pill keeper, hermit; see cloverprice for mall). Disable to save those daily resources for other scripts.",
        default: true,
      }),
      cloverprice: Args.number({
        help: "Max meat to pay per mall 11-leaf clover for the Fishy refresh. 0 (default) never buys from the mall — free/owned sources only.",
        default: 0,
      }),
    }),
```

- [ ] **Step 2: Create `src/fishy.ts`**

```ts
import {
  buy,
  cliExecute,
  hermit,
  historicalPrice,
  itemAmount,
  mallPrice,
  npcPrice,
  print,
  use,
  useSkill,
} from "kolmafia";
import { $effect, $item, $skill, AugustScepter, get, have, sum } from "libram";

import { args } from "./args";
import { PearlSpec } from "./zones";

// Lucky!-based Fishy refresh (docs/superpowers/specs/2026-08-08-lucky-fishy-design.md).
// The Haggling — The Brinier Deepers' lucky noncombat (wiki-verified 2026-08-08) —
// grants 20 turns of Fishy. Lucky! is an intrinsic, consumed by the next lucky-capable
// zone visited, so acquisition and the Brinier Deepers trip must happen back-to-back
// (the Dive Bar and Madness Reef would eat it with their own lucky NCs).

export const HAGGLING_FISHY_TURNS = 20;

const CLOVER = $item`11-leaf clover`;
const AUG_2 = $skill`Aug. 2nd: Find an Eleven-Leaf Clover Day`;
const HERMIT_CLOVER_LIMIT = 3; // wiki The Hermitage: "(Limit 3 per day)", pref _cloversPurchased

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

/** Would a mall clover pay for itself? min(20, remaining fights) turns saved vs price. */
function mallWorthIt(remainingFights: number, price: number): boolean {
  return Math.min(HAGGLING_FISHY_TURNS, remainingFights) * args.major.voa >= price;
}

// Cascade order fixed by user decision (2026-08-08): scepter first, then free-first.
const LUCKY_SOURCES: LuckySource[] = [
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
    available: () =>
      have($item`Eight Days a Week Pill Keeper`) && !get("_freePillKeeperUsed"),
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
    `  Aug. 2nd scepter: ${scepter}`,
    `  11-leaf clovers in inventory: ${itemAmount(CLOVER)}`,
    `  pill keeper: ${pillkeeper}`,
    `  hermit clovers left today: ${Math.max(0, HERMIT_CLOVER_LIMIT - get("_cloversPurchased"))}`,
    `  mall clovers: ${mall}`,
  ];
}
```

- [ ] **Step 3: Verify**

Run: `yarn lint && yarn build`
Expected: both pass. Lint will catch any `$item`/`$skill` name typo at this step (template tags throw on unknown names) — if a name fails, STOP and re-check against `node_modules/kolmafia/index.d.ts`, do not improvise.

- [ ] **Step 4: Commit**

```bash
git add src/args.ts src/fishy.ts
git commit -m "feat: Lucky! acquisition cascade + luckyfishy/cloverprice args"
```

---

### Task 2: "Get Fishy" task + narrowed Lucky warning

**Files:**
- Modify: `src/pearls.ts` (imports, new task factory, `pearlTasks`)
- Modify: `src/mood.ts` (the Lucky! warning block at lines ~104–112)

**Interfaces:**
- Consumes: `acquireLucky`, `luckySourceAvailable`, `remainingPearlFights` from `./fishy` (Task 1); `pickUtilityFamiliar`, `playerAirByEffect` from `./familiar`; `canBreathUnderwater` from `./zones`.
- Produces: `pearlTasks(selected)` now returns `[breatheUnderwaterTask, getFishyTask(selected), ...zones]` — no signature change, callers unaffected.

- [ ] **Step 1: Add the task to `src/pearls.ts`**

Add imports: `haveEffect`, `abort` is already imported; from `kolmafia` add `haveEffect`; from `libram` add `$effect` is already there — add `$familiar`, `$location`, `Macro`; add `OutfitSpec` to the grimoire import; new project imports:

```ts
import { acquireLucky, luckySourceAvailable, remainingPearlFights } from "./fishy";
import { pickUtilityFamiliar, playerAirByEffect } from "./familiar";
```

Add the task factory after `breatheUnderwaterTask`:

```ts
/**
 * Fishy refresh (docs/superpowers/specs/2026-08-08-lucky-fishy-design.md): when Fishy
 * is down to ≤1 turn, acquire Lucky! and adventure in The Brinier Deepers — its lucky
 * NC "The Haggling" grants 20 turns of Fishy. Placed before the zone tasks: list
 * position is grimoire priority, so this preempts zones whenever Fishy runs low. NOT
 * in any zone's `after` — with no Lucky! source left this task simply never readies
 * and zones fall back to 2-turn fights.
 */
function getFishyTask(selected: PearlSpec[]): Task {
  return {
    name: "Get Fishy",
    after: ["Breathe Underwater"],
    // >1 (not >0): with exactly 1 turn left the trip itself still rides the old
    // Fishy turn (The Haggling costs 1 adventure with Fishy, 2 without).
    completed: () => haveEffect($effect`Fishy`) > 1,
    ready: () =>
      args.resources.luckyfishy &&
      canBreathUnderwater() &&
      // The free fishy pipe is strictly cheaper (no turn, no Lucky!) — let
      // pearlMood spend it first; this task covers the post-pipe day.
      !(have($item`fishy pipe`) && !get("_fishyPipeUsed")) &&
      remainingPearlFights(selected) > 0 &&
      (have($effect`Lucky!`) || luckySourceAvailable(remainingPearlFights(selected))) &&
      myAdventures() - args.debug.halt >= (haveEffect($effect`Fishy`) > 0 ? 1 : 2),
    prepare: () => {
      if (!acquireLucky(remainingPearlFights(selected))) {
        abort(
          "pearlo: could not acquire Lucky! for the Fishy refresh — every source in " +
            "the cascade failed. The Brinier Deepers is not safe without it.",
        );
      }
    },
    do: $location`The Brinier Deepers`,
    outfit: (): OutfitSpec => {
      // Noncombat trip: only breathing matters. pickUtilityFamiliar guarantees a
      // familiar that can breathe (or none); the maximizer patches player breathing
      // only when no effect already covers it.
      const plan = pickUtilityFamiliar();
      const spec: OutfitSpec = { familiar: plan.familiar ?? $familiar.none };
      if (plan.famequip !== undefined) spec.famequip = plan.famequip;
      if (!playerAirByEffect()) spec.modifier = "adventure underwater";
      return spec;
    },
    // With Lucky! up the encounter is guaranteed to be The Haggling; a combat means
    // the plan is broken (out-of-plan monsters here) — fail loudly.
    combat: new CombatStrategy().macro(Macro.abort()),
    limit: { soft: 10 }, // realistic ceiling ~6 refreshes/day
  };
}
```

Update the factory:

```ts
export function pearlTasks(selected: PearlSpec[]): Task[] {
  return [breatheUnderwaterTask, getFishyTask(selected), ...selected.map(pearlTask)];
}
```

- [ ] **Step 2: Narrow the Lucky! warning in `src/mood.ts`**

Add `import { args } from "./args";` and `haveEffect` to the kolmafia import. Replace the warning block:

```ts
  // Lucky! converts the next adventure in Lucky-capable zones (Dive Bar: Razor,
  // Scooter; Reef: Dragon the Line) into a noncombat — a turn with no pearl progress
  // (cost us a turn in the 2026-08-07 session). With the luckyfishy refresh enabled
  // and Fishy low, the Get Fishy task consumes it productively before we get here;
  // otherwise it is still a live hazard worth flagging.
  if (
    have($effect`Lucky!`) &&
    (haveEffect($effect`Fishy`) > 1 || !args.resources.luckyfishy)
  ) {
    print(
      `pearlo: Lucky! is active — the next ${spec.loc} adventure may be its Lucky noncombat instead of a pearl fight. Consider spending Lucky elsewhere first.`,
      "red",
    );
  }
```

- [ ] **Step 3: Verify**

Run: `yarn lint && yarn build`
Expected: both pass. Check for import cycles: `fishy.ts` imports only `args`/`zones`; `pearls.ts → fishy.ts` and `mood.ts → args.ts` introduce none.

- [ ] **Step 4: Commit**

```bash
git add src/pearls.ts src/mood.ts
git commit -m "feat: Get Fishy task — Lucky!-driven Fishy refresh via The Haggling"
```

---

### Task 3: economics — FishyBudget with priced refreshes

**Files:**
- Modify: `src/economics.ts` (fishyFightsAvailable → fishyBudget; evaluateZone; scoreLiverMode; zoneVerdict; primeZoneVerdicts; ZoneEconomics; printProfitReport)

**Interfaces:**
- Consumes: `luckyRefreshCosts`, `HAGGLING_FISHY_TURNS` from `./fishy` (Task 1).
- Produces: `fishyBudget(): FishyBudget` replaces the exported `fishyFightsAvailable()` (only economics-internal callers exist — verified by grep; no other module imports it). `ZoneEconomics` gains `refreshesUsed: number` and `refreshCost: number`.

- [ ] **Step 1: Replace the budget primitive**

Replace `fishyFightsAvailable` (lines ~90–96) with:

```ts
/** Fights coverable by Fishy sources already on hand — active turns + unused pipe. */
function baseFishyFights(): number {
  return (
    haveEffect($effect`Fishy`) +
    (have($item`fishy pipe`) && !get("_fishyPipeUsed") ? FISHY_PIPE_TURNS : 0)
  );
}

// Most refreshes the model plans with: all five zones cost ≤ ~50 capped fights,
// and each refresh nets 19 (see below) — 6 leaves slack for uncapped-rate days.
const MAX_MODEL_REFRESHES = 6;

/**
 * The threaded Fishy budget: fights already covered, plus the Lucky!-refresh cascade
 * as a queue of estimated meat costs (cascade order — free sources first). evaluateZone
 * consumes it mutably as zones claim fights.
 */
export type FishyBudget = { fights: number; refreshCosts: number[] };

export function fishyBudget(): FishyBudget {
  return { fights: baseFishyFights(), refreshCosts: luckyRefreshCosts(MAX_MODEL_REFRESHES) };
}
```

Add the import: `import { HAGGLING_FISHY_TURNS, luckyRefreshCosts } from "./fishy";`

- [ ] **Step 2: Teach `evaluateZone` to consume the budget**

Change the signature to `function evaluateZone(spec: PearlSpec, mode: LiverMode, budget: FishyBudget): ZoneEconomics` and replace the two lines

```ts
  const fishyUsed = Math.min(fights, fishyFights);
  const turns = fights * 2 - fishyUsed;
```

with:

```ts
  // Spend the threaded budget on this zone's fights, topping it up with Lucky!
  // refreshes while each pays for itself. ESTIMATE: a refresh is modeled as +19
  // fishy fights and +1 trip turn — the Get Fishy task triggers at ≤1 Fishy turn
  // remaining, so the trip rides the old block's last turn (The Haggling grants
  // HAGGLING_FISHY_TURNS = 20; one goes to the next trip at steady state).
  let pool = budget.fights;
  let refreshesUsed = 0;
  let refreshCost = 0;
  let fishyUsed = Math.min(fights, pool);
  while (fishyUsed < fights && budget.refreshCosts.length > 0) {
    const meat = budget.refreshCosts[0];
    const coverable = Math.min(HAGGLING_FISHY_TURNS - 1, fights - fishyUsed);
    // Each covered fight saves one turn; the trip costs one — net (coverable-1) turns.
    if ((coverable - 1) * args.major.voa < meat) break;
    budget.refreshCosts.shift();
    refreshesUsed += 1;
    refreshCost += meat;
    pool += HAGGLING_FISHY_TURNS - 1;
    fishyUsed = Math.min(fights, pool);
  }
  budget.fights = pool - fishyUsed; // leftover Fishy turns carry to the next zone
  const turns = fights * 2 - fishyUsed + refreshesUsed;
```

Add `refreshesUsed` and `refreshCost` to the `ZoneEconomics` type and the returned object, and subtract the meat in the profit line:

```ts
  const profit = pearlMeat - turnCost - mpCost - hpCost - cureCost - refreshCost;
```

- [ ] **Step 3: Update the three callers**

`scoreLiverMode` — evaluateZone now mutates the budget, so drop the manual subtraction:

```ts
function scoreLiverMode(selected: PearlSpec[], mode: LiverMode): number {
  const budget = fishyBudget();
  let total = 0;
  for (const spec of selected) {
    total += evaluateZone(spec, mode, budget).profit;
  }
  return total;
}
```

`primeZoneVerdicts` — same treatment:

```ts
export function primeZoneVerdicts(selected: PearlSpec[]): void {
  verdictCache.clear();
  const mode = liverMode();
  const budget = fishyBudget();
  for (const spec of selected) {
    verdictCache.set(spec.key, evaluateZone(spec, mode, budget));
  }
}
```

`zoneVerdict` cold-cache fallback: `const verdict = evaluateZone(spec, liverMode(), fishyBudget());`

- [ ] **Step 4: Report refreshes in `printProfitReport`**

Replace the fights/turns print with:

```ts
    print(
      `  res ${v.res} → ${v.ratePct}%/fight → ${v.fights} fights, ${v.turns} turns` +
        ` (Fishy covers ${v.fishyUsed} of ${v.fights} fights` +
        (v.refreshesUsed > 0
          ? `, incl. ${v.refreshesUsed} Lucky! refresh trip(s) costing ${fmt(v.refreshCost)} meat`
          : "") +
        `)`,
    );
```

- [ ] **Step 5: Verify**

Run: `yarn lint && yarn build`
Expected: both pass; `fishyFightsAvailable` no longer exists anywhere (grep to confirm no stale reference).

- [ ] **Step 6: Commit**

```bash
git add src/economics.ts
git commit -m "feat: profit model prices Lucky!-refresh Fishy budget across zones"
```

---

### Task 4: sim report + docs

**Files:**
- Modify: `src/main.ts` (sim block, line ~88 after "can breathe underwater")
- Modify: `README.md` (Useful options list + new section after "Per-zone overrides")
- Modify: `CLAUDE.md` (Source layout list)

**Interfaces:**
- Consumes: `luckySourceReport` from `./fishy` (Task 1).

- [ ] **Step 1: Add the sim lines in `src/main.ts`**

Import `luckySourceReport` from `./fishy`. In the `args.sim` block, directly after the `print(` can breathe underwater: ...`)` line, add:

```ts
    for (const line of luckySourceReport()) print(line);
```

- [ ] **Step 2: README**

In "Useful options", after the `overcapped` bullet, add:

```markdown
- `luckyfishy=false` — disable the Lucky!-based Fishy refresh (on by default; uses the
  Aug. 2nd scepter cast, owned 11-leaf clovers, the free pill keeper use, and up to 3
  hermit clovers per day)
- `cloverprice=N` — also buy mall 11-leaf clovers for the refresh, at most N meat each
  (default 0 = never; purchases are skipped when the remaining farming can't repay them)
```

After the "Per-zone overrides" section, add:

```markdown
## Fishy refreshes

Underwater turns cost 2 adventures without Fishy and 1 with it. Beyond the free fishy
pipe, pearlo refreshes Fishy whenever it runs out: it grabs the Lucky! intrinsic
(Aug. 2nd scepter → owned 11-leaf clovers → free pill keeper "Surprise Me" → hermit
clovers → mall clovers under `cloverprice`) and spends one adventure in The Brinier
Deepers, where the lucky noncombat The Haggling grants 20 more turns of Fishy. The
profit model prices these trips (clover cost + trip turn) into its GO/SKIP verdicts,
and `sim` reports which Lucky! sources are available today.
```

- [ ] **Step 3: CLAUDE.md source layout**

In the "Source layout" list, after the `src/combat.ts` entry, add:

```markdown
- `src/fishy.ts` — Lucky!-based Fishy refresh: acquisition cascade (Aug. 2nd scepter →
  owned clovers → free pill keeper → hermit → mall under `cloverprice`), refresh-cost
  estimates for economics, sim report lines; The Haggling (Brinier Deepers lucky NC)
  grants 20 Fishy turns
```

- [ ] **Step 4: Verify**

Run: `yarn lint && yarn build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts README.md CLAUDE.md
git commit -m "docs: sim report + README/CLAUDE.md for the Lucky! Fishy refresh"
```

---

## Final verification (after all tasks)

- [ ] `yarn lint && yarn build` clean from scratch.
- [ ] `grep -rn "fishyFightsAvailable" src/` returns nothing.
- [ ] Manual in-game checks (user-run, outside this plan): `pearlo sim` shows the lucky
      source lines; `pearlo profit` shows refresh trips priced into a zone when Fishy
      is short; a live run crossing a Fishy boundary performs the Brinier Deepers trip
      and returns to zone farming with ~20 Fishy turns.
