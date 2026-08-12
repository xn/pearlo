# More Lucky! sources — saxophone + Heartstone: LUCK — design

**Date:** 2026-08-12
**Status:** Approved by user

## Problem

The Lucky! acquisition cascade in `src/fishy.ts` (spec:
`2026-08-08-lucky-fishy-design.md`) knows five sources: Aug. 2nd scepter, owned 11-leaf
clovers, the free pill keeper use, hermit clovers, and the mall. The character (roster
verified against `../UnderTheSea`'s scripts, 2026-08-12) also owns two IOTMs that grant
Lucky! for free and were left out of scope in the original spec:

- **Apriling band helmet** → Apriling band saxophone
- **Heartstone** → Heartstone: LUCK

Up to 4 extra free refreshes/day (3 saxophone + 1 Heartstone) currently go unused while
the cascade falls through to sources with real cost: owned clovers are mall-tradeable
assets, hermit clovers cost meat, mall clovers cost `cloverprice` meat.

## Verified game facts (wiki, 2026-08-12)

- **Apriling band saxophone** ([Apriling band saxophone]): `[play]` link grants the
  Lucky! intrinsic, first **3 times/day** (mafia pref `_aprilBandSaxophoneUses`, in
  libram's typed prefs). Owning two saxophones still gives only 3 charges. The helmet
  conjures instruments (2/day, `_aprilBandInstruments`); libram's
  `AprilingBandHelmet.play(instrument, acquire)` handles conjure-if-missing, and
  `canPlay` mirrors the check. Playing while already Lucky! is refused by the game
  ("maybe play a sexy sax solo later") — the cascade only runs when Lucky! is absent.
- **Heartstone: LUCK** ([Heartstone: LUCK]): grants Lucky!; internally named
  `Heartstone: %luck`. Unlocked once per life (`heartstoneLuckUnlocked`), then usable
  **once/day** (`_heartstoneLuckUsed`) **while the Heartstone is equipped** (or in The
  Eternity Codpiece). Both prefs are in libram's typed prefs.
- Out of scope (organ/meat costs; UnderTheSea's roster shows no VIP-lounge use): optimal
  dog (1 fullness, clan hot dog stand), Lucky Lindy (500 meat + 6 liver, speakeasy),
  clovermint (7 spleen, mall), paid pill keeper uses (3 spleen).

## Design

Two new entries in `LUCKY_SOURCES`, slotted at positions 1–2, ahead of the scepter
(user decision 2026-08-12, superseding the 2026-08-08 "scepter first" order). Existing
entries keep their relative order.

1. **Apriling band saxophone** — `available`: `AprilingBandHelmet.have()` and
   `canPlay(saxophone, true)` (covers uses-left and conjure-if-missing); `acquire`:
   `AprilingBandHelmet.play(saxophone, true)`.
2. **Heartstone: LUCK** — `available`: `have($item`Heartstone`)` ∧
   `get("heartstoneLuckUnlocked")` ∧ `!get("_heartstoneLuckUsed")`; `acquire`: equip
   Heartstone to acc2, `useSkill($skill`Heartstone: %luck`)`, restore the previous
   acc2 — the same swap pattern `lib.ts` uses for Ultraheart/Best Pals.
3. Aug. 2nd scepter *(existing)*
4. owned 11-leaf clovers *(existing)*
5. free pill keeper *(existing)*
6. hermit clovers *(existing)*
7. mall clovers *(existing)*

**Why 1–2:** all three free daily sources are use-it-or-lose-it, but the saxophone and
Heartstone LUCK can *only* produce Lucky!, while the scepter's 5 shared Aug. casts can
go to any Aug. skill — the least flexible resources burn first. Owned clovers are
tradeable assets and the free pill keeper use is contested by other pill keeper
effects, so everything free-and-daily precedes them.

**Matching updates, same file:**

- `luckyRefreshCosts(maxCount)` — in cascade order, push one `0` per remaining
  saxophone use (`3 − _aprilBandSaxophoneUses`, only while the helmet + a playable/
  conjurable saxophone exist) and one `0` for an unused, unlocked Heartstone LUCK,
  ahead of the scepter's `0`.
- `luckySourceReport()` — one line each: saxophone (not owned / uses left today),
  Heartstone (not owned / not unlocked / used today / available).
- No new args: both sources are free, so they live under the existing `luckyfishy`
  flag with no price gating.

## Error handling

Unchanged: `acquireLucky` already verifies `have($effect`Lucky!`)` after each source
and falls through to the next on failure, printing the miss. The Heartstone swap
restores the prior acc2 item even when the cast fails (equip → cast → restore,
unconditionally, matching lib.ts).

## Testing

No unit tests (nothing in the `kolmafia` package executes outside mafia). Verification:
`yarn lint` (eslint-plugin-libram validates `$skill`Heartstone: %luck`` and the
saxophone item name at lint time) and `yarn build`, then a live `sim` run to eyeball
the new `luckySourceReport` lines.
