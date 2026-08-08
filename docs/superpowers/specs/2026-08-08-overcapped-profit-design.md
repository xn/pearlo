# pearlo: overcapped mode + profit model — design

Date: 2026-08-08. Status: approved pending user spec review.
Scope: organ-extender ("overcapped") handling for stomach/liver/spleen, and a VOA-based
profit model that chooses the liver configuration (extenders vs Stooper vs wineglass),
prices each zone, and gates unprofitable farming. Companion references:
`docs/consumption-reference.md` (§2 capacities, §3 falling-down drunk),
`docs/sea-reference.md` (§6 stun/ML, §7 deleveling, monster debuffs), `CLAUDE.md`.

## Goals / non-goals

**Goals**

1. Never be blocked from adventuring by an overcapped stomach ("Food Coma") or spleen
   ("jaundiced"): auto-detect the state and force-equip the minimal organ-extending
   equipment that makes adventuring legal — flag or no flag.
2. `overcapped` flag: force **all** owned extenders while running turns, so mid-day
   consumption can use the extended caps.
3. Treat mild overdrunk as rescuable: when liver extenders (and/or Stooper) can bring
   inebriety back under the effective limit, spell combat is on the table — wineglass
   mode is no longer automatic at `myInebriety() > inebrietyLimit()`.
4. Price everything: a `voa` arg (default: the user's `valueOfAdventure` mafia
   preference) plus garbo-lib item valuation lets pearlo compute per-zone expected
   profit, choose the most profitable liver configuration, skip unprofitable zones
   (overridable with `force`), and print a `profit` report analogous to `sim`.

**Non-goals**

- No diet planning: pearlo does not eat/drink/chew to fill the extended capacity; it
  only keeps the capacity legal/available while adventuring.
- No exact debuff simulation: proc rates for Majorly Poisoned / The Colors... are
  undocumented; costs use rough per-combat estimates (user-approved).
- No new zones, combat, or familiar mechanics beyond what the configuration choice
  needs.

## Verified game facts (wiki data pages, 2026-08-08)

2026 Standard rewards, one per organ per alignment, all `+1` capacity **while equipped**:

| Item                 | Slot                   | Organ   | Other enchantments                        |
| -------------------- | ---------------------- | ------- | ----------------------------------------- |
| angelbone chopsticks | accessory              | Stomach | 7–11 HP regen/adv, 15% avoid enemy attack |
| devilbone corset     | **shirt**              | Stomach | **+13 ML**, hot damage on attacks         |
| angelbone dice       | accessory              | Liver   | 7–11 HP regen/adv, 15% avoid enemy attack |
| devilbone rosary     | accessory              | Liver   | **+13 ML**, hot damage on attacks         |
| angelbone totem      | **weapon (1-h totem)** | Spleen  | 7–11 HP regen/adv, 15% avoid enemy attack |
| devilbone greaves    | **pants**              | Spleen  | **+13 ML**, hot damage on attacks         |

Overcap states (consumption-reference §2): stomach over limit = **Food Coma, cannot
adventure**; spleen over limit = **jaundiced, cannot adventure** (reachable only by
losing capacity, i.e. unequipping an extender after consuming at the extended cap);
liver over limit = falling-down drunk (wineglass rules, adventuring possible). Slot
conflicts that matter: corset vs **Jurassic Parka** (shirt — our stagger + res
baseline), totem vs the **weapon slot** (drunkweapon in wineglass mode; lantern gear
otherwise), devilbone pieces stack **bonus ML** (stun resistance starts at +51; three
devilbone pieces = +39, and ML raises monster stats against the one-shot floor).

Debuff cures (user-confirmed): Majorly Poisoned → **anti-anti-antidote**; The
Colors... (−5 all res, cuts progress rate) → **soft green echo eyedrop antidote**.

## Architecture

| File                     | Responsibility                                                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/organs.ts` (new)    | Extender table + organ-state queries: baselines, overages, minimal required sets, `effectivelyOverDrunk()`, `canFixOvercap()`. All computed at call time — nothing module-level.             |
| `src/economics.ts` (new) | garbo-lib `makeValue()` wrapper, pearl/cure valuation, per-zone per-configuration profit math, liver-configuration chooser, go/no-go verdicts, profit-report printer.                        |
| `src/args.ts`            | New args: `overcapped`, `voa`, `force` (Major); `profit` (Information, exits like `sim`).                                                                                                    |
| `src/outfit.ts`          | Push forced extenders into `equip`; parka mode skipped when the corset is forced; totem/drunkweapon clash resolution; consume the chosen liver configuration instead of raw `isOverDrunk()`. |
| `src/mood.ts`            | Spell-suppression branch keyed on the chosen configuration (wineglass mode), not raw `isOverDrunk()`.                                                                                        |
| `src/pearls.ts`          | Zone guards use `effectivelyOverDrunk()`/configuration; go/no-go gate per zone (skipped zones log the verdict; `force` overrides).                                                           |
| `src/main.ts`            | `profit` action handling; `sim` gains organ-state + configuration lines; halt path for unfixable overcap.                                                                                    |
| `src/lib.ts`             | `isOverDrunk()` etc. stay as raw state predicates; mode decisions move to `organs.ts` (call sites updated).                                                                                  |

## `src/organs.ts`

- Extender table: `{ organ, item, slot } []` in preference order per organ —
  **angelbone before devilbone** (no ML, no shirt/pants cost): stomach = chopsticks →
  corset; liver = dice → rosary; spleen = totem → greaves. **Spleen order flips to
  greaves → totem in wineglass mode** (weapon slot belongs to the drunkweapon; the
  totem there is last-resort).
- `baselineLimit(organ)`: `fullnessLimit()` / `inebrietyLimit()` / `spleenLimit()`
  minus the +1 of each currently-equipped extender for that organ; for liver, also
  minus Stooper's +1 when Stooper is the _current_ familiar (its contribution is not
  guaranteed once the outfit's familiar plan runs). Never hard-code capacities.
- `overage(organ)` = `usage − baselineLimit(organ)`, floored at 0.
- `requiredOrganEquipment(wineglassMode: boolean): Item[]` — minimal owned set:
  - stomach/spleen: the first `overage` owned extenders in preference order.
  - liver: when `overage > 0` and the chosen configuration is a rescue (see
    economics), the first `overage-covered-by-items` owned liver extenders; **zero**
    liver extenders in wineglass mode (the user-supplied filter: if we are more
    overdrunk than extenders can handle, we adventure via wineglass, so drunkenness
    extenders are dead slots).
- `allOrganEquipment(wineglassMode: boolean): Item[]` — every owned extender, minus
  liver extenders in wineglass mode, for the `overcapped` flag.
- `effectivelyOverDrunk()`: `myInebriety() > baselineLimit(liver) + (owned liver
extenders) + (Stooper in terrarium ? 1 : 0)` — drunk beyond any conceivable rescue,
  so wineglass mode is certain without running the chooser. When it is false but
  `overage(liver) > 0`, the **chosen configuration** (economics chooser) is the single
  source of truth for wineglass-vs-rescue — a rescue that is non-viable in practice
  (e.g. Stooper without underwater famequip breathing) simply drops out of the
  candidate list and wineglass wins by default. `isOverDrunk()` remains only as the
  raw state predicate.
- `canFixOvercap()`: stomach and spleen overages each coverable by owned extenders.
  When false → **halt** with a clear message (mojo filter, organ cleaners, or wait for
  rollover) — no outfit makes adventuring legal, and `force` does not override this.

## `src/economics.ts`

Pricing goes through **garbo-lib** (`makeValue()` → `value`/`averageValue`), preferred
over raw `mallPrice`/`historicalPrice`. `ValueFunctions` built once and cached for the
session.

- `pearlValue()` = `value($item\`unblemished pearl\`)`, cached.
- Progress rate: `min(10, 1.7 × floor(res / 3))` %/combat (minimum 1.7); `res` comes
  from a **speculative maximizer pass** for the configuration under evaluation (the
  two-pass benchmarking machinery in `src/familiar.ts` already models this).
- `turnsPerPearl(rate, fishy)` = `ceil(100 / rate) × (fishy ? 1 : 2)`.
- Costs per pearl (rough, user-approved):
  - MP: `casts/fight × MP/cast` from `damagePlan()` × Doc Galaktik tonic meat-per-MP,
    net of maximized MP regen. Zero in wineglass configurations (no spells).
  - HP: expected damage taken per fight (monster attack vs our defense, §7 formulas,
    rounds from the combat plan) × meat-per-HP restored.
  - Debuffs: cure price (garbo value of anti-anti-antidote / soft green echo eyedrop
    antidote) × a conservative flat incidence per combat, scaled up for multi-round
    attack configurations (more hits taken → more procs). Incidence constants are
    labelled estimates in code, not game facts.
- `zoneProfit(spec, config)` = `pearlValue() − turnsPerPearl × voa − costs`.
- **Liver configuration chooser** (only when `overage(liver) > 0`): candidates are
  the viable subset of —
  1. **item rescue**: dice/rosary cover the overage (accessory slots);
  2. **Stooper rescue**: Stooper's +1 covers what items can't (or replaces one) —
     viable only with underwater famequip breathing for Stooper; costs the res/lantern
     familiar slot (priced by the speculative res drop);
  3. **wineglass**: always viable when the wineglass is owned (attack-only, drunkweapon
     one-shot, per existing overdrunk mode).
     Pick max `zoneProfit`. Not-overdrunk characters skip the chooser entirely — familiar
     planning stays res-driven as today.
- **Go/no-go**: if the best configuration's profit `< 0`, the zone is skipped with a
  logged verdict; `force` farms it anyway. The unfixable-overcap halt is not a profit
  verdict and is not forceable.
- `profitReport()`: per selected zone — chosen configuration, speculated res, rate,
  turns/pearl, cost breakdown (VOA turns, MP, HP, debuffs), pearl value, net profit,
  verdict. Printed by the `profit` action and (abbreviated) by `sim`.

## Args (`src/args.ts`)

| Arg          | Group       | Type   | Default                   | Meaning                                                                               |
| ------------ | ----------- | ------ | ------------------------- | ------------------------------------------------------------------------------------- |
| `overcapped` | Major       | flag   | false (`setting: ""`)     | Force-equip **all** owned organ extenders while running turns (consumption headroom). |
| `voa`        | Major       | number | `get("valueOfAdventure")` | Meat value of an adventure for all profit math.                                       |
| `force`      | Major       | flag   | false                     | Farm zones the profit model rejects (negative expected profit).                       |
| `profit`     | Information | flag   | `setting: ""`             | Print the profit report and exit without spending turns (like `sim`).                 |

`overcapped` OFF still auto-equips `requiredOrganEquipment()` — required gear is
state-driven, never opt-in (without it there is no adventuring at all).

## Outfit and combat plumbing (`src/outfit.ts`, `src/mood.ts`, `src/pearls.ts`, `src/main.ts`)

- `buildPearlOutfit` receives/derives the chosen liver configuration; `overdrunk`
  branches key on **wineglass mode chosen**, not raw `isOverDrunk()`.
- Forced extenders (`requiredOrganEquipment()`, or `allOrganEquipment()` with the
  flag) are pushed into `equip` **before** lantern/cape gear so they win their slots.
- Corset forced → parka mode is not set (shirt occupied); the maximizer chases the
  lost res in other slots; `requirecap` still halts if 18 is unreachable.
- Totem forced while in wineglass mode → the totem takes the weapon slot and the
  drunkweapon is dropped: **best-effort attack combat** (user decision), accepting
  multi-round fights; the never-melee-the-eel macro rule still holds.
- Stooper configuration → familiar plan pins Stooper + a breathing famequip; res
  familiar contribution is forfeited (already priced by the chooser).
- `mood.ts` spell-suppression and `pearls.ts` overdrunk guards switch to the chosen
  configuration / `effectivelyOverDrunk()`.
- `main.ts`: `profit` action prints the report and exits; `sim` adds organ states,
  forced extenders, chosen configuration, and the halt warning for unfixable overcap.

## Error handling

- Unfixable stomach/spleen overcap: halt (abort with explanation) before any task runs.
- garbo-lib valuation failing / pearl untradeable edge: fall back to
  `historicalPrice`, warn once.
- Speculative maximize returning unmet requirements: treat that configuration's res as
  the speculated value anyway (consistent with existing `maximize()` semantics), let
  `requirecap` do its job at dress time.

## Testing / verification

No unit tests exist (kolmafia stubs throw outside mafia). Verification is:
`yarn lint` + `yarn build` clean; then on the reference character in the gCLI —
`pearlo profit` (report sanity: values, configurations, verdicts), `pearlo sim` and
`pearlo sim drunk` (organ lines correct), and a live run in at least one state per
mode: sober, mildly overdrunk with extenders owned (rescue chosen), deeply overdrunk
(wineglass chosen), and stomach/spleen overcapped (extenders forced; halt path when
simulated as unowned via `avoid`).
