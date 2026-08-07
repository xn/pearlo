# KoLmafia Modifier Maximizer Reference

Compiled 2026-08-06. Sources: wiki.kolmafia.us `Modifier_Maximizer` (**stale — discrepancies
listed in §6**), KoLmafia's in-app help (`src/data/maximizer-help.html`), and current `main`
source (`maximizer/{Evaluator,Maximizer,PriceLevel,EquipScope}.java`, `RuntimeLibrary.java`),
plus merged PRs ~2024-08 → 2026-07. Where wiki and source disagree, source wins.

pearlo hits the maximizer through grimoire `OutfitSpec.modifier` and libram
`maximizeCached` / `Requirement` — all of which pass expression strings documented here.

## 1. Expression syntax

- Comma-separated keywords, each optionally `+`/`-` and a numeric weight (floats fine).
  Bare keyword = weight 1; `-` = −1. Whole expression lowercased. Quote keywords containing
  digits or `+`/`-` (`"spooky resistance"` is fine unquoted; quoting is for odd names).
- Score = Σ weight × min(value, per-modifier max), over current effects + speculated gear.
- **`N min` / `N max` are separate keywords attaching to the _previous_ numeric keyword**:
  - `spooky res 18 max` → resistance beyond 18 contributes **exactly nothing** to the
    score. This is pearlo's core idiom: **the right pearl objective is
    `"<element> res 18 max"`** — it stops the maximizer from trading anything for res #19.
  - `18 min` sets a failed flag if unreachable — **the best outfit is still equipped**;
    `maximize()` just returns `false`. Use it only as a failure signal
    (`spooky res 18 max 18 min`), not as a guard.
  - A leading `N max` (no preceding modifier) caps the _total_ score and stops enumeration
    early — a real speed win when usable.
  - Limits on negatively-weighted modifiers "won't quite work as expected" (help text's own
    words; exact semantics undocumented).
- Abbreviations verified in `Evaluator.parse`: `mus/mys/mox/mainstat`, `hp/mp`, `ml`,
  `da/dr`, `init`, `com` (combat rate), `item`, `meat`, `adv`, `exp`, `crit`, `spell crit`,
  `fites`, `stomach/liver/spleen`. Suffix rewrites make `X res` ≡ `X resistance`,
  `X dmg` ≡ `X damage`. Aliases: `all res`, `elemental damage`, `hp regen`, `mp regen`,
  `passive damage`, `organ capacity`.
- Boolean modifiers work as keywords (positive = require true, negative = require false).
- `-tie` disables the tiebreaker (and implicitly enables `current` unless overridden). The
  wiki's tiebreaker listing is outdated vs source.
- Debug: `dump` / `2 dump` print the per-slot consideration lists (in-app help only).

## 2. Equipment directives

- **Slot restriction**: `hat, weapon, offhand, back, shirt, pants, acc1-3,
familiar`/`familiarequip`, `holster`, `crown-of-thrones`, `buddy-bjorn`, `card-sleeve`,
  `bootskin`, `bootspur`, `hats`. Positive = only these slots may change; negative = all
  but these (`maximize meat, -acc1`).
- `empty` — only currently-empty slots (+) or non-empty (−).
- `equip <item>` / `-equip <item>` — required / forbidden (this is how grimoire's
  `avoid: [Mer-kin digpick]` is implemented under the hood). `N bonus <item>` adds N to the
  score when worn (grimoire `bonuses` map). Both accept item modes in parentheses since
  PR #3559: `+equip backup camera (ml)` — conflicting modes are a hard error, and explicit
  modes must come **before** keywords that install default modes (`sea` → edpiece fish,
  `shield` → umbrella forward).
- `outfit <name>` / `-outfit <name>`; bare `+outfit` keeps the current outfit.
- Weapon-type: `melee`, `effective` (weapon type suited to your better attack stat; also
  can't-miss attacks since PR #3296), `handed`, `type <x>`, `club/sword/knife/utensil/
accordion`, `shield` (implies 1-handed).
- `current`/`-current`: whether currently-worn gear is considered (default on in
  HC/Ronin; `maximizerAlwaysCurrent` pref).
- **Familiars**: `switch <familiar>` lets the maximizer compare/switch familiars
  (`switch hobo monkey, -switch leprechaun` = fall back only if the first is unavailable).
  Nothing switches unless asked.
- **Left-Hand Man / Disembodied Hand / Hatrack / Scarecrow are modeled**: the evaluator
  budgets an extra off-hand when Left-Hand Man is in play (etc.), and since PR #3491
  `equip X`/`bonus X` requirements can be satisfied _via_ the Left-Hand Man — which also
  means the maximizer may route a forced item to the familiar's hands instead of yours.
- There is no `none`/`unequip` keyword (unequipping is internal).

## 3. Underwater keywords (pearlo-critical)

- **`sea`** = require the boolean modifiers **Adventure Underwater** AND **Underwater
  Familiar**, plus default the Crown of Ed to fish mode. The two booleans can also be
  required individually by name.
- ⚠ **`sea` resets the "previous modifier" pointer — write `spooky res 18 max, sea`,
  never `spooky res, sea, 18 max`** (the latter attaches the cap to nothing).
- The maximizer does **not** infer water-breathing from your location. Always pass `sea`
  (or forceEquip breathing gear) for pearl-zone outfits. Only location nicety: when the
  current location is underwater, `combat rate` also weights `underwater combat rate`.
- Boost suggestions (potions, wishes since #3075) are **suggestions only** — ASH/JS
  `maximize()` equips equipment and applies nothing else. Effect acquisition stays the
  script's job (`tryAcquiringEffect` in `src/lib.ts`).

So a pearl-zone modifier looks like:
`"spooky res 18 max, sea, 0.1 init"` (+ optionally `switch exotic parrot`,
`-equip Mer-kin digpick` — though grimoire's `avoid`/`familiar` fields express those).

## 4. ASH/JS `maximize()` semantics

```ts
maximize(str, speculateOnly); // ≡ (str, 0, 0, speculateOnly)
maximize(str, maxPrice, priceLevel, speculateOnly); // boolean
//   maxPrice <= 0 → falls back to autoBuyPriceLimit
//   priceLevel: 0 = DONT_CHECK, 1 = BUYABLE_ONLY, 2 = ALL
maximize(str, maxPrice, priceLevel, speculateOnly, showEquipment); // boost record[]
maximize(str, maxPrice, priceLevel, equipScope, filters); // PR #3287 overload
//   equipScope: -1 EQUIP_NOW, 0 SPECULATE_INVENTORY, 1 +CREATABLE, 2 ANY
//   filters: substring list of {equip, cast, wish, usable, booze, food, spleen, other}
currentMaximizerScore(expr); // score current state without enumeration (PR #3287)
```

- **The boolean return is `!failed`** — `false` means a `min`/boolean/outfit requirement
  was unmet, _not_ that nothing was equipped. The best-found gear is equipped regardless
  (when not speculating). Grimoire's `Outfit.dress()` does its own post-verification and
  throws, which is the stronger guard.
- `currentMaximizerScore("spooky res 18 max, sea")` is the cheap way to ask "am I already
  at cap with breathing gear?" before re-running enumeration.
- Behavior preferences: `maximizerFoldables` (default true), `maximizerCreateOnHand`,
  `maximizerCurrentMallPrices`, `maximizerCombinationLimit` (**default 0 = unlimited**;
  wiki's "100000" is wrong), `maximizerNoAdventures`, `verboseMaximizer`.
- libram's `maximizeCached(objectives, options)` wraps this with objective/state caching —
  prefer it in loops; `Requirement` merges `forceEquip`/`preventEquip`/`bonusEquip`/
  `preventSlot`/`modes` into the string, and is what grimoire Outfit uses internally.

## 5. Recent maximizer changes (merged PRs)

- **#3559** item modes in `equip`/`bonus` expressions; ordering vs `sea`/`shield` matters.
- **#3558** stops flipping modes of items in excluded slots; **#3571** no more random mode
  swaps when no positive score exists.
- **#3509** `-tie` + weapon-type keywords used to recommend nothing; fixed (needs a
  recent build if combining those).
- **#3491** `equip`/`bonus` satisfiable via Left-Hand Man (slot routing may surprise).
- **#3443** unarmed bonuses considered; **#2948** forcing an off-hand unequips a 2-handed
  weapon.
- **#3396** `stomach/liver/spleen/organ capacity`; **#2886** `combat rate` as double
  modifier; **#2950/#2951** `stinky cheese`; **#2405** MCD.
- **#3287** advanced overload + `current_maximizer_score` + wish-filter fix.
- **#3075/#3081/#3152** wish/genie boosts appear in suggestion lists — filter via the
  `filters` arg if consuming boost records programmatically.
- **#3432/#2911** mutually-exclusive-effect handling improved (wiki's blanket "not handled"
  claim is obsolete, but scope undocumented — don't lean on exotic mutexes).
- Path/content gating fixes: **#3451** Thrifty, **#3442** Wet Crap → 11,037 Leagues only,
  **#3422** campaway cloud, **#2924** Hat Trick `hats` slot, **#2849** Zootomist.

## 6. Known wiki-vs-source discrepancies

Wiki omits: `surgeonosity`, `stinky cheese`, `dump`, organ keywords, item modes, boost
filters, newer ASH overloads. Wiki's `maximizerCombinationLimit` default and tiebreaker
string are wrong vs current source. Undocumented/ambiguous: which slot wins for Left-Hand
Man-routed `equip` after #3491; `min` semantics on negatively-weighted modifiers.
