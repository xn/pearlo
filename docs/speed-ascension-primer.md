# KoL Speed Ascension: Core Concepts

Summarized 2026-08-12 from a user-supplied article by Phillammon (edited by Scotch; "part 1"
of an intended series — a follow-up on Familiar Weight was promised but is not covered here).
Not directly pearlo-relevant (pearlo is aftercore farming, not ascension), but kept as general
background on how the community reasons about turn economy. Facts below are the article's
claims, not independently wiki-verified — verify before building on any of them.

---

## 1. What a "speedrun" is in KoL

- Defeating the Naughty Sorceress lets you break the Prism and **Ascend**: restart at level 1
  with your stuff reset, keeping one skill learned that run as a permanent ("permed") skill.
- A run is scored as **days / turns played** at the moment the Prism is smashed. Days count
  rollovers passed plus one — an idle day still counts. Lower is better, **days before
  turns**: 2/500 beats 3/400.

## 2. The two levers and the golden rule

- **Turn-bloat** — generate as many adventures per day as possible (quality food/booze, Milk
  of Magnesium, The Ode to Booze, +adventures rollover gear). This is what lowers daycount.
- **Turn-cutting** — finish the main quest in fewer adventures. Harder than bloating; rarely
  saves whole days, but saves turns.
- Golden rule: **every resource spent should either advance the main quest as fast as
  possible or generate the turns needed to get there.**
- Caveat for advanced play: "never spend turns to make turns" — accurate at high tiers,
  fine to ignore when starting out.

## 3. Baseline resources

- **Adventures**: ~40ish free per day, plus what food/booze generates. Every one ideally
  goes to critical-path quest progress (quest steps or leveling) or turn generation.
- **Stomach (15) / Liver (14)**: fill with the best food and booze available; save a very
  alcoholic nightcap as the last action of the day (overdrinking past the limit). What
  counts as "best" shifts rapidly with permed skills — Pastamastery's Dry Noodles plus
  quest-path ingredients is the durable early recommendation.
- **Lucky Adventures**: the Hermit sells up to **3 eleven-leaf clovers/day** for worthless
  trinkets (chewing gum on a string from the general store finds trinkets). A clover forces
  the next adventure to be the location's unique Lucky Adventure. Scarce and extremely
  flexible — planning the day's three clovers is a major turn-cutting decision. Example
  uses cited: the NS weapon, Trapper ore without a mining outfit, chasm bridge fasteners
  and lumber, Ultrahydrated turns for the desert, A-Boo clues, powerful food/booze, stone
  wool fights for the Hidden City, and big single-modifier buff potions.
  (pearlo already exploits this pattern: The Haggling in `src/fishy.ts` is a Lucky NC.)

## 4. Modifier pumping

Nearly every quest is "adventure in a zone until something happens", and most have a
modifier that speeds them up. The two workhorses, rarely wrong to maximize at all times:

- **Noncombat rate** ("Monsters are less attracted to you") — for "adventure until an NC
  fires" quests.
- **Item drop** — for "adventure until X drops" quests. Extra-responsive zones cited:
  Haunted Laundry Room, Haunted Wine Cellar, Hippy Orchard, Pyramid Middle Chamber, Cyrpt
  Nook, Penultimate Fantasy Airship.

Worked example — **Haunted Kitchen**: 21 drawers then a key from the next won fight. Each
won fight the game coin-flips hot vs stench resistance; every +3 resistance to the chosen
element (up to +9) searches an extra drawer, max 4 drawers/fight. At 9 hot + 9 stench res:
7 adventures instead of 22. (Same "+3 res per tier" granularity as the pearl-progress
formula pearlo is built on.)

### Zone → modifier table (article's incomplete list)

| Zone / step               | Modifier wanted                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------- |
| Typical Tavern Basement   | Monster Level + elemental damage (all but sleaze); ML actually pays off in a later zone |
| Cyrpt Cranny              | Monster Level (+ noncombat rate)                                                        |
| Cyrpt Alcove              | Combat Initiative (+ noncombat rate)                                                    |
| Lair of the Ninja Snowman | **Combat** rate (not NC rate)                                                           |
| Smut Orc Logging Camp     | Cold damage; then sleaze res (Moxie class) / spell dmg (Myst) / weapon dmg (Muscle)     |
| A-Boo Peak                | Max HP, spooky res, cold res                                                            |
| Twin Peak                 | Stench res + initiative                                                                 |
| Oil Peak                  | Monster Level                                                                           |
| The Black Forest          | Combat rate                                                                             |
| Haunted Kitchen           | Stench res + hot res (see above)                                                        |
| Haunted Boiler Room       | Monster Level                                                                           |
| Zeppelin Mob              | Sleaze damage + sleaze spell damage                                                     |
| Sonofa Beach              | Combat rate                                                                             |
| Themthar Hills            | Meat drop                                                                               |
| The 8-Bit Realm           | Rotation: initiative / DA / item drop / meat drop                                       |
| The Wall of Meat          | Meat drop                                                                               |
| NS Contest 1              | Combat Initiative                                                                       |
| NS Contest 2              | An offstat (random non-mainstat)                                                        |
| NS Contest 3              | Elemental damage + spell damage of a random element                                     |

**Familiar Weight** is flagged as the other near-universally-good modifier; the article
defers the explanation to its unpublished part 2.
