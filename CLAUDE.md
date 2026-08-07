# CLAUDE.md

## Do not guess about game facts — verify or ask

Kingdom of Loathing is dense with puns and deliberately surprising mechanics. Plausible-sounding
inference is unreliable here: item, effect, skill, monster, and zone names are jokes
(`Fishy`, `tempura air`, `das boot`, `Mer-kin digpick`), and mechanics frequently subvert the
obvious pattern (a zone's "expected" counter-strategy may be a pun, not the elemental logic
you'd assume). An invented name won't just be wrong — `$item`/`$effect` template tags throw at
load time on unknown names, and made-up preference names silently misbehave.

Before writing anything that depends on a game fact (a name, a drop, a mechanic, a number,
a preference, a choice-adventure option):

1. **Check local ground truth**: `node_modules/kolmafia/index.d.ts`,
   `node_modules/libram/dist/propertyTypes.d.ts` (all known preference names), and libram's
   resource modules. If a name isn't there, it's probably wrong.
2. **Check the wiki** via the API (see Research resources below).
3. **Ask the user** — they know the game. When the wiki is ambiguous, when you're choosing
   between strategies that depend on mechanics you haven't verified, or when a mechanic
   seems to matter but you can't confirm how it works, stop and ask rather than proceeding
   on an assumption. Asking is always preferred over a confident guess.

## Project overview

**pearlo** is a Kingdom of Loathing (KoL) farming script that collects unblemished pearls from
the five Sea Floor zones (Anemone Mine, The Dive Bar, The Marinara Trench, Madness Reef, The
Briniest Deepests). It is written in TypeScript, bundled with rollup, and executed *inside
KoLmafia's embedded JavaScript (Rhino) runtime* — not Node. It is built on three libraries:

- **`kolmafia`** — ambient type declarations for KoLmafia's JS standard library (the runtime provides the real implementations)
- **`libram`** — ergonomic helper layer: `$item`-style constants, typed preferences, `Macro` combat DSL, per-IOTM resource modules
- **`grimoire-kolmafia`** — declarative Task/Engine framework that drives the script

## Commands

```sh
yarn build          # rollup bundle
yarn watch          # rollup --watch
yarn lint           # eslint + prettier check
yarn format         # eslint --fix + prettier --write
yarn install-mafia  # build + copy bundle into KoLmafia's scripts directory
```

Yarn 4 (`packageManager: yarn@4.4.1`). `eslint-plugin-libram` is enabled — it validates
`$item`/`$effect`/etc. names at lint time and requires template constants be hoisted to
module level. Run `yarn lint` after changes; there are no unit tests (nothing in the
`kolmafia` package is executable outside mafia — every stub throws).

## Source layout

- `src/main.ts` — entry point (currently a stub)
- `src/pearls.ts` — the `PearlsQuest` grimoire Quest: a "Breathe Underwater" task (ballast
  turtle → seal lung → potion of pneumaticity → tempura air → Asdon Waterproofly → fall back
  to equipping breathing gear via `_subAquaEquipBreathing`) plus one task per pearl zone,
  driven by a `PearlSpec` table (location, elemental-res modifier, custom `_unblemishedPearl*`
  progress/obtained preferences)
- `src/args.ts` — `Args.create("pearlo", ...)` CLI scaffolding; `toTempPref(name)` builds
  `_pearlo_<name>` preference names
- `src/lib.ts` — `tryAcquiringEffect`/`canAcquireEffect` (parses `Effect.default` CLI strings,
  handles April Shower Thoughts shield, Powerful Glove, Heartstone swaps), Asdon fueling
  helpers (`asdonFualable`, `fuelUp`)
- `src/combat.ts`, `src/outfit.ts` — stubs (combat macros, familiar/outfit selection)

### Pearl mechanics (verified against wiki: [Unblemished pearl])

- After each combat in a pearl zone, progress accrues: **1.7% × floor(elemental resistance / 3)**,
  minimum 1.7%, **maximum 10% at 18 resistance** per combat. At 100% the pearl drops (flavor
  text: "shiny thing"). Negative resistance can give negative progress.
- Zone → element: Anemone Mine = Spooky, The Dive Bar = Sleaze, Madness Reef = Stench,
  The Marinara Trench = Hot, The Briniest Deepests = Cold (matches the `PEARLS` table in
  `src/pearls.ts`).
- **One pearl per zone per day**; progress does **not** persist through rollover — a partial
  zone left unfinished at rollover is wasted turns.
- So the target is 18 elemental resistance (maximizer objective) → 10 combats minimum per
  zone. Five pearls are needed to confront the Nautical Seaceress in the "11,037 Leagues
  Under the Sea" challenge path.
- **Underwater adventures cost 2 turns each unless the Fishy effect is active** — so a
  capped pearl costs ~20 adventures without Fishy, ~10 with it (~100 vs ~50/day for all
  five zones). Maintaining Fishy is the biggest efficiency lever.
- The zones carry heavy **pressure penalties** to meat/item drops and initiative: −200%
  (Anemone Mine, Dive Bar, Marinara Trench), −100% (Madness Reef), −75% (Briniest
  Deepests); most breathing equipment adds its own −item/−init penalties. Pearl farming
  should not expect meaningful drop income.
- Full zone/monster/mechanics reference (encounters, monster stats, drops, mandatory macro
  branches like "never melee the acoustic electric eel" and "stun the pufferfish round 1",
  plus resistance-support familiars — Left-Hand Man / Disembodied Hand for extra equipment
  slots, Exotic Parrot / Mu for weight-scaled resistance, all needing Driving Waterproofly
  underwater since das boot competes with their famequip slot):
  **`docs/sea-reference.md`** — read it before writing combat macros or outfits. Note
  grimoire's `Outfit.equip()` auto-switches to Left-Hand Man / Disembodied Hand when asked
  to equip a second off-hand / extra weapon. §6 covers stunning: stagger vs stun vs block,
  stun resistance comes from **bonus** ML (+51 starts it — run zero +ML), anemone
  nematocyst stuns 3–4 rounds in the sea, and the retro superhero cape (Heck General)
  auto-stuns 3 rounds at combat start but competes with the SCUBA tank for the back slot.
  The **Jurassic Parka** (shirt, needs Torso Awaregness) is the preferred combat-control
  baseline: automatic round-1 stagger every combat plus one mode per element (+3
  in-element resistance), in an otherwise uncontested slot; set via
  `modes: { parka: "..." }` (prefs `parkaMode`, `_spikolodonSpikeUses`). Accordion Bash
  and Rain-Doh are ruled out as stun solutions (user decision: weapon-slot cost / rarity).
  §7 covers deleveling (each point of Defense removed ≈ +9.1% hit chance; Attack
  deleveling cuts both damage terms; does NOT fix stun resistance). Combat plan layers:
  round-1 one-shot → parka stagger/stun cover → deleveling for safe fallback rounds.
  ⚠ Mer-kin weaksauce is a sushi ingredient, not a deleveler (the deleveler is Mer-kin
  mouthsoap).
- Organ mechanics (stomach/liver/spleen caps, overdrunk rules, Drunkula's wineglass
  skill-suppression, correct predicates for the `isLiverCapped`/`isOverDrunk` stubs in
  `src/lib.ts`): **`docs/consumption-reference.md`** — read it before writing
  diet/consumption code or overdrunk guards. Key couplings: Fishy comes from
  food/booze/spleen items so organ budget gates the 1-vs-2-turn economy; the wineglass
  works underwater (user-confirmed) but turns all combat skills into plain attacks (fatal
  vs the electric eel); Stooper works underwater with a familiar breathing enabler.
  **Never hard-code organ capacities** — always query `fullnessLimit()` /
  `inebrietyLimit()` / `spleenLimit()` at runtime.
- Maximizer expression syntax (verified against KoLmafia source + recent PRs, since the
  kolmafia wiki page is stale): **`docs/maximizer-reference.md`**. The pearl-zone idiom is
  `"<element> res 18 max, sea"` — `18 max` makes resistance past the cap worth zero, and
  `sea` requires Adventure Underwater + Underwater Familiar. **Order matters: `18 max`
  must come before `sea`** (`sea` resets the keyword the cap attaches to). `maximize()`
  returning false means a requirement was unmet but gear was still equipped; use
  `currentMaximizerScore()` for cheap "already at cap?" checks.
- Mafia tracks progress in `_unblemishedPearl<Zone>Progress` (numeric) and the daily drop in
  `_unblemishedPearl<Zone>` (boolean) — both in libram's typed prefs.

### Design decisions (from the user, 2026-08)

- **Scope**: support both the "11,037 Leagues Under the Sea" path and aftercore daily
  farming, but **aftercore daily farming is the first priority**.
- **Meat spending for resistance**: configurable. **Default is free/owned resources only**;
  a user-set price cap arg overrides that to allow mall purchases toward 18 res.
- **Turn budgeting**: do **not** start a zone the character can't finish before running out
  of adventures (~10+ needed at the 10% cap) — partial progress is wasted at rollover.
- **Zone selection**: the planned `pearls=spooky,sleaze,hot,stench,cold` arg (see comment in
  `src/args.ts`) selects an ordered subset of zones — no duplicates, subset ok, that order
  is the default.

Underwater specifics: adventuring in these zones requires water breathing
(`booleanModifier("Adventure Underwater")` or equipment) and pearl-relevant buffs; familiars
need their own breathing equipment (`das boot`, `little bitty bathysphere`) or
`Familiar.underwater === true`.

---

## Library: `kolmafia` (ambient runtime typings, v5.29133.0)

Generated from KoLmafia **r29133**. ~800 functions + 19 classes in `index.d.ts`. The shipped
`index.js` is stubs that throw — the real implementations are injected by KoLmafia when it
loads the bundle. **`kolmafia` must stay `external` in rollup** so the bundle keeps a literal
`require("kolmafia")`; if it gets inlined every call throws at runtime.

### Enumerated-value classes

`Item`, `Familiar`, `Effect`, `Skill`, `Location`, `Monster`, `Class`, `Path`, `Slot`, `Stat`,
`Phylum`, `Element`, `Thrall`, `Servant`, `Coinmaster`, `Bounty`, `Modifier`, `Vykea` — all
share `static get(name | id)`, `static get(names[])`, `static all()`, `static none`. Instance
props are readonly; notable: `Item.tradeable/.quest/.seller`, `Location.environment`
(`"underwater"` etc.)/`.turnsSpent`/`.combatPercent`, `Familiar.underwater/.dropsToday/.dropsLimit`,
`Effect.default` (CLI command that grants it) / `Effect.all` (all ways to acquire),
`Skill.dailylimit/.timescast`. Prefer libram's `$item`-style tags over `Item.get` in source.

### Key functions (all camelCase; ASH docs use snake_case — translate)

```ts
// Adventuring / combat
adventure(loc: Location, count: number, filter?: string | ((round, monster, text) => string)): boolean
adv1(loc: Location, adventuresUsed?: number, filter?): boolean
runCombat(filter?): string;  runChoice(decision: number, extra?): string
visitUrl(url?: string, usePostMethod?: boolean, encoded?: boolean): string
canAdventure(loc): boolean;  handlingChoice(): boolean;  lastChoice(): number
inMultiFight(): boolean;  choiceFollowsFight(): boolean;  setAutoAttack(v): void

// Character state
myAdventures(); myMeat(); myTurncount(); myLevel(); myHp(); myMaxhp(); myMp()
myClass(): Class;  myFamiliar(): Familiar;  haveEffect(e: Effect): number  // turns left
haveSkill(s: Skill): boolean;  myFullness(); myInebriety(); mySessionMeat()

// Items
availableAmount(i): number   // inventory + closet + equipped (per settings)
itemAmount(i): number;  closetAmount(i);  creatableAmount(i)
retrieveItem(i: Item, count?: number): boolean   // acquire by any configured means
buy(i, qty?): boolean;  buy(i, qty, maxPriceEach): number  // returns count bought
use/eat/drink/chew(i, count?): boolean;  autosell(i, count): boolean
mallPrice(i): number;  historicalPrice(i);  historicalAge(i)
putCloset/takeCloset(i, count?);  putShop(price, limit, i)

// Equipment / skills / familiars
equip(i: Item, slot?: Slot): boolean;  equippedItem(slot): Item;  haveEquipped(i): boolean
canEquip(i): boolean;  useSkill(s, count, target?): boolean;  cliExecute(cmd: string): boolean
useFamiliar(f): boolean;  familiarWeight(f): number;  weightAdjustment(): number

// Maximizer / modifiers
maximize(str: string, speculateOnly: boolean): boolean
numericModifier(...)/booleanModifier(...)/effectModifier(...)  // many overloads

// Properties (raw — values are strings; prefer libram get/set)
getProperty(name): string;  setProperty(name, value): void

// Misc
print(s?, color?): void;  printHtml(s): void;  abort(msg?): never
todayToString(): string /* yyyyMMdd */;  gametimeToInt(): number
batchOpen(): void; batchClose(): boolean   // batch bulk closet/mall requests
```

### Gotchas

- **camelCase here, snake_case in ASH/wiki docs** (`my_adventures` → `myAdventures`).
  Preference names passed as strings stay verbatim.
- Most functions accept **arguments in either order** (`(item, count)` and `(count, item)`
  overloads, an ASH legacy). Pick one convention and stick to it.
- **Nearly everything is a synchronous, blocking server hit** (`adventure`, `buy`, `use`,
  `equip`, `mallPrice`, `visitUrl`). Inside loops prefer cached data (`itemAmount`,
  `haveEffect`, `historicalPrice`) and wrap bulk operations in `batchOpen()`/`batchClose()`
  (or libram's `withBatch`).
- After a raw `visitUrl` that changes state, mafia may not have re-parsed — call
  `refreshStatus()` or use the proper API function instead.
- **Choice adventures**: mafia auto-answers from `choiceAdventureNNN` properties (set via
  grimoire's `choices` task field or libram's `withChoice`). Manual: `handlingChoice()` /
  `lastChoice()` / `runChoice(n)`. Never leave a chained choice/fight unresolved.
- Combat `filter` is a CCS name or a callback returning a command string (`"attack"`,
  `"skill Saucegeyser"`); libram `Macro`s are usually cleaner.
- There is **no `uneffect()` function** in this build — use libram's `uneffect` or
  `cliExecute("uneffect ...")`.
- `abort()` is typed `never` and kills the whole script — don't use it for recoverable errors.

---

## Library: `libram` (v0.11.23)

Helper layer on top of `kolmafia` (peer dep `^5.28100.0`). ESM, tree-shaken by rollup.

### Template-string constants

Resolve names at module-load time — typos throw immediately rather than yielding `none`:

```ts
$item`ballast turtle`                    // Item
$items`das boot, little bitty bathysphere`  // Item[], comma-separated
$items``                                 // EMPTY template = ALL items
$effect`Fishy`  $skill`Empathy of the Newt`  $location`Madness Reef`
$familiar`...` $monster`...` $slot`offhand` $stat`Muscle` $class`Sauceror` $phylum`fish`
```

All singular tags have `.none` and `.get(name)` (nullable); plurals have `.all()`. Full set:
`$bounty $class $coinmaster $effect $element $familiar $item $location $modifier $monster
$path $phylum $servant $skill $slot $stat $thrall` + plural forms. Hoist to module level
(lint-enforced).

### Typed properties

`get`/`set` are typed against generated unions of every known mafia preference —
`get("_sausagesEaten")` is `number`, `get("kingLiberated")` is `boolean`,
`get("lastAdventure")` is `Location | null`. Custom/unknown prefs need an explicit default:
`get("_pearlo_foo", 0)`. Exported types `BooleanProperty`, `NumericProperty`, etc. are the
string-literal unions of known pref names — `PearlSpec` in `src/pearls.ts` uses them to type
its pref fields; the `_unblemishedPearl*` prefs are mafia-tracked and present in the unions.
Script-local prefs (e.g. from `toTempPref`) are not, so read them with explicit defaults.

- `setProperties({...})`, `withProperty/withProperties(props, cb)`,
  `withChoice/withChoices(n, v, cb)` — restore prior values after `cb`.
- `PropertiesManager` — stateful set/reset (`.set({...})`, `.setChoices({...})`,
  `.resetAll()`). Grimoire's Engine owns one (`engine.propertyManager`); route temporary
  property changes through it so `destruct()` reverts them.

### Core helpers

- `have(thing, quantity = 1)` — Item (availableAmount), Effect (turns), Skill (known),
  Familiar (in terrarium). IOTM modules export their own zero-arg `have()` (`Witchess.have()`).
- `Macro` — fluent BALLS combat-macro builder. Instance & static forms of: `.skill()`,
  `.trySkill()` (skip if uncastable), `.trySkillRepeat()`, `.item()`, `.tryItem()`,
  `.attack()`, `.repeat()`, `.runaway()`, `.abort()`, `.if_(cond, m)` (compiled, evaluated
  in-combat), `.externalIf(jsBool, m)` (evaluated at build time), `.while_()`, `.step()`,
  `.submit()`, `.setAutoAttack()`, `.save()`/`Macro.load()`. **No `.kill()`** — compose
  `.trySkill(...).attack().repeat()`. `StrictMacro` rejects bare strings (Skill/Item objects
  only) — prefer it. With grimoire, pass macros via `CombatStrategy` rather than
  `adventureMacro` (which needs a CCS + consult script installed).
- Maximizer: `maximizeCached(["cold res"], options?)` caches the objective set between calls —
  use it in loops instead of raw `maximize`. `Requirement` bundles modifier strings +
  `{ forceEquip, preventEquip, bonusEquip, preventSlot, modes }` and is what grimoire's
  Outfit uses under the hood.
- `uneffect(effect)`, `ensureEffect(effect, turns?)`, `questStep("questL11Black")` (-1
  unstarted … 999 finished; grimoire re-exports as `step`), `getSaleValue(item)` (standard
  item valuation for MPA math), `getKramcoWandererChance()`, `getBanishedMonsters()`,
  `getRemainingLiver/Stomach/Spleen()`, `withFamiliar(fam, cb)`, `withBatch(cb)` +
  `bulkAutosell/bulkPutCloset/...`, `sum(arr, fn)`, `maxBy(arr, fn)`, `clamp`, `undelay`.
- `Session` — meat/item tracking: `Session.current()`, `.diff()`, `.value(itemValuer)`,
  `Session.computeMPA(...)`. Snapshot at start, diff at end.
- `Mood` — buff management (`new Mood().skill(...).potion(item, maxPricePerTurn).execute(turns)`).
- `Clan`, `Kmail`, `Counter`, `ActionSource` free-run/banish/free-kill finders
  (`tryFindFreeRun`, `ensureBanish`, ...).

### IOTM resource modules

One namespace per IOTM, imported from the root: `AsdonMartin` (`.installed()`,
`.drive(AsdonMartin.Driving.Waterproofly)` — used for underwater breathing, `.fillTo(n)`),
`Witchess`, `SourceTerminal`, `SongBoom`, `GreyGoose`, `Guzzlr`, `CombatLoversLocket`,
`TrainSet`, `CinchoDeMayo`, `ClosedCircuitPayphone`, `CursedMonkeyPaw`, `MayamCalendar`,
`TakerSpace`, `BeachComb`, `BoxingDaycare`, `ChateauMantegna`, `CrystalBall`, `JuneCleaver`,
`AutumnAton`, `Pantogram`, `Horsery`, `Robortender`, and many more (2006–2026). Common shape:
`have()`, state getters, action functions returning boolean.

### Gotchas

- `sinceKolmafiaRevision(NNNNN)` at entry throws if the user's mafia is too old. (No
  `sinceLibramVersion` in this build.)
- Property typings are a snapshot of mafia's defaults at libram build time; newer prefs need
  explicit-default `get(name, default)`.
- Default export is a `logger` (`logger.setLevel(LogLevels.DEBUG)`); a mafia-backed `console`
  namespace also exists.

---

## Library: `grimoire-kolmafia` (v0.3.33)

Declarative task engine. Peer deps: `kolmafia ^5.28100.0`, `libram ^0.10.0`. Does **not**
re-export libram — import `Macro`, `$item`, `get`, etc. directly. Exports: `Task`, `Quest`,
`Engine`, `EngineOptions`, `CombatStrategy`, `Outfit`, `OutfitSpec`, `Args`, `ParseError`,
`Limit`, `Guards`, `getTasks`, `orderByRoute`, `step`, `AcquireItem`.

### Core loop

You declare a flat list of `Task`s; `Engine.run()` repeatedly executes the **first task in
list order** that is `available()` (= not over `limit.skip`, all `after` tasks completed,
`ready()` true, `completed()` false). Ordering is emergent: `after` only *blocks*, it never
*prioritizes* — list position is the priority.

### Task

```ts
type Task = {
  name: string;                       // required, unique
  completed: () => boolean;           // required — must eventually become true
  do: Location | (() => Location) | (() => void);  // required
  after?: string[];                   // names that must be completed() first (non-transitive)
  ready?: () => boolean;
  prepare?: () => void;               // runs after outfit/combat/choices set, before do
  post?: () => void;
  acquire?: AcquireItem[] | (() => AcquireItem[]);  // {item, num?, price?, optional?, useful?}
  effects?: Effect[] | (() => Effect[]);
  choices?: { [id: number]: number | string } | (() => ...);
  outfit?: OutfitSpec | Outfit | (() => OutfitSpec | Outfit);
  combat?: CombatStrategy;
  limit?: Limit;
};
type Quest<T> = { name: string; completed?: () => boolean; ready?: () => boolean; tasks: T[] };
```

`getTasks(quests)` flattens quests, renames tasks to `"Quest/Task"`, rewrites quest-local
`after` refs, ANDs quest `completed` into each task. When `do` is a `Location` the engine runs
`adv1(loc, -1, "")`, then `runCombat()`, loops multi-fights, and resolves chained choices.

### Engine execution order per task

`limit.guard` snapshot → `acquire` items → `effects` → clone `combat` → `createOutfit` →
`customize(task, outfit, combat, resources)` → `dress` → compile macro + write CCS
(`grimoire_macro`) + autoattack → set `choices` → `prepare` → `do` (repeats for wandering
NCs) → `post` → mark attempt → `checkLimits`.

Subclass `Engine` and override: `customize` (allocate banishers/resources, merge a default
farming outfit, append global macros), `available`, `dress`, `post`, `initPropertiesManager`,
static `defaultSettings`. The constructor applies `defaultSettings` through
`this.propertyManager`; **always** `try { engine.run() } finally { engine.destruct() }` —
destruct restores all properties and clears autoattack.

### CombatStrategy

```ts
new CombatStrategy()
  .macro(macro, monsters?)        // per-monster or general; Delayed<Macro> allowed
  .autoattack(macro, monsters?)
  .startingMacro(macro)
  .action("banish", monster)      // abstract actions resolved via EngineOptions.combat_defaults
                                  // or resources.provide() in customize()
```

Compiled order: startingMacro → monster-specific macros → general macros → monster-specific
actions → general actions. Use `CombatStrategy.withActions(["kill","banish"] as const)` for a
fluent typed subclass.

### Outfit / OutfitSpec

```ts
interface OutfitSpec {
  hat?/back?/weapon?/offhand?/shirt?/pants?/acc1?..acc3?/famequip?: Item | Item[];
  equip?: Item[];  modifier?: string | string[];  familiar?: Familiar;
  avoid?: Item[];  skipDefaults?: boolean;  modes?: Modes;
  riders?: { "buddy-bjorn"?: Familiar; "crown-of-thrones"?: Familiar };
  bonuses?: Map<Item, number>;  beforeDress?/afterDress?: (() => void)[];
}
```

`Outfit.from(spec)`, `outfit.equip(thing, slot?)` (returns false if impossible),
`outfit.dress()` — equips explicit slots then maximizes `modifier` + `bonuses` over remaining
slots via libram `Requirement`, verifies everything actually equipped and **throws** on
failure (`allow_partial_outfits` in EngineOptions to soften).

### Args

```ts
export const args = Args.create(scriptName, help, {
  flagName: Args.flag({ help, default?, setting? }),  // setting: "" = no property backing
  num: Args.number({ help, default }),                // omit default → T | undefined
  grp: Args.group("Display Name", { ...more args }),  // display-only; keys globally unique
  thing: Args.custom({ help }, parserFn, "valueName") // parser returns T | ParseError
}, { positionalArgs?, defaultGroupName? });
// in main(): Args.fill(args, command); if (args.help) { Args.showHelp(args); return; }
```

Builders: `string(s) number(s) boolean(s) flag class(es) effect(s) familiar(s) item(s)
location(s) monster(s) path(s) skill(s) custom`. Value precedence: default < KoLmafia
property (`<scriptName>_<key>` unless `setting` overrides) < command line. `help` key is
reserved/auto-added.

### Limit

```ts
limit: {
  tries?: number;   // abort after N attempts
  soft?: number;    // abort after N attempts ("may just be unlucky")
  turns?: number;   // abort when location.turnsSpent >= N
  skip?: number;    // after N attempts silently stop scheduling (no abort)
  completed?: boolean; unready?: boolean; guard?: Guard; message?: string;
}
```

Checked after `post()` when `completed()` is still false. Attempt counts are in-memory only —
they reset on script restart. **Every adventuring task needs a `limit`.**

### Gotchas

- `completed()` and `ready()` run once per candidate task per engine iteration — keep them
  cheap (no `visitUrl`/`mallPrice`).
- Unknown `after` name throws `Unknown task dependency`; deps are non-transitive.
- The engine mutates global mafia state (CCS, autoattack, choiceAdventure props, ~20
  settings) — the `finally { destruct() }` is not optional.
- `task.combat` and delayed `Outfit`s are cloned per execution, so `customize()` mutations
  don't leak.
- `acquire` throws unless `optional: true`; resolution order: `get()` → buy at `price` →
  fold → `retrieveItem`.

---

## Research resources

- **KoL wiki** (`wiki.kingdomofloathing.com`): the canonical game reference (zones, monsters,
  items, effects, mechanics). CloudFront blocks non-browser user agents (403) — set a browser
  UA and prefer the MediaWiki API for clean output:

  ```sh
  curl -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
    "https://wiki.kingdomofloathing.com/api.php?action=parse&page=Madness_Reef&format=json&prop=wikitext"
  ```

  (`prop=text` returns rendered HTML; page titles use underscores.)
- **Reference scripts** built on the same stack, useful for idioms: loathers/garbage-collector
  (garbo, meat farming), Kasekopf/loop-casual, loathers/libram source for helper details.
- **Local type sources of truth**: `node_modules/kolmafia/index.d.ts`,
  `node_modules/libram/dist/**/*.d.ts`, `node_modules/grimoire-kolmafia/dist/*.d.ts` — when
  unsure about an API, read these rather than guessing.
