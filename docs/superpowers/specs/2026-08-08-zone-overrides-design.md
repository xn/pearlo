# pearlo: per-zone familiar and outfit overrides — design

Date: 2026-08-08. Status: approved pending user spec review.
Scope: ten new pref-backed args letting the user pin a familiar and/or a saved KoL
custom outfit per pearl zone, layered under pearlo's existing safety nets (breathing,
organ extenders, wineglass) and priced honestly by the profit model. Builds on
`docs/superpowers/specs/2026-08-08-overcapped-profit-design.md` (liver modes,
economics) and the outfit/familiar machinery in `src/outfit.ts` / `src/familiar.ts`.

## Goals / non-goals

**Goals**

1. Per-zone **familiar override**: force a specific familiar in a zone, skipping the
   two-pass `pickPearlFamiliar` planning there.
2. Per-zone **outfit override**: a saved KoL custom outfit name whose pieces are
   force-equipped for that zone, replacing the maximizer's res outfit (the user's
   outfit IS the res plan).
3. **Safety nets always enforced** (user decision): breathing keywords stay in the
   modifier, required organ extenders and the wineglass (+drunkweapon) stay
   force-equipped, `requirecap` still halts under 18 res. A slot collision between an
   override piece and a mandatory item fails grimoire's dress with its standard clear
   error — the mandatory layer never silently yields.
4. **Stooper precedence** (user decision, "stooper wins when overdrunk"): when the
   chosen liver mode is `stooper`, the Stooper pin displaces any per-zone familiar
   override (its +1 liver only counts while active) — with a printed one-line notice.
   In every other liver mode the override applies.
5. The profit model prices overridden zones as they will actually run: speculation
   pins the override familiar and force-equips the outfit pieces.

**Non-goals**

- No per-zone modifier-string or item-list outfit forms (user chose saved outfits).
- No validation that a saved outfit is _sensible_ (wrong element, no res) — that is
  the point of an override; `requirecap` and the profit report surface consequences.
- No per-zone liver-mode overrides; the liver mode stays a whole-run decision.

## Verified API facts (node_modules/kolmafia/index.d.ts, 2026-08-08)

```ts
haveOutfit(outfit: string): boolean;   // saved-outfit existence check
outfitPieces(outfit: string): Item[];  // the outfit's items
getOutfits(): string[];                // the player's custom outfit names (error message)
```

Approach chosen ("B"): translate the saved outfit to items via `outfitPieces` and
feed them through the normal `OutfitSpec.equip` path, so grimoire's dress owns
equipping and verification. (`cliExecute("outfit …")` in a beforeDress hook was
rejected: it equips outside grimoire's verification, so failures surface late or
silently.)

## Args (`src/args.ts`)

New `Args.group("Zone Overrides", …)` with ten entries — all optional (no default →
`undefined` when unset), all mafia-pref-backed (`pearlo_spookyfamiliar`, …):

| Arg                                    | Type            | Meaning                                       |
| -------------------------------------- | --------------- | --------------------------------------------- |
| `spookyfamiliar` … `coldfamiliar` (×5) | `Args.familiar` | Force this familiar in that zone.             |
| `spookyoutfit` … `coldoutfit` (×5)     | `Args.string`   | Saved KoL custom outfit to wear in that zone. |

Helpers in `src/args.ts` (typed against `PearlKey`):

```ts
familiarOverride(key: PearlKey): Familiar | undefined;
outfitOverride(key: PearlKey): string | undefined;
```

## Resolution and mechanics

**Familiar precedence** (in `buildPearlOutfit`):
`stooper liver mode` → `familiarOverride(spec.key)` → `pickPearlFamiliar(spec, …)`.

- When the Stooper pin displaces an override, print:
  `pearlo: <key> familiar override <name> displaced by Stooper (liver rescue needs its +1)`.
- An override familiar gets the same breathing treatment as the Stooper pin: famequip
  from `familiarWaterBreathingEquipment` unless `familiarBreathesFree()` or
  `familiar.underwater`. If none of those can guarantee its air, **abort** at outfit
  build with a message naming the familiar and the missing enablers (das boot /
  little bitty bathysphere / Driving Waterproofly). Checked at build time, not
  startup, because air effects (e.g. Asdon Waterproofly) may arrive with the
  Breathe Underwater task.
- An override familiar receives no automatic famequip beyond breathing gear — the
  second-lantern hand-off that `pickPearlFamiliar` gives the Left-Hand Man does not
  apply to overrides (if the user wants a held item, it belongs in their saved
  outfit or the maximizer's free-slot fill).

**Outfit override** (in `buildPearlOutfit`, when `outfitOverride(spec.key)` is set):

- `equip` = mandatory layer first (required organ extenders — or the full set with
  the `overcapped` flag — plus wineglass and drunkweapon/totem resolution in
  wineglass mode, exactly as today), then `…outfitPieces(name)`.
- `modifier` = **breathing keywords only** (`breathingKeywords(plan)` result, no res
  expression, no tiebreak weights): the maximizer's only job is patching air into
  slots the outfit leaves free, never re-planning res.
- Lantern selection is skipped (the outfit override owns damage gear); parka `modes`
  still set when the Jurassic Parka is among the pieces; retro-cape mode logic
  skipped; `avoid` list still applied (GLOBAL_AVOID + zone avoid) — a saved outfit
  containing an avoided item (e.g. Kramco) loses that piece to the avoid list and
  the dress error/warn surfaces it.
- Slot collision (piece vs extender vs wineglass): grimoire dress throws its
  standard failed-to-equip error; that is the intended UX (user decision).

**Validation at startup** (`main()`, right after `selectedPearls()`): every set
`outfitOverride` name must satisfy `haveOutfit(name)`; otherwise abort listing the
player's outfits from `getOutfits()`. Familiar override args are validated by
`Args.familiar` parsing itself (unknown names fail at `Args.fill`).

## Economics integration (`src/economics.ts`)

`evaluateZone` already threads forced equips and an optional pinned familiar into
`speculativeResFloor`. For overridden zones:

- familiar: when scoring mode `stooper`, pin Stooper (override displaced, matching
  runtime); for every other mode, pin `familiarOverride(spec.key)` when set (skips
  the switch flavor — a pinned familiar is speculated exactly like Stooper today).
- equips: append `outfitPieces(name)` to the forced-equip list when the zone has an
  outfit override, so the speculated res floor reflects the real outfit.

Everything downstream (Fishy budget, costs, go/no-go, `force`) is unchanged — an
uneconomical override zone gets a SKIP verdict like any other, overridable with
`force`.

## Sim / profit output

Overridden zones add one line each in `sim` and the `profit` report:
`  override: familiar <name>` / `  override: outfit <name> (<n> pieces)` — plus the
Stooper-displacement notice when applicable.

## Error handling

- Unknown saved-outfit name → startup abort listing `getOutfits()`.
- Override familiar without guaranteeable air → outfit-build abort naming the
  missing enablers.
- Slot collisions → grimoire dress error (standard, already descriptive).
- Overridden zone failing `requirecap` → existing prepare abort (unchanged).

## Testing / verification

`yarn lint` + `yarn build` clean (no unit tests possible). In-game: set
`pearlo_coldoutfit` to a saved outfit and `pearlo_coldfamiliar`, run `pearlo profit`
(res floor reflects the outfit, override lines print), `pearlo sim`, then a live
cold-zone run; verify a bogus outfit name aborts at startup and a Stooper-mode run
prints the displacement notice.
