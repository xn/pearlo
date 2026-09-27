# pearlo test suite

Run with `yarn test` (or `npx vitest run`; `npx vitest` for watch mode).

## Architecture

The `kolmafia` package — and `libram`, `grimoire-kolmafia`, `garbo-lib` on top of it —
only works inside the KoLmafia JVM, so nothing under `src/` is importable in a plain
Node process. The suite substitutes all four packages with hand-written fakes via
vitest resolve aliases (`vitest.config.ts`):

- `test/mocks/kolmafia.ts` — the fake game. Identity-cached `Item`/`Effect`/… classes
  plus one mutable `GameState`: inventory, active effects, mall/NPC/historical/sale
  prices, item and effect modifiers, player and `Generated:_spec` modifiers, organ
  state, a pluggable `maximize` and `buy`, and a log of every side effect (buys, uses,
  skill casts, restores, cliExecutes, prints).
- `test/mocks/libram.ts` — `$item`/`$effect`/… template tags, `get`/`set`/`have`/
  `sum`/`maxBy`, `Macro`, and inert resource shims, all reading the same `GameState`.
- `test/mocks/grimoire-kolmafia.ts` — an `Args.create` that materializes default
  values as a plain mutable object (tests write `g.args.resources.potionprice = …`
  directly), plus inert `Task`/`CombatStrategy`/`Outfit` containers so task
  `ready()`/`completed()` predicates can be exercised.
- `test/mocks/garbo-lib.ts` — `makeValue().value()` returns the state's SALE values,
  deliberately distinct from mall prices, so sale-vs-purchase confusion is testable.

`test/support/harness.ts` is the entry point every test uses:

- `loadGame(configure)` resets the module registry (`vi.resetModules`), resets the
  game state, runs `configure` against it, and only then imports `src/*` — ordering
  that matters because src reads game state at import time (args defaults) and holds
  module-level caches (verdict cache, outlay cache, warned-once and failed-buy sets)
  that must start fresh per test. Everything it hands back is typed with the real
  package typings, so `npx tsc --noEmit` checks tests against the same types as src.
- `standardScenario` sets up the hand-computable baseline used throughout: VOA 1,000,
  pearl 50,000, free restores/cures, a chosen speculative res, N turns of Fishy. In
  that world `profit = 50,000 − turns×1,000 − potion cost − refresh cost` exactly, so
  tests assert exact meat figures instead of inequalities.

Tests exercise the real exported src functions (`zoneVerdict`, `primeZoneVerdicts`,
`candidateResPlans`, `resStepWorthIt`, `topUpRes`, `chooseLiverConfiguration`,
`pearlTasks[].ready`, …); nothing reimplements their logic.

## Adding a case

```ts
it("describes the decision, not the mechanism", async () => {
  const g = await loadGame((t) => {
    standardScenario(t, { res: 15, fishyTurns: 40 });
    t.item("cold powder", {
      mall: 200,
      sale: 100,
      effect: "Insulated",
      duration: 20,
      res: { cold: 3 },
    });
  });
  g.args.resources.potionprice = 1000; // args are plain mutable values after load
  const v = g.economics.zoneVerdict(g.zones.PEARLS.find((p) => p.key === "cold")!);
  expect(v.profit).toBe(50_000 - 10_000 - 200); // assert exact hand-computed meat
});
```

Guidelines:

- Configure state inside `loadGame`'s callback when src reads it at import time
  (properties like `valueOfAdventure`); afterwards is fine for everything else.
- Prefer asserting exact hand-computed numbers from the standard scenario; an
  inequality can stay green while the arithmetic drifts.
- Assert side effects through `g.state.log` (buys carry their price caps; uses carry
  counts). "Spends nothing" claims should sweep every log.
- One game per test. Never share a `Game` across tests — the whole point of the
  loader is that module-level caches in src start cold.
- `src/` is a moving target; when a signature changes, update the harness call sites,
  not the scenario arithmetic.

## What each file covers

- `progress-model.test.ts` — `progressRatePct` boundaries (0/2/3/17/18/21),
  `turnsForFights` fishy-pool arithmetic, the baseline zone pricing.
- `candidate-plans.test.ts` — purchase vs sale pricing, unpriceable items, stack
  sizing at the candidate's own rate (not the gear-only rate), subset (not prefix)
  search, step-function gating, reserved/carried exclusions.
- `zone-verdict.test.ts` — maximize-boolean handling, stack sizing at the model's
  own turn count, never-worse-than-gear-only, Fishy/potion/carried budget threading
  across zones (SKIP and already-obtained zones spend nothing), single-aging AND
  single-entry-per-effect of carried stacks (a mid-run re-up must merge, not
  duplicate — KoL merges re-applied effect turns; and every intervening zone's turns
  age a stack before a later zone may credit it), Lucky!-refresh economics,
  garbo-lib valuation fallback.
- `executor.test.ts` — `topUpRes`: no unpriceable item reaches `buy()`, every buy has
  a positive finite per-item cap, all-or-nothing spans buying, empty-mall latch, no
  stranding after a partial failure, sunk purchases not re-charged at drink time, no
  NaN cost bases, executor sizing ≤ gate approval, mid-zone re-ups permitted; the
  `topUpFamiliarWeight` worthIt gate (spend only when the res step out-earns the
  potions' sale value, and never for zero gain).
- `gating.test.ts` — `resStepWorthIt` step/threshold behavior, the `pearlTask.ready`
  profit gate (SKIP is never farmed; `force` overrides), the adventure floor and
  halt/strand guards (never start a pearl that would strand at rollover), and the
  pricing/report paths' spend-nothing contract.
- `liver-mode.test.ts` — `chooseLiverConfiguration` scores only zones it will farm.
- `fishy.test.ts` — `luckyRefreshCosts` cascade ordering, the mall-clover
  worth-gate, and `remainingPearlFights`.
- `combat.test.ts` — `weaponAttackPlan`'s hit guarantee: the wiki Muscle-vs-Defense
  threshold, and the "Attacks Can't Miss" route (June cleaver and friends) that ignores
  Muscle for the hit while the damage term still scales with it.
- `leroyjenkins.test.ts` — the overdrunk one-shot halt in `pearlTask.prepare`, and the
  `leroyjenkins` flag that downgrades it to a warning.
- `fishy-trip-organs.test.ts` — issue #13: the Get Fishy / Lutz trip outfits carry the
  organ layer (required extenders, full set under `overcapped`, the wineglass while
  overdrunk, the Stooper pin), and Get Fishy's `prepare` halts before spending a Lucky!
  source when an organ is still over its limit as dressed.

## Deliberately NOT covered

- Anything that needs the live game: real maximizer results, real mall behavior,
  combat text, actual server round-trips. The `maximize` fake returns whatever a test
  configures; it does not model gear.
- `main.ts` / `engine.ts` — arg parsing, task-engine execution order, and the
  `--sim`/`--profit` CLI plumbing. The spend-nothing property of those flags is
  tested at the pricing/report layer they call, not through `main()`.
- Outfit construction (`buildPearlOutfit`), combat macros, and moods beyond
  `topUpRes` — they are thin over maximizer/engine behavior the fakes cannot vouch
  for.
- Fidelity of the fakes themselves to mafia quirks beyond what src relies on
  (documented quirks that ARE modeled: `buy(item, n, 0)` = uncapped, sale value ≠
  mall ask, `maximize(str, true)` boolean semantics via a settable return).

Some internals would need exporting for direct (rather than behavioral) coverage;
see the suite report: `costZone` (budget-mutation invariant), `evaluateZone`,
`scoreLiverMode`/`candidateLiverModes`, `purchaseCost`/`acquisitionCost`,
`speculativeResFloor`, `executeResPlan`.

## Deliberately not covered

- **A resistance effect that is both live and carried.** `evaluateZone` must count such
  an effect once: it is already inside the measured resistance, so a carried stack for
  it adds nothing. Reproducing the double-credit needs a first zone long enough for the
  live effect to count as expiring there and be planned, which the fixture set cannot
  currently reach. The guard is in `evaluateZone`; the test is not.
