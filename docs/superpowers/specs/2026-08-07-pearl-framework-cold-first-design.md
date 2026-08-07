# pearlo: pearl framework, cold pearl first — design

Date: 2026-08-07. Status: approved pending user spec review.
Approach: full framework for all five pearl zones (user choice "C"), with **The Briniest
Deepests (cold)** as the first fully-wired, tested zone. Reference character: a **sober
Pastamancer** with Saucegeyser permed. Companion references: `docs/sea-reference.md`,
`docs/consumption-reference.md`, `docs/maximizer-reference.md`, `CLAUDE.md`.

## Goals / non-goals

**Goal**: `pearlo` run in the gCLI on the reference character breathes underwater, dresses
for `cold res 18 max, sea`, buffs via mood, and adventures in The Briniest Deepests with an
Entangling Noodles + Saucegeyser macro until `_unblemishedPearlTheBriniestDeepests` is true
or guards halt it — with HP/MP sustained between fights.

**Non-goals (v1)**: overdrunk/wineglass play (sober only); diet/organ-based Fishy (fishy
pipe only); familiar strategy (run familiar-less unless Waterproofly is up); mall spending
(free/owned only — price-cap arg comes later); the four other zones being _tested_ (their
specs exist; their quirks are data).

## Architecture

All capability checks are runtime probes (`have(...)`) — other characters degrade
gracefully to fewer layers, never crash.

| File                  | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/args.ts`         | Add `pearls` string arg: ordered no-dup subset of `spooky,sleaze,hot,stench,cold` (default = that full order), parsed/validated to `PearlSpec[]`. Existing debug group + `halt` stay.                                                                                                                                                                                                                                                                        |
| `src/engine.ts` (new) | `PearloEngine extends Engine`. `initPropertiesManager` per the user's pattern: ban free-rest auto-restorers ("sleep on your clan sofa", "rest in your campaway tent", "rest at the chateau", "rest at your campground", "free rest"), add "doc galaktik's invigorating tonic" to MP items, `hpAutoRecovery: -0.05`, `mpAutoRecovery: -0.05` (auto-triggers OFF; script restores explicitly), `autoSatisfyWithCloset: false`, `maximizerCombinationLimit: 0`. |
| `src/pearls.ts`       | `PEARLS` table extended per zone: element, parka mode, `avoid` items (Mer-kin digpick in the Mine), zone quirk flags. Task factory: one task per _selected_ pearl from shared builders. Existing "Breathe Underwater" task runs first.                                                                                                                                                                                                                       |
| `src/outfit.ts`       | `buildPearlOutfit(spec): OutfitSpec` (implements the stub).                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/combat.ts`       | `buildPearlMacro(spec): Macro`, `saucegeyserDamage()`, `castsToKill(hp)`, `mpBudgetPerFight()`.                                                                                                                                                                                                                                                                                                                                                              |
| `src/mood.ts` (new)   | Buffs + restores ("mood is the idiom" — user). libram `Mood` where expressible; `tryAcquiringEffect` for sources `Mood` can't model.                                                                                                                                                                                                                                                                                                                         |
| `src/lib.ts`          | Implement the stubs for real: `isOverDrunk = myInebriety() > inebrietyLimit()`; capped predicates use `>=`. Never hard-code organ capacities.                                                                                                                                                                                                                                                                                                                |
| `src/main.ts`         | Real entry: `sinceKolmafiaRevision`, `Args.fill` + help/sim/list, build quest from selected pearls, `try { engine.run() } finally { engine.destruct() }`, session summary (pearls obtained, turns spent, meat delta).                                                                                                                                                                                                                                        |

## Outfit (per zone)

- Modifier: `"<element> res 18 max, sea, 0.05 hp regen, 0.05 mp regen, 0.1 init"`.
  Cap marker **before** `sea` (the `sea` keyword resets the marker-attachment pointer —
  see maximizer reference). Regen/init are cheap tiebreak weights.
- `modes: { parka: <zone mode> }` when Jurassic Parka is owned (cold → kachungasaur).
  Parka also supplies the automatic round-1 stagger in every fight.
- `avoid`: from the spec (digpick for Anemone Mine).
- **Spell-damage gear (user addition)**: the outfit builder tries to `equip` (grimoire's
  graceful-failure equip, not hard-force) from two data lists when owned:
  - `Congressional Medal of Insanity` (accessory): Myst +25%, Spell Damage +50%,
    8–12 MP regen/adv, and a 3-random-element lantern.
  - Best owned off-hand **lantern** by priority: petrified wood water purifier (cold+sleaze),
    meteorb (hot), snow mobile (cold), big hot pepper (hot). (Rain-Doh green lantern
    deprioritized — rarity, per user; porcelain porkpie is a hat and competes with
    breathing hats — excluded from v1.)
  - **Retro superhero cape as a back-slot lantern (user addition)**: Heck General +
    **Kill Me** mode adds Spooky equal to the spell's greatest component (cloak also
    gives Myst +30%, Max MP +50). Mutually exclusive with its own Hold Me 3-round stun —
    the kill plan prefers the lantern; the parka covers the stagger. Requires non-back
    air (hat or effect); mode set via `modes: { retrocape: "heck kill" }` (libram
    modeable). Skipped automatically when the character's only air source is the
    old SCUBA tank.
    Res cap keeps priority: after equipping damage gear, if `18 max` res is no longer met,
    the builder drops damage gear first (verified via speculation before dressing).
- Familiar: **Left-Hand Man holding a second owned lantern off-hand, but only when
  Driving Waterproofly (or Wet Willied) is active** (its famequip slot is the held
  off-hand, so das boot would defeat it). Otherwise: no familiar. Broader familiar
  strategy stays post-v1.
- Player breathing is the Breathe Underwater task's job; `sea` keeps the maximizer honest.

## Outfit–combat contract (the interdependency, resolved)

The outfit owes three things at once — (1) the res cap + `sea` (never traded), (2) spell
damage (drives `castsToKill`), (3) stun coverage for whatever the kill plan leaves
uncovered — and the combat plan arbitrates. Two-pass resolution per task execution:

1. **Plan pass**: assume best owned damage gear; compute `castsToKill`. The character's
   skill stun (Entangling Noodles: 3–5 rounds, min 3) covers up to a 3-cast kill for
   free. If `castsToKill ≤ 3` (or ≤ 1 with no stun at all): damage config — cape (if
   participating) in **Kill Me** (lantern). Else: control config — cape in **Hold Me**
   (3-round stun stacking after Noodles); if still uncovered, drop the plan to
   stun+burst-and-restore and warn in `sim`.
2. **Dress, then verify pass**: after `dress()`, recompute damage from _actual_ equipped
   modifiers (`numericModifier` reads real state) and set the macro's cast count and the
   fight's MP budget from observed numbers, not planned ones.

## Combat

- Macro: `Macro.trySkill($skill\`Entangling Noodles\`).skill($skill\`Saucegeyser\`).repeat()`.
  Non-melee everywhere → the eel's melee counter never fires; Noodles (Pastamancer) buys
  3–5 stunned rounds. Per-monster branch structure exists in the builder (keyed off the
  zone spec) but v1 ships only the default branch — the stench-zone
  pufferfish/dragonfish branches arrive with that zone.
- Damage calculator (wiki `Calculating_Spell_Damage` + `Lanterns`):
  base `spellDmg = ceil((1 + pct/100) × (60 + floor(0.4 × buffedMyst) + flatSpellDmg + flatElemental))`
  using the worst-case roll (60); Saucegeyser is uncapped; `pct` applies post-cap. Then
  **lanterns**: each equipped lantern (walked in the wiki's evaluation-order table)
  duplicates the current highest damage component as additional element component(s);
  chained lanterns compound. **Conservative modeling**: whether lantern damage receives
  the % multiplier is wiki-unstated, so the calculator duplicates the _pre-multiplier_
  component value (worst case) and flags the estimate as a floor. CMoI counts as one
  lantern adding 3 components at the (conservative) highest-component value, with the
  collision rule (a rolled element matching the spell's tuned element adds nothing) taken
  at worst case: assume 1 of its 3 elements collides.
  Modifier names for `numericModifier` verified against local typings at implementation
  time. `castsToKill(800)` → N; `mpBudgetPerFight = 3 + 24 × N`.
- MP feasibility is enforced in `prepare()` (below), not by mid-macro aborts.

## Mood & sustain (`src/mood.ts`)

Runs in each task's `prepare()`:

1. **Buff lists (data, not code)** — four categories, acquired free-first via libram
   `Mood` / `tryAcquiringEffect` with `canAcquireEffect` gating: Myst%; spell dmg %
   (Carol of the Hells, Song of Sauce if castable; Subtle and Quick to Anger is passive);
   flat spell dmg (Jackasses' Symphony — AT-song-slot aware via libram song helpers);
   zone-element resistance (current `usefulEffects` list pruned per zone).
2. **Restores**: `myMp() < 1.5 × mpBudgetPerFight` → `restoreMp(min(myMaxmp(), 3 × mpBudgetPerFight))`;
   `myHp() < 60% × myMaxhp()` → `restoreHp(myMaxhp())`. Both ride mafia's restore
   machinery with the curated item lists; auto-triggers stay disabled.
3. **Fishy**: if Fishy is down and the fishy pipe is owned & unused today, use it.
   Otherwise accept 2-adventure fights. No organ-based Fishy in v1.
4. **Passive MP income**: the CMoI's 8–12 MP regen/adventure (when equipped) plus the
   maximizer's `0.05 mp regen` weight are counted by the restore check naturally (it
   reads `myMp()` fresh each `prepare()`); no special handling needed.

## Guards

- Task `ready()`: `!isOverDrunk()` (sober-only v1), `canAdventure(loc)` (covers The Sea's
  level gate without hard-coding 15-vs-20), and turn budget:
  `myAdventures() − args.halt ≥ ceil(remainingProgress / expectedProgress) × (fishy ? 1 : 2)`
  with `expectedProgress = clamp(1.7 × floor(plannedRes / 3), 1.7, 10)`. `plannedRes`
  before dressing is optimistic (18) so `ready()` doesn't block on naked resistance; after
  the first dress, `post()` records the _actual_ per-fight progress delta from the
  `_...Progress` pref and the budget check switches to observed rate — if the observed
  rate makes remaining turns exceed budget, the task stops being ready (skips, no abort).
  Never start (or continue) a zone rollover will erase.
- `completed()`: the zone's `_unblemishedPearl<Zone>` pref (mafia-tracked, in libram's
  typed prefs).
- `limit: { soft: 30 }` per zone task.
- Engine mutations reverted by `destruct()` in `finally`.

## Testing / verification

- `yarn lint && yarn build` clean.
- `pearlo sim`: capability report, no spending — breathing source found; res reachability
  via `currentMaximizerScore("cold res 18 max, sea")`; Saucegeyser damage estimate,
  casts/fight, MP budget; Fishy source; turn budget verdict.
- Live run on the reference Pastamancer: expect ~10–20 fights in The Briniest Deepests
  ending with the pearl pref true; session summary printed; properties restored after.
- No unit tests: nothing executes outside mafia — `sim` is the harness.

## Decisions log

- Zone order default `spooky,sleaze,hot,stench,cold` (user); v1 tests cold only.
- Restore pattern: user-supplied `initPropertiesManager` snippet (free rests banned,
  tonic added, auto-triggers off, explicit restores). `shadowLabyrinthGoal` dropped as
  out-of-scope.
- `mood.ts` not `sustain.ts` — mood is the idiom (user).
- Accordion Bash / Rain-Doh excluded from combat plans (user). Round-1 kill philosophy;
  parka preferred baseline; nematocysts are the stench-zone stun when that zone arrives.
- No +ML anywhere (stun-resistance threshold; no benefit).
- Lanterns + Congressional Medal of Insanity added to the outfit/damage plan (user).
  Lantern damage modeled conservatively (pre-multiplier duplication) until spaded.
  Reference: `Lanterns` wiki mechanics — duplication compounds across chained lanterns,
  applied before monster resistance (irrelevant here: no resistances in pearl zones).
- Retro cape in Heck General + Kill Me = back-slot spooky lantern (user); preferred over
  its Hold Me stun config under the round-1-kill philosophy (parka supplies the stagger).
- Post-review amendments (user, 2026-08-07): effect lists sorted by verified enchantments
  (only 6 of 20 grant resistance; Blood Bond dropped for its HP drain); **always run a
  familiar** — ladder: elemental res (Cooler Yeti cold +1/11 lbs / Exotic Parrot / Mu) >
  holding hands with lantern or maximizer-filled res slot > utility innate breathers
  (Magic Dragonfish, Space Jellyfish, Barrrnacle, Emo Squid). `src/familiar.ts`.
- Two-pass outfitting (user, 2026-08-07): pass 1 speculates
  `"<element> res 18 max 18 min, sea"` without familiar help; if the cap needs the
  familiar, the outfit string gains `switch <familiar>` directives (res familiars +
  holding hands) and the maximizer picks — `sea` makes it enforce Underwater Familiar
  (boot-equip or reject) on its own. If the cap is met alone, the slot pivots to
  damage/utility per the ladder.
