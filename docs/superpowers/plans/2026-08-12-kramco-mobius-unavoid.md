# Kramco + Möbius Ring Un-avoid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the Kramco Sausage-o-Matic™ and Möbius ring in pearl-zone outfits, and make pearlo survive the encounters they inject (sausage goblin, time cop, NC 1562).

**Architecture:** Three independent seams: (1) trim `GLOBAL_AVOID` in `src/outfit.ts`; (2) a wanderer-specific combat macro in `src/combat.ts` wired into the zone tasks' `CombatStrategy` in `src/pearls.ts`; (3) a new standalone choice script `src/choice.ts` (second rollup entry) registered via `choiceAdventureScript` in `PearloEngine.initPropertiesManager`, answering NC 1562 by option **text** (numbers rotate).

**Tech Stack:** TypeScript → rollup (Rhino target) → KoLmafia runtime; libram `Macro`, grimoire `CombatStrategy`. Spec: `docs/superpowers/specs/2026-08-12-kramco-mobius-unavoid-design.md`.

## Global Constraints

- No unit tests exist and none can run outside mafia — every task's verify gate is `yarn lint && yarn build` (lint validates all `$item`/`$skill`/`$monsters` names via eslint-plugin-libram).
- Template constants (`$item`…) must be hoisted to module level (lint-enforced).
- `kolmafia` stays `external` in rollup.
- Commit messages end with the standard Co-Authored-By/Claude-Session trailer used in this repo's history.
- Game facts in this plan are pre-verified (wiki + mafia monsters.txt + loopstar, 2026-08-12): monster names `sausage goblin` / `time cop`; skills `Micrometeorite`, `Entangling Noodles`, `Ambidextrous Funkslinging`; items `train whistle`, `HOA citation pad`; choice 1562 skip text `I'm not messing with the timeline!`.

---

### Task 1: Un-avoid Kramco and Möbius ring

**Files:**
- Modify: `src/outfit.ts:22-27` (the `GLOBAL_AVOID` comment + constant)

**Interfaces:**
- Consumes: nothing.
- Produces: no API change — `GLOBAL_AVOID` keeps its name and type (`Item[]`), smaller contents.

- [ ] **Step 1: Edit the constant**

Replace:

```ts
// Never let the maximizer equip these in pearl zones (user directives):
// - broken champagne bottle: its +item drains limited daily charges (2026-08-07)
// - Kramco Sausage-o-Matic™ (and replica): sausage goblin wanderers replace zone
//   adventures — turns without pearl progress (2026-08-08)
// - Möbius ring: interferes with zone adventuring (2026-08-08)
const GLOBAL_AVOID = $items`broken champagne bottle, Kramco Sausage-o-Matic™, replica Kramco Sausage-o-Matic™, Möbius ring`;
```

with:

```ts
// Never let the maximizer equip these in pearl zones (user directives):
// - broken champagne bottle: its +item drains limited daily charges (2026-08-07)
// (Kramco and Möbius ring were un-banned 2026-08-12 — their wanderers/NC are now
// handled by the wanderer macro in combat.ts and the pearlo-choice script.)
const GLOBAL_AVOID = $items`broken champagne bottle`;
```

- [ ] **Step 2: Verify**

Run: `yarn lint && yarn build`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/outfit.ts
git commit -m "feat: allow Kramco and Möbius ring in pearl-zone outfits"
```

---

### Task 2: Wanderer survival macro

**Files:**
- Modify: `src/combat.ts` (imports + new exports after `buildPearlMacro`, which ends at line 171)
- Modify: `src/pearls.ts` (import at line 20; `combat:` at line 266)

**Interfaces:**
- Consumes: `wineglassMode()` from `./organs` (already imported in combat.ts).
- Produces: `WANDERER_MONSTERS: Monster[]` and `buildWandererMacro(): Macro`, both exported from `src/combat.ts`.

- [ ] **Step 1: Add the macro builder to `src/combat.ts`**

Change the libram import at line 12 to include `$monsters`:

```ts
import { $item, $monsters, $skill, $slot, $stat, Macro, get, have } from "libram";
```

Append after `buildPearlMacro` (after line 171):

```ts
// Wanderers injected by un-banned equipment (Kramco → sausage goblin, Möbius ring →
// time cop). Both scale off our stats, so the zone's tuned one-shot plan doesn't
// apply — layer stagger-deleveling, then stun, then geyser (spec 2026-08-12):
// Micrometeorite −25% + stagger; train whistle −25% Atk/Def + stagger; HOA citation
// pad −30% + 100% stagger vs dudes (time cop; undocumented vs the goblin, but the
// funkslung pair costs no extra round). Goblin never acts first (init -10000); the
// time cop's init 250 is covered by the parka's automatic round-1 stagger.
export const WANDERER_MONSTERS = $monsters`sausage goblin, time cop`;

export function buildWandererMacro(): Macro {
  if (wineglassMode()) {
    return new Macro().attack().repeat();
  }
  const macro = new Macro().trySkill($skill`Micrometeorite`);
  if (have($skill`Ambidextrous Funkslinging`)) {
    macro.tryFunkslingItem($item`train whistle`, $item`HOA citation pad`);
  } else {
    macro.tryItem($item`train whistle`).tryItem($item`HOA citation pad`);
  }
  return macro.trySkill($skill`Entangling Noodles`).skill($skill`Saucegeyser`).repeat();
}
```

- [ ] **Step 2: Wire it into the zone tasks in `src/pearls.ts`**

Extend the import at line 20:

```ts
import {
  buildPearlMacro,
  buildWandererMacro,
  damagePlan,
  WANDERER_MONSTERS,
  weaponAttackPlan,
  wineglassAccessible,
} from "./combat";
```

Change line 266 from:

```ts
    combat: new CombatStrategy().macro(() => buildPearlMacro(spec, plan)),
```

to:

```ts
    combat: new CombatStrategy()
      .macro(() => buildWandererMacro(), WANDERER_MONSTERS)
      .macro(() => buildPearlMacro(spec, plan)),
```

(Grimoire compiles monster-specific macros ahead of general ones, so the wanderer
branch wins for those two monsters and every zone monster keeps the tuned plan.)

- [ ] **Step 3: Verify**

Run: `yarn lint && yarn build`
Expected: both pass — lint proves every `$`-template name resolves.

- [ ] **Step 4: Commit**

```bash
git add src/combat.ts src/pearls.ts
git commit -m "feat: delevel-stagger survival macro for sausage goblin and time cop"
```

---

### Task 3: NC 1562 choice script

**Files:**
- Create: `src/choice.ts`
- Modify: `rollup.config.ts` (the `export default` array, last lines of the file)
- Modify: `src/engine.ts:48-55` (`manager.set({...})` in `initPropertiesManager`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `dist/scripts/pearlo/pearlo-choice.js`, exporting mafia's choice-script hook `main(choice: number, page: string): void`; registered under the `choiceAdventureScript` property (bare filename — mafia resolves it recursively under scripts/, same as loopstar's `loopstar_choice.js`).

- [ ] **Step 1: Create `src/choice.ts`**

```ts
import { availableChoiceOptions, print, runChoice } from "kolmafia";

// NC 1562 "Time is a Möbius Strip" (Möbius ring, fires only while worn): option
// numbers rotate between visits, so match by button text (loopstar's approach).
// Always skip — free, no turn, no Paradoxicity drift (user decision, 2026-08-12).
const MOBIUS_STRIP_CHOICE = 1562;
const SKIP_TEXT = "I'm not messing with the timeline!";

export function main(choice: number, page: string): void {
  void page;
  if (choice !== MOBIUS_STRIP_CHOICE) return;
  const options = availableChoiceOptions();
  for (const [num, text] of Object.entries(options)) {
    if (text === SKIP_TEXT) {
      runChoice(Number(num));
      return;
    }
  }
  // Leave it unhandled so mafia's abort surfaces the problem rather than
  // silently gambling with the timeline (spec: error handling).
  print(`pearlo-choice: choice 1562 has no "${SKIP_TEXT}" option — not answering it.`, "red");
}
```

- [ ] **Step 2: Add the rollup entry**

In `rollup.config.ts`, change:

```ts
export default [{ pearlo: "src/main.ts" }].map((input) => ({
  input,
  ...baseSettings,
}));
```

to:

```ts
export default [{ pearlo: "src/main.ts" }, { "pearlo-choice": "src/choice.ts" }].map((input) => ({
  input,
  ...baseSettings,
}));
```

- [ ] **Step 3: Register it in `PearloEngine.initPropertiesManager`**

In `src/engine.ts`, add one property to the existing `manager.set({...})` call:

```ts
    manager.set({
      autoSatisfyWithCloset: false,
      hpAutoRecovery: -0.05,
      mpAutoRecovery: -0.05,
      maximizerCombinationLimit: 0,
      hpAutoRecoveryItems: hpItems,
      mpAutoRecoveryItems: mpItems,
      // NC 1562 (Möbius ring) has rotating option numbers — answered by text in the
      // bundled pearlo-choice script. Restored by destruct() like every setting here.
      choiceAdventureScript: "pearlo-choice.js",
    });
```

- [ ] **Step 4: Verify both bundles build**

Run: `yarn lint && yarn build && ls dist/scripts/pearlo/`
Expected: lint/build pass; listing shows `pearlo.js` (or the existing main bundle name) **and** `pearlo-choice.js`.

- [ ] **Step 5: Commit**

```bash
git add src/choice.ts rollup.config.ts src/engine.ts
git commit -m "feat: pearlo-choice script skips the Möbius Strip NC by option text"
```

---

### Task 4: Document the new delevel tools in sea-reference

**Files:**
- Modify: `docs/sea-reference.md` (the "Sources worth pearlo's attention" table, rows around line 521)

**Interfaces:** none (docs only).

- [ ] **Step 1: Add two table rows**

Insert directly below the existing `Micrometeorite (Meteor Lore)` row:

```markdown
| train whistle (Crimbo 2022)                                      | −25% both, first use per combat                               | also staggers; combat item, funkslings with the HOA pad                              |
| HOA citation pad (Dreadsylvania)                                 | −30% both                                                     | 100% stagger but **only vs dude/hippy/orc** (time cop yes, goblin unverified); 2nd use same combat is a free twiddle |
```

- [ ] **Step 2: Verify + commit**

Run: `yarn lint` (prettier checks markdown formatting).
Expected: pass.

```bash
git add docs/sea-reference.md
git commit -m "docs: train whistle + HOA citation pad in the delevel table"
```

---

## Final verification (after all tasks)

- `yarn lint && yarn build` clean.
- `git log --oneline -4` shows the four commits above.
- Live check (user, next session): with the ring/Kramco in a saved zone outfit, the session log should show a goblin/time-cop fight resolving Micrometeorite → funksling → Noodles → Saucegeyser, and NC 1562 logging the skip via pearlo-choice.
