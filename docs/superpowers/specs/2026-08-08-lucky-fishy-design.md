# Lucky!-based Fishy refresh — design

**Date:** 2026-08-08
**Status:** Approved by user

## Problem

Fishy is the biggest efficiency lever in pearl farming: underwater adventures cost 2 turns
without it, 1 with it. Today the script's only Fishy source is the free fishy pipe (10
turns, once/day). Once that drains, every remaining fight costs double.

The Brinier Deepers has a `lucky`-tagged noncombat, **The Haggling**, that grants **20
turns of Fishy** (wiki-verified 2026-08-08). Acquiring the Lucky! intrinsic and spending
one adventure there refreshes Fishy for ~20 more single-turn fights. Lucky! acquisition
can cost real meat (mall 11-leaf clovers), so spending must be configurable.

## Verified game facts

- **The Haggling** (The Brinier Deepers, lucky adventure): grants Fishy (20 turns). Costs
  2 adventures if encountered without Fishy, 1 with — so refreshing at ≤1 Fishy turn
  remaining is optimal. Plain noncombat, no choice adventure to answer.
- **Lucky!** is an intrinsic: no turn countdown, persists over rollover, expires only when
  a lucky adventure is encountered. While active, the _next_ adventure in any
  lucky-capable zone becomes its lucky NC — the Dive Bar and Madness Reef have their own
  lucky NCs, so a stray Lucky! wastes a pearl turn there (existing `pearlMood` warning).
- **Lucky! sources** (wiki page "Lucky!"): 11-leaf clover, pill keeper "Surprise Me",
  Aug. 2nd scepter skill, plus others out of scope (clovermint, astral energy drink,
  optimal dog, Lucky Lindy, Apriling band saxophone, Heartstone: LUCK).
- **Aug. 2nd: Find an Eleven-Leaf Clover Day**: august scepter skill, 0 MP, once/day,
  grants Lucky! directly. libram `AugustScepter.have()` / `.canCast(2)` /
  `.getAugustCast(2)`.
- **11-leaf clover**: sold by the Hermit, **limit 3/day** (tracked in `_cloversPurchased`),
  one worthless item each (~50 meat via chewing gum); also mall-tradeable (tens of
  thousands of meat). `hermit()` exists in kolmafia's API.
- **Eight Days a Week Pill Keeper**: "Surprise Me" grants Lucky!; free use once/day
  (`_freePillKeeperUsed`), 3 spleen afterward (out of scope — free use only). Exact
  mafia CLI keyword (`pillkeeper random` vs other) to be confirmed against mafia source
  during implementation.

## Design

### 1. Acquisition cascade — new `src/fishy.ts`

`acquireLucky(): boolean` tries, in order (user-specified):

1. Already `have($effect\`Lucky!\`)` → done. (Consumes an externally-acquired Lucky!
   productively instead of letting a Dive Bar/Reef NC eat it.)
2. **Aug. 2nd scepter**: `AugustScepter.have() && AugustScepter.canCast(2)` → cast the
   skill.
3. **Owned 11-leaf clover** → `use`.
4. **Free pill keeper** use ("Surprise Me").
5. **Hermit**: while `_cloversPurchased < 3` — acquire hermit permit + worthless item,
   trade, use.
6. **Mall**: only when `cloverprice > 0`, `mallPrice ≤ cloverprice`, and the worth-gate
   passes (see §3).

A companion `luckySourceAvailable(): boolean` mirrors the cascade without side effects,
for the task's `ready()`.

### 2. "Get Fishy" task

Inserted in the task list **after "Breathe Underwater" and before all zone tasks** —
grimoire list position is priority, so it preempts zone tasks whenever Fishy runs low.

- `after`: `["Breathe Underwater"]`
- `ready()`: `args.resources.luckyfishy` enabled ∧ `haveEffect(Fishy) ≤ 1` ∧
  `canBreathUnderwater()` ∧ (`have(Lucky!)` ∨ `luckySourceAvailable()`) ∧ at least one
  selected zone still has fights remaining ∧
  `myAdventures() − args.debug.halt ≥ tripCost` (1 with a Fishy turn active, else 2).
- `completed()`: `haveEffect(Fishy) > 1` — re-arms automatically each time Fishy drains
  during the day.
- `prepare()`: `acquireLucky()`; **abort if Lucky! is still missing** (never adventure in
  The Brinier Deepers unprotected — its fish are out-of-plan monsters).
- `do`: `$location\`The Brinier Deepers\``.
- `outfit`: `{ modifier: "sea" }` — handles breathing gear and underwater-familiar
  requirements via the maximizer's `sea` keyword. Familiar handling reuses the same
  selection logic as zone tasks (`src/familiar.ts`) so `sea`'s Underwater Familiar
  requirement is satisfiable; falling back to no familiar is acceptable for a
  noncombat trip.
- `combat`: `Macro.abort()` tripwire — with Lucky! active the encounter is guaranteed to
  be The Haggling; any combat means the plan is broken and should fail loudly.
- `limit`: `{ soft: 10 }` (realistic ceiling ~6 refreshes/day).

`pearlMood`'s existing Lucky! warning narrows to the only remaining hazard: Lucky! active
while Fishy is still high (> 1), where a Dive Bar/Reef NC would eat it before the task
runs.

### 3. Configurability — `resources` args group

- `luckyfishy` flag, **default true** — disable to preserve the scepter cast / pill
  keeper freebie for other scripts.
- `cloverprice` number, **default 0** — max meat per mall 11-leaf clover; 0 = free
  cascade only (project free-by-default rule).
- **Worth-gate on mall purchases only**: buy only when
  `min(20, remaining pearl fights) × voa ≥ price`. Free-tier sources need only ≥ 1
  remaining fight.

### 4. Profit model (`src/economics.ts`)

`fishyFightsAvailable()` currently counts active Fishy turns + the unused pipe, and
`zoneVerdict(...).go` blocks unprofitable zones — without modeling refreshes, a
refresh-covered day is priced at 2 turns/fight and may be wrongly declined.

Extend the model: count available refreshes (scepter + free pill keeper + hermit
remaining + owned clovers + mall-if-enabled-and-worth-gated), each contributing **20
fishy fights** at a cost of **1 trip turn + its clover's meat cost** (0 for
scepter/pill keeper/owned; ~worthless-item cost for hermit; `mallPrice` capped at
`cloverprice` for mall). Thread these into the per-zone budget the same way the pipe is
threaded today, and report refresh usage in the profit report alongside
`fishyUsed`.

## Error handling

- Cascade exhausted → `ready()` stays false → zones continue at 2 turns/fight (today's
  behavior). No abort.
- Lucky! acquisition claims success but effect missing in `prepare()` → abort with a
  clear message.
- Unexpected combat in The Brinier Deepers → `Macro.abort()`.

## Out of scope

- Non-free pill keeper uses (3 spleen), clovermint, astral energy drink, optimal dog,
  Lucky Lindy, Apriling band saxophone, Heartstone: LUCK.
- Modeling Fishy expiry mid-zone in `turnsNeeded()` (pre-existing simplification).

## Testing

No unit tests exist (kolmafia stubs throw outside mafia). Verification is `yarn lint`,
`yarn build`, and in-game runs: `pearlo sim` (refresh availability reported), `pearlo
profit` (refresh economics visible), and a live run crossing a Fishy boundary.
