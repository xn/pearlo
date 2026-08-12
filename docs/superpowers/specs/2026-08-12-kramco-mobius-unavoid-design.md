# Kramco + Möbius ring: un-avoid and survive their encounters

**Date:** 2026-08-12
**Status:** Approved (user decisions: just un-avoid; NC 1562 always skips)

## Background

Commit 23ca84a (2026-08-08, user directive) added the Kramco Sausage-o-Matic™ (and
replica) and the Möbius ring to `GLOBAL_AVOID` in `src/outfit.ts`. The user now wants
them allowed again, with the requirement that pearlo survives the encounters they
inject.

Verified facts (wiki + mafia `monsters.txt`, loopstar sea path, 2026-08-12):

- **sausage goblin** (id 2104): `FREE` (no adventure cost), `Init: -10000` (we always
  act first), scales to player stats (`Scale: [1+2*pref(_sausageFights)]`, HP = 75% of
  Defense, cap 10,000), attacks deal **sleaze** damage (only Dive Bar's zone res covers
  it), phylum goblin, drops magical sausage casing (100%). Occurs anywhere while the
  Kramco is equipped; pending goblins hold priority, so wearing the Kramco through the
  delay period wastes nothing.
- **time cop** (id 2497): **not free**, `Scale: 2`, `Init: 250` (always wins
  initiative), NOCOPY, phylum dude, drops time cop top hat (1%, pickpocket-immune).
  Occurs anywhere while the Möbius ring is equipped; loopstar caps at
  `_timeCopsFoughtToday < 11` and treats it as a plain hard kill underwater.
- **NC 1562 "Time is a Möbius Strip"**: fires only while the ring is worn. Option
  _numbers rotate between visits_ — loopstar answers it by matching option **text**.
  "I'm not messing with the timeline!" skips the adventure at no cost. Other options
  change Paradoxicity (which reshapes the ring's enchantments) and/or grant items.

## Design

### 1. Un-avoid (src/outfit.ts)

Remove `Kramco Sausage-o-Matic™`, `replica Kramco Sausage-o-Matic™`, and
`Möbius ring` from `GLOBAL_AVOID`; only `broken champagne bottle` remains (its
charge-draining rationale still stands). Behavior change: saved per-zone outfits
(`sleazeoutfit=` etc.) containing these pieces keep them instead of dropping them,
and the maximizer may pick them freely (in practice it rarely will — they add at
most +2 situational res). No forced equipping, no new args.

### 2. Wanderer survivability (src/combat.ts / pearl tasks)

Add monster-specific `CombatStrategy` macros for `sausage goblin` and `time cop` —
never the zone's tuned one-shot plan, which is computed against zone monsters, not
stat-scaling wanderers. Both macros layer stagger-deleveling before the stun+kill
(all wiki-verified 2026-08-12; combat items work underwater per sea-reference):

- `Micrometeorite` (skill, 1/combat): −25% delevel (decays to −10% floor daily),
  staggers. Works on any monster.
- `train whistle` (combat item, first use per combat): −25% Atk/Def, staggers.
  Works on any monster.
- `HOA citation pad` (combat item): −30% Atk/Def and a 100% stagger against
  dudes, hippies, and orcs (wiki); covers the time cop (dude). Behavior vs other
  phyla is undocumented, but funkslung alongside the whistle it costs nothing
  extra to include for the goblin.
- Then `Entangling Noodles` (multi-round stun; zero-bonus-ML run → no stun
  resistance), then Saucegeyser repeat.

Macro order per fight (both monsters): Micrometeorite → funksling
[train whistle + HOA citation pad] in one round (user direction; guarded by
`have($skill\`Ambidextrous Funkslinging\`)`via libram's`tryFunkslingItem`,
which pairs items but does not itself check the skill — fall back to sequential
`tryItem`s without it) → Noodles → Saucegeyser repeat. The staggers cover the
early rounds while attack melts (0.75 × 0.75 × 0.70 ≈ 39% of original vs the
goblin's Moxie+ attack); Noodles holds the tail. All steps are
`trySkill`/`tryItem`, so missing items or MP degrade gracefully to the next layer.

Why this suffices:

- Goblin: we always act first (init -10000), so the chain starts before any hit.
- Time cop: wins initiative, but the Jurassic Parka's automatic round-1 stagger
  covers its first action.
- Blood Bubble (first-hit block) and the explicit pre-fight HP/MP restores in
  `pearlMood` remain underneath.
- Non-melee everywhere is preserved (spell/item actions only).

MP note: these fights may take 2–4 Saucegeyser casts instead of 1; the existing
5-fights-of-MP buffer in `pearlMood` absorbs that without changes.

### 3. NC 1562 handled by text, not number (new src/choice.ts entry)

A fixed `choices: {1562: n}` is unsafe (rotating numbers). Instead, ship a tiny
choice handler modeled on loopstar's `standalone/loopstar_choice.ts`:

- New rollup entry `src/choice.ts` → `dist/scripts/pearlo-choice.js`, exporting
  mafia's choice-script signature (`main(choice: number, page: string)`).
- For choice 1562: find the option whose button text is
  `I'm not messing with the timeline!` via `availableChoiceOptions()` and
  `runChoice` its number. Always skip — free, no turn, no Paradoxicity drift
  (user decision; Paradoxicity is managed manually outside pearlo).
- Any other choice: do nothing (mafia falls through to its normal handling).
- `PearloEngine` registers `choiceAdventureScript: "pearlo-choice.js"` through its
  `propertyManager` (same pattern as its other default settings), so `destruct()`
  restores the user's previous choice script.
- `yarn install-mafia` copies both bundles (already copies the dist dir).

## Error handling

- If the skip option text is not among `availableChoiceOptions()` (KoL changes copy,
  future variants), print a red warning and leave the choice unhandled so mafia's
  abort surfaces it, rather than silently gambling with the timeline.
- Combat: if Noodles is uncastable (out of MP), the macro degrades to Saucegeyser
  repeat via `trySkill`; HP restore thresholds already trigger at 60% max HP.

## Testing

No unit tests (nothing runs outside mafia). Verification: `yarn lint`, `yarn build`,
then a live session check — equip the ring/Kramco in a saved zone outfit, confirm a
goblin/time cop fight resolves via Noodles→Saucegeyser in the session log and that
NC 1562 logs the skip.

## Out of scope

- Actively weighting/forcing Kramco or ring into outfits (user chose "just un-avoid").
- Loopstar's profitable NC priorities and Paradoxicity management.
- Eating magical sausages (diet is outside pearlo v1).
