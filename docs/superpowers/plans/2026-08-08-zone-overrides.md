# Per-Zone Familiar and Outfit Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ten pref-backed args let the user pin a familiar and/or a saved KoL custom outfit per pearl zone, layered under pearlo's mandatory safety nets and priced honestly by the profit model.

**Architecture:** New "Zone Overrides" args group + two typed helpers in `src/args.ts`; `buildPearlOutfit` grows a familiar-precedence chain (Stooper pin → override → computed) and an outfit-override result path (forced `outfitPieces`, breathing-only modifier); `evaluateZone` pins the override familiar and forces the outfit pieces in speculation; `main` validates outfit names at startup and prints override lines in sim; the profit report prints them too.

**Tech Stack:** TypeScript → rollup → KoLmafia Rhino runtime; `kolmafia` ambient (`haveOutfit`, `outfitPieces`, `getOutfits` — verified in index.d.ts), `libram`, `grimoire-kolmafia` (`Args.familiar`, `OutfitSpec`).

**Spec:** `docs/superpowers/specs/2026-08-08-zone-overrides-design.md` — read it first.

## Global Constraints

- **No unit tests exist and none can run** (kolmafia stubs throw outside the game). The test cycle for every task is `yarn lint` clean + `yarn build` clean; run `yarn format` first when lint flags style.
- `$item`/`$familiar` template constants hoisted to module level (eslint-plugin-libram).
- Safety nets are never bypassed by overrides: required organ extenders, wineglass/drunkweapon in wineglass mode, breathing keywords, `requirecap`, avoid lists.
- Stooper precedence: when the chosen liver mode is `stooper`, the Stooper pin displaces a per-zone familiar override, with a printed one-line notice (once per zone per session).
- Commit after every task with a `feat:` message ending in the standard co-author trailer.

---

### Task 1: args — Zone Overrides group + helpers

**Files:**

- Modify: `src/args.ts`

**Interfaces:**

- Consumes: existing `Args.create` structure; `PearlKey` from `./zones` (already imported).
- Produces (used by Tasks 2–4): `familiarOverride(key: PearlKey): Familiar | undefined`, `outfitOverride(key: PearlKey): string | undefined`, and `args.overrides.<key>familiar` / `args.overrides.<key>outfit` for all five keys.

- [ ] **Step 1: Add the group and helpers**

In `src/args.ts`, add `Familiar` to the kolmafia import (line 2):

```ts
import { abort, Familiar, Item } from "kolmafia";
```

Insert a new group between `major` and `minor` (after the `major` group's closing `}),` at line 62):

```ts
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
```

Append the helpers after `selectedPearls()` (end of file):

```ts
/** The user's forced familiar for this zone, if any (Zone Overrides group). */
export function familiarOverride(key: PearlKey): Familiar | undefined {
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
```

- [ ] **Step 2: Lint + build**

Run: `yarn lint && yarn build`
Expected: both clean. (`Args.familiar` with no default yields `Familiar | undefined`; `Args.string` with no default yields `string | undefined`.)

- [ ] **Step 3: Commit**

```bash
git add src/args.ts
git commit -m "feat: Zone Overrides args — per-zone familiar and saved-outfit overrides"
```

---

### Task 2: outfit.ts — precedence chain + outfit-override path

**Files:**

- Modify: `src/outfit.ts`

**Interfaces:**

- Consumes: `familiarOverride`, `outfitOverride` from `./args` (Task 1); everything `buildPearlOutfit` already uses.
- Produces: no new exports — `buildPearlOutfit(spec)` behavior only.

- [ ] **Step 1: Rewrite `buildPearlOutfit`**

Add `abort`, `outfitPieces`, `print` to the kolmafia import (line 2):

```ts
import { Item, abort, canEquip, outfitPieces, print, toSlot } from "kolmafia";
```

Add the helpers to the `./args` import (line 5):

```ts
import { args, familiarOverride, outfitOverride } from "./args";
```

Add a module-level once-per-session notice guard after `GLOBAL_AVOID` (line 26):

```ts
// Stooper-displacement notices are per-zone-per-session — buildPearlOutfit runs
// before every fight, and repeating the line each combat is noise.
const stooperNoticePrinted = new Set<string>();
```

Replace the whole body of `buildPearlOutfit` (lines 62–141) with:

```ts
export function buildPearlOutfit(spec: PearlSpec): OutfitSpec {
  const overdrunk = wineglassMode();
  const outfitName = outfitOverride(spec.key);

  // Organ extenders first — they win their slots. Required extenders are the law
  // (no adventuring without them); the overcapped flag forces the full set for
  // consumption headroom. A forced corset simply occupies the shirt: the parka never
  // equips and its mode is a harmless no-op; the maximizer chases res elsewhere.
  const organEquip = args.major.overcapped ? allOrganEquipment() : requiredOrganEquipment();
  const equip: Item[] = [...organEquip];

  if (overdrunk) {
    // The wineglass IS the off-hand while overdrunk. A required angelbone totem
    // displaces the configured drunkweapon (best-effort attack combat, user decision);
    // otherwise the drunkweapon (default June cleaver) is forced when owned.
    equip.push($item`Drunkula's wineglass`);
    const totemForced = organEquip.includes($item`angelbone totem`);
    if (!totemForced && have(args.major.drunkweapon)) equip.push(args.major.drunkweapon);
  }

  // Equip only as much lantern gear (any slot) as the one-shot actually needs —
  // a lantern ≈ an extra cast, and we know the per-cast floor, so the need is
  // computable (user design). Zero need = zero damage gear forced. Overdrunk:
  // lanterns duplicate SPELL components and the wineglass kills spells — skip all.
  // An outfit override owns ALL damage gear itself — skip lanterns there too.
  let secondLantern: Item | undefined;
  if (!overdrunk && outfitName === undefined) {
    const needed = lanternComponentsNeededForOneShot(spec.maxHp);
    const accessoryBudget = 3 - organEquip.filter((i) => toSlot(i) === $slot`acc1`).length;
    const lanterns = selectLanternGear(
      Number.isFinite(needed) ? needed : Infinity,
      accessoryBudget,
    );
    equip.push(...lanterns.equip);
    secondLantern = lanterns.secondOffhand;
  }

  const modes: Modes = {};
  if (outfitName === undefined && have($item`Jurassic Parka`)) modes.parka = spec.parkaMode;
  if (
    !overdrunk &&
    outfitName === undefined &&
    have($item`unwrapped knock-off retro superhero cape`) &&
    !airRequiresBackSlot()
  ) {
    equip.push($item`unwrapped knock-off retro superhero cape`);
    modes.retrocape = ["heck", capeMode(spec)];
  }

  // Familiar precedence: Stooper liver-rescue pin (its +1 only counts while active)
  // → per-zone familiar override → two-pass computed plan (user decision).
  const override = familiarOverride(spec.key);
  let familiarPlan: FamiliarPlan;
  if (liverMode() === "stooper") {
    if (override !== undefined && override !== $familiar`Stooper`) {
      if (!stooperNoticePrinted.has(spec.key)) {
        stooperNoticePrinted.add(spec.key);
        print(
          `pearlo: ${spec.key} familiar override ${override} displaced by Stooper (liver rescue needs its +1)`,
        );
      }
    }
    familiarPlan = {
      familiar: $familiar`Stooper`,
      famequip: familiarBreathesFree()
        ? undefined
        : familiarWaterBreathingEquipment.find((i) => have(i)),
    };
  } else if (override !== undefined) {
    // An override familiar gets breathing gear and nothing else — the Left-Hand Man
    // second-lantern hand-off does not apply to overrides (spec).
    const needsGear = !familiarBreathesFree() && !override.underwater;
    const famequip = needsGear ? familiarWaterBreathingEquipment.find((i) => have(i)) : undefined;
    if (needsGear && famequip === undefined) {
      abort(
        `pearlo: ${spec.key} familiar override ${override} cannot breathe underwater — ` +
          `own das boot / little bitty bathysphere, or get a familiar-air effect ` +
          `(Driving Waterproofly / Wet Willied), or drop the override.`,
      );
    }
    familiarPlan = { familiar: override, famequip };
  } else {
    // Always run a familiar (user decision) via two-pass planning: benchmark res
    // without familiar help, then spend the slot on res (maximizer `switch` picks) or
    // damage/utility. The second lantern only reaches the Left-Hand Man when the
    // one-shot still needs it.
    familiarPlan = pickPearlFamiliar(spec, secondLantern);
  }

  const avoid = [...GLOBAL_AVOID, ...(spec.avoid ?? [])];

  if (outfitName !== undefined) {
    // Saved-outfit override: the user's outfit IS the res plan. Its pieces are forced
    // through the normal equip path so grimoire's dress verifies them (and throws on
    // collisions with the mandatory layer — intended UX). The maximizer's only job is
    // patching air into slots the outfit leaves free. Avoided pieces (e.g. Kramco)
    // stay avoided; the dress error surfaces the conflict.
    const pieces = outfitPieces(outfitName);
    equip.push(...pieces);
    if (pieces.includes($item`Jurassic Parka`)) modes.parka = spec.parkaMode;
    const breathing = breathingKeywords(familiarPlan).replace(/^, /, "");
    const result: OutfitSpec = { equip, modes, avoid };
    if (breathing.length > 0) result.modifier = breathing;
    if (familiarPlan.familiar) result.familiar = familiarPlan.familiar;
    if (familiarPlan.famequip) result.famequip = familiarPlan.famequip;
    return result;
  }

  // Overdrunk: weapon-damage weights chase the one-shot floor. 'effective' (weapon
  // class matched to the better attack stat) only applies when NO weapon is forced —
  // it could contradict the configured drunkweapon's class and fail every combination.
  const weaponForced =
    overdrunk && (organEquip.includes($item`angelbone totem`) || have(args.major.drunkweapon));
  const combatWeights = overdrunk
    ? `${weaponForced ? "" : ", effective"}, 0.2 weapon damage, 0.2 weapon damage percent`
    : ", 0.1 item";
  const baseModifier = `${spec.key} res 18 max${breathingKeywords(familiarPlan)}, 0.05 hp regen, 0.05 mp regen${combatWeights}`;
  const result: OutfitSpec = {
    modifier: familiarPlan.extraModifier
      ? `${baseModifier}, ${familiarPlan.extraModifier}`
      : baseModifier,
    equip,
    modes,
    avoid,
  };
  if (familiarPlan.familiar) result.familiar = familiarPlan.familiar;
  if (familiarPlan.famequip) result.famequip = familiarPlan.famequip;
  return result;
}
```

Behavioral notes for the reviewer (not code): the wineglass/drunkweapon push moved
ahead of the lantern block so it applies to override zones too (mandatory layer);
the non-override path is otherwise byte-identical in behavior to the current code.

- [ ] **Step 2: Lint + build**

Run: `yarn lint && yarn build`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/outfit.ts
git commit -m "feat: per-zone familiar precedence and saved-outfit override in buildPearlOutfit"
```

---

### Task 3: economics.ts — price overrides honestly

**Files:**

- Modify: `src/economics.ts`

**Interfaces:**

- Consumes: `familiarOverride`, `outfitOverride` from `./args` (Task 1); `outfitPieces` from kolmafia.
- Produces (consumed by Task 4): `overrideReportLines(spec: PearlSpec): string[]`.

- [ ] **Step 1: Apply the edits**

Add `outfitPieces` to the kolmafia import (lines 3–14). Change the `./args` import (line 17) to:

```ts
import { args, familiarOverride, outfitOverride } from "./args";
```

In `evaluateZone` (line 232), replace the familiar line

```ts
const familiar = mode === "stooper" ? $familiar`Stooper` : undefined;
```

with:

```ts
// Price overrides as they will run: outfit pieces are forced into the speculation
// and an override familiar is pinned exactly like Stooper (skipping the maximizer's
// familiar switches). Stooper still displaces the override in stooper mode.
const outfitName = outfitOverride(spec.key);
if (outfitName !== undefined) equips.push(...outfitPieces(outfitName));
const familiar = mode === "stooper" ? $familiar`Stooper` : familiarOverride(spec.key);
```

Append after `printProfitReport` (end of file):

```ts
/** One line per active override for this zone (sim + profit report). */
export function overrideReportLines(spec: PearlSpec): string[] {
  const lines: string[] = [];
  const familiar = familiarOverride(spec.key);
  if (familiar !== undefined) {
    const displaced = liverMode() === "stooper" && familiar !== $familiar`Stooper`;
    lines.push(`  override: familiar ${familiar}${displaced ? " (displaced by Stooper)" : ""}`);
  }
  const outfitName = outfitOverride(spec.key);
  if (outfitName !== undefined) {
    lines.push(`  override: outfit ${outfitName} (${outfitPieces(outfitName).length} pieces)`);
  }
  return lines;
}
```

In `printProfitReport`'s per-zone loop, after the `--- ${spec.key} ---` print (line 382), add:

```ts
for (const line of overrideReportLines(spec)) print(line);
```

- [ ] **Step 2: Lint + build**

Run: `yarn lint && yarn build`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/economics.ts
git commit -m "feat: profit model prices per-zone familiar/outfit overrides honestly"
```

---

### Task 4: main.ts — startup validation + sim lines

**Files:**

- Modify: `src/main.ts`

**Interfaces:**

- Consumes: `outfitOverride` from `./args`; `overrideReportLines` from `./economics` (Task 3); `getOutfits`, `haveOutfit` from kolmafia.
- Produces: final behavior; no new exports.

- [ ] **Step 1: Apply the edits**

Add `getOutfits`, `haveOutfit` to the kolmafia import (line 2). Change the `./args` import (line 5) to:

```ts
import { args, outfitOverride, selectedPearls } from "./args";
```

Add `overrideReportLines` to the `./economics` import (lines 13–18).

Directly after `const selected = selectedPearls();` (line 43) — before the liver-mode decision, so bad config fails before any expensive work:

```ts
// Zone Overrides validation: a saved-outfit name that doesn't exist would otherwise
// surface as a confusing empty-pieces dress much later.
for (const spec of selected) {
  const outfitName = outfitOverride(spec.key);
  if (outfitName !== undefined && !haveOutfit(outfitName)) {
    abort(
      `pearlo: ${spec.key} outfit override "${outfitName}" is not a saved custom outfit ` +
        `(saved outfits: ${getOutfits().join(", ") || "none"})`,
    );
  }
}
```

In the sim block's per-zone verdict loop (lines 76–82), after the profit GO/SKIP print, add:

```ts
for (const line of overrideReportLines(spec)) print(line);
```

- [ ] **Step 2: Lint + build**

Run: `yarn lint && yarn build`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: validate outfit overrides at startup, report overrides in sim"
```

---

### Task 5: in-game verification (user-driven)

- [ ] `yarn install-mafia`; set `pearlo_coldoutfit` to a saved outfit + `pearlo_coldfamiliar` to an owned familiar; `pearlo profit` (res floor reflects the outfit; override lines print), `pearlo sim` (same lines), live cold-zone run.
- [ ] Bogus outfit name → startup abort listing saved outfits.
- [ ] Stooper-mode run with a familiar override → displacement notice prints once.
