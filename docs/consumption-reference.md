# KoL Organ Mechanics: Fullness / Drunkenness / Spleen

Compiled 2026-08-06 from the KoL wiki (MediaWiki API): `Fullness`, `Drunkenness` (includes
`Falling-down drunk` redirect), `Spleen`, `Drinking Mechanics`, `Drunken Stupor`,
`Drunkula's wineglass`, `Ode to Booze`, `Stooper (familiar)`, `mojo filter`,
`distention pill`, `synthetic dog hair pill`, `cuppa Sobrie tea`, `milk of magnesium`,
and the Liver/Stomach/Spleen of Steel pages. Wiki-unstated things are marked **[NOT STATED]**.

Why pearlo cares: Fishy and air-supply effects come from food (sushi, fish meats), booze
(Centauri fish wine, salinated mint julep), and spleen items (fishy paste, Sea jelly,
powdered oxygen, mer-kin paste) — so organ budgeting gates the underwater turn economy, and
the overdrunk/wineglass/Stooper rules constrain outfits and combat macros directly.

---

## 1. Script-facing API (verified in local typings)

```ts
// kolmafia
myFullness(); fullnessLimit();      // stomach used / capacity
myInebriety(); inebrietyLimit();    // liver used / capacity
mySpleenUse(); spleenLimit();       // spleen used / capacity
canEat(); canDrink();               // false for Teetotaler/Oxygenarian-style restrictions
// libram
getRemainingStomach(); getRemainingLiver(); getRemainingSpleen();
```

**Never hard-code organ capacities (user directive).** The base values below (15/14/15) are
wiki context only — skills, familiars, equipment, and paths all shift them, sometimes
mid-day (Stooper active or not, Pantsgiving procs, angelbone/devilbone gear on or off).
Always query `fullnessLimit()` / `inebrietyLimit()` / `spleenLimit()` at the moment of the
decision, never a constant.

Correct predicates for the `src/lib.ts` stubs (per Drinking Mechanics):

```ts
isStomachCapped = myFullness() >= fullnessLimit();
isLiverCapped   = myInebriety() >= inebrietyLimit();
isSpleenCapped  = mySpleenUse() >= spleenLimit();
isOverDrunk     = myInebriety() > inebrietyLimit();   // strictly greater: 15+ at base 14
```

Per-item fit checks: a food/spleen item of size `s` is refused when `used + s > limit`
(all-or-nothing, no partial). Booze is the exception — a drink that crosses the limit
**succeeds** (that's how you overdrink); only *starting* a drink while already overdrunk is
refused ("You're way too drunk already.").

## 2. Capacities and rollover

| Organ | Base cap | Overcap possible? | Over-cap state | Resets at rollover |
|---|---|---|---|---|
| Stomach | **15** | No (eating just fails) — only quantum-taco/path-end edge cases | **Food Coma** only; cannot adventure (since silent update Dec 16, 2025) | yes, to 0 |
| Liver | **14** (adventuring limit) | **Yes, deliberately** — the crossing drink succeeds | **falling-down drunk** (see §3) | yes, to 0 |
| Spleen | **15**, "cannot be exceeded" | Only by *losing capacity* (unequip a +spleen item, path end) | **jaundiced**: cannot adventure, only Strangers With Medical Advice | yes, to 0 |

No class-based capacities exist — flat 15/14/15 for everyone; only paths/skills/items modify
them. Being *at* cap has no penalty for any organ.

**Capacity modifiers (non-path highlights)**
- Stomach: Stomach of Steel +5 (steel lasagna; persists post-King, unpermable); lupine
  appetite hormones +3 (day); Pantsgiving up to +3 (5th/50th/500th/5000th combat of the day,
  only while currently full, pants must be equipped); cuppa Voraci tea +1 (day); distention
  pill +1 (1/day); sweet tooth +1 (day); Angelbone chopsticks / Devilbone corset +1
  (while equipped). Feast of Boris +15 (holiday).
- Liver: Liver of Steel +5 (steel margarita; overdrunk threshold becomes 20+); Hollow Leg +1
  (until ascension); Drinking to Drink +1; **Stooper familiar +1 (only while active)**;
  Angelbone dice / Devilbone rosary +1 (while equipped).
- Spleen: Spleen of Steel +5 (Oxygenarian only); still-beating spleen +1 (per ascension);
  angelbone totem / devilbone greaves +1 (while equipped).

**Organ cleaners**: mojo filter −1 spleen (3/day); extra-greasy slider −5 spleen (+5 full);
jar of fermented pickle juice −5 spleen (+5 drunk); cuppa Sobrie tea −1 drunk (1/day);
synthetic dog hair pill −1 drunk (1/day); Sweat Out Some Booze −1 drunk (25 sweat, 3/day);
spice melange −3 full & −3 drunk; Ultra Mega Sour Ball −3/−3 (stacks with melange);
alien animal milk −3 full; Alien plant pod −3 drunk (1/day).

**Adventure economics**: **Ode to Booze** grants +1 adventure per point of drunkenness the
booze gives (consumes that many Ode turns; no effect on 0-adventure booze). milk of
magnesium: +5 adventures on the next food, 1/day, charge survives rollover.

## 3. Falling-down drunk: exactly what changes

Threshold: drunkenness **> limit** (15+ at base 14; 20+ with Liver of Steel). The char-pane
message appears at ≥ limit; the warning tier starts within 5 of the limit. Standard strategy:
overdrink at end of day so rollover clears the drunkenness while the adventures keep.

**Blocked while overdrunk**: normal adventuring in most zones (you get Drunken Stupor: −3
mox/−3 mus, −10 meat), drinking more booze, familiar arena training, Fernswarthy's Basement,
Tavern rats, BRICKO fights, **mining — explicitly including Anemone Mine (Mining)**, and more.

**Still allowed**: cooking/cocktailcrafting/smithing, resting, Deck of Every Card, Boxing
Daycare, combat via free-fight sources (putty/copied monsters, locket 3/day, wishes 3/day,
drum machine, Eldritch Tentacle, Burning Leaves, molehill mountain, etc.).

**[NOT STATED]**: nothing on these pages blocks equipping items or changing outfits while
overdrunk; also nothing blocks eating food or using spleen items while overdrunk (only more
booze is refused). Don't code restrictions the wiki doesn't state.

### Drunkula's wineglass — the outfit/combat coupling

The wineglass (**off-hand**) lets you "do most normal adventures" while falling-down drunk —
the standard overdrunk-farming enabler. Its costs, overdrunk or not:

- **Any in-combat skill or combat item use is converted into a plain weapon attack** ("You're
  way too drunk to -hic- do whatever it was..."). Out-of-combat skills still work.
- Pickpocket and Run Away still function.
- It does not bypass hard gates (Tavern Cellar, BRICKO, the Tower's "Too drunk!" check).

**The wineglass works underwater — user-confirmed in-game (2026-08).** Overdrunk pearl
farming is therefore a real strategy, with these consequences:
- The combat macro degenerates to `attack().repeat()` — which is **fatal against the
  acoustic electric eel** (melee counter ~89–100 HP per landed hit) and defenseless against
  the pufferfish poison (no stun possible). Overdrunk pearl farming in those zones needs
  those monsters banished/avoided, or those zones skipped/finished before overdrinking.
- The wineglass occupies the off-hand, competing with off-hand utility (e.g. April Shower
  Thoughts shield swaps in `tryAcquiringEffect`); breathing hats/back items are unaffected.

### Stooper vs underwater

Stooper grants +1 liver **only while active**. It has no innate water-breathing, but —
**user-confirmed (2026-08)** — like any familiar it works underwater with a familiar
breathing enabler: **Driving Waterproofly** (covers the familiar for free), **das boot**
(−10 fam weight), or **little bitty bathysphere** (−20 fam weight). So Stooper *can* be the
pearl-zone familiar when the +1 liver matters; with Waterproofly there's no weight penalty.
Swap-out caution (mirrors the spleen jaundice rule): switching away from Stooper while
drunkenness sits at the raised cap leaves you over cap.

## 4. Planning rules for pearlo

1. Budget organs around Fishy first: it's the 2×-turn lever. Cheap Fishy per organ: fishy
   pipe (free, 1/day, 10 adv), sushi (stomach), Centauri fish wine (liver, 60 adv Fishy for
   2 drunk), fishy paste / Sea jelly / Fish sauce (spleen).
2. Air-supply effects from spleen (mer-kin paste 4 spleen, powdered oxygen 3 spleen) compete
   with Fishy spleen items — track both against `getRemainingSpleen()`.
3. Overdrunk pearl farming works (wineglass confirmed underwater) but forces
   attack-only combat — plan zone order so eel/pufferfish zones are done sober, or banish
   those monsters; otherwise treat `isOverDrunk()` as end-of-day.
4. Jaundice guard: don't unequip +spleen equipment while spleen is at cap; don't switch away
   from Stooper while drunkenness sits at the raised cap.
5. Eating/drinking order: apply milk of magnesium and Ode to Booze *before* the relevant
   consumable; overdrink only as the final action of the day.
6. Never compare against literal 15/14/15 — capacities are dynamic; always read
   `fullnessLimit()`/`inebrietyLimit()`/`spleenLimit()` (or libram's `getRemaining*`) fresh.
