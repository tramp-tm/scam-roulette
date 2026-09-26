# Scam Roulette — Technical Description

Structural description of the application's architecture and business logic.
Client-only, single-page web application.

> **STATUS: intermediate state.**
> The project is in the middle of a staged architectural refactor.
> **Stages 1 – 4 are complete**, so the current code and this document differ
> from the historic "single-owner" model. Transitional artefacts (notably
> `Lot.active`, the unused `LotManager` deactivation API, and the leftover
> dead imports in `app.ts`) are marked where they appear. Remaining refactor
> work (Stage 5+) is listed in §20.

---

## 1. Overview

Scam Roulette is a weighted random picker. The user builds a list of *lots*
(each with a name, an amount, and a colour), picks a game mode and a
visualization, and spins. The **amount** is the weight; its interpretation is
mode-specific. The result is chosen **before** the animation starts — the
animation is cosmetic and never affects the outcome.

Supported configuration: two game modes (Normal, Survival), three
visualizations (Wheel, Strip, Counting Rhyme), two languages (EN/RU),
five themes (dark, light, emerald, nordic, monochrome).

---

## 2. Technology stack

| Concern       | Choice |
|---------------|--------|
| Language      | TypeScript, ES modules, explicit `.js` extensions in imports |
| Rendering     | HTML5 Canvas 2D, high-DPI (`devicePixelRatio`) aware |
| Localization  | i18next (`locales/en.json`, `locales/ru.json`) |
| CSV parsing   | PapaParse (global script tag `papaparse.min.js`) |
| DOM           | No framework; direct DOM manipulation |
| Persistence   | `localStorage` (theme selection) |
| Runtime       | Static files served as ES modules (`script type="module"`) |

---

## 3. Project structure

```
/
├── index.html                  # static shell + inline theme bootstrap script
├── styles.css                  # all styling; 4 theme palettes via :root[data-theme="…"]
├── papaparse.min.js            # third-party CSV parser
├── technical-descriptiom.md    # this document
├── locales/
│   ├── en.json
│   └── ru.json
└── *.ts                        # application sources (compiled to sibling *.js)
    ├── app.ts                      # entry point + orchestration + UI
    ├── gameSession.ts              # current-game state + spin lifecycle
    ├── types.ts                    # all shared contracts
    ├── modes.ts                    # game-mode registry
    ├── NormalMode.ts               # GameMode implementation
    ├── SurvivalMode.ts             # GameMode implementation
    ├── rouletteEngine.ts           # weighted random + geometry
    ├── lotManager.ts               # global lot storage
    ├── rendererFactory.ts          # renderer construction
    ├── visualizationStrategy.ts    # visualization-package registry
    ├── baseRenderer.ts             # shared IRenderer base class
    ├── wheelRenderer.ts            # IRenderer implementation (wheel)
    ├── stripRenderer.ts            # IRenderer implementation (strip)
    ├── countingRhymeRenderer.ts    # IRenderer implementation (counting rhyme)
    ├── animation.ts                # easing functions + AnimationController
    ├── i18n.ts                     # i18next bootstrap + DOM translation
    ├── utils.ts                    # colours, duration mapping, random helpers
    ├── csvParser.ts                # CSV → ParsedLot[]
    ├── importStrategies.ts         # replace / merge strategies
    ├── importDialog.ts             # tabbed import modal (coordinator)
    ├── importConflictDialog.ts     # replace/merge/cancel chooser
    ├── csvTabContent.ts            # CSV tab widget
    ├── linkTabContent.ts           # URL tab widget
    ├── errorDialog.ts              # generic error/info dialog
    ├── modalDialog.ts              # abstract modal base class
    └── modalManager.ts             # singleton modal stack manager
```

---

## 4. Architectural layers

```
        ┌──────────────────────────────────────────────┐
 L6 UI   │ app.ts           (orchestration, DOM, loop)  │
        └───────┬──────────────┬───────────────┬───────┘
                │              │               │
 L5 Pres.  ┌────▼──────────┐   │   ┌───────────▼────────┐
           │ visualization │   │   │ modalDialog /       │
           │ Strategy +    │   │   │ modalManager /      │
           │ Wheel/Strip   │   │   │ importDialog …      │
           └────┬──────────┘   │   └─────────────────────┘
                │              │
 L4 Mech.       │       ┌──────▼───────────┐
                └──────►│ rouletteEngine   │
                        └──────┬───────────┘
 L3 Rules      ┌───────────────▼──────────┐
               │ modes.ts → NormalMode,   │
               │           SurvivalMode    │
               └───────────────┬──────────┘
 L2 State       ┌──────────────▼─────────┐
                │ lotManager             │
                └──────────────┬─────────┘
 L1 Domain      ┌──────────────▼─────────┐
                │ types.ts               │
 L0 Infra       │ i18n.ts, utils.ts,     │
                │ animation.ts,          │
                │ csvParser.ts           │
                └────────────────────────┘
```

*(The two `````-adjacent angle-bracket fences above are only a rendering
convenience; the diagram itself carries no runtime meaning.)*

**Core rule:** dependencies point downward only. `App` knows *that* a game mode
exists, never *how* it plays. `RouletteEngine` and `LotManager` are entirely
mode-agnostic — they only receive a `GameMode` and call its `calculateWeight`.

**Refactor note (Stages 1 – 4).** `GameSession` (`gameSession.ts`) sits
between `App` and the state layers. It owns the current `GameMode`, the
participation set (`activeLotIds: Set<string>`), and — since Stage 4 — the
turn lifecycle (`prepareSpin()` / `finishSpin()`). It exposes
`allLots` / `activeLots` / `activeCount` / `state` / `isActive()` as live
projections over `LotManager`'s global list. `LotManager` remains the owner
of the **global** lot collection only; `Lot.active` is now inert (see §5,
§8). There is no `syncGameSession()` anywhere — participation mutations are
explicit calls on `GameSession` (§5.1, §11, §12).

---

## 5. Domain model (`types.ts`)

| Type | Shape / role |
|------|--------------|
| `Lot` | `{ id, name, amount, color, active }` — the atomic unit |
| `Mode` | `'normal' \| 'survival'` |
| `VisualizationType` | `'wheel' \| 'strip' \| 'counting-rhyme'` |
| `Settings` | `{ modeId, visualization, animationDuration }`; theme and language are intentionally not part of `Settings` |
| `Segment` | `{ lot, startAngle, endAngle, weight }` — `weight` is normalized (0–1) |
| `GameState` | `{ allLots: Lot[], activeLots: Lot[] }` |
| `RollResult` | `{ finished, winner: Lot\|null, deactivate: string[], message? }` |
| `GameMode` | `{ id, name, description, calculateWeight, getRollText, processRoll }` |
| `IRenderer` | `updateSegments`, `setRotation`, `getCurrentRotation`, `setHighlightedLot`, `render`, `reset` |
| `VisualizationPackage` | `{ id, createRenderer, computeFinalPosition }` (optional `canvasWidth?` in `computeFinalPosition`) |
| `ParsedLot` / `ParseResult` | `{ name, amount }` / `{ validLots, errorCount }` |
| `ImportResult` | `{ lotsAdded, lotsTruncated }` |
| `ImportStrategy` | `{ id, execute(parsedLots, lotManager): ImportResult }` — labels/descriptions live only in locale files (`data-i18n="importStrategy.<id>.…"`), not on the strategy object |
| `SortField` / `SortDirection` | `'name' \| 'amount'` / `'asc' \| 'desc'` |
| `EasingFunction` | `(t: number) => number` |

**`Lot.active` is transitional / inert (Stage 3, §1 of the plan).** Since
Stage 3 the field is neither read nor written by game logic. Participation
is owned by `GameSession.activeLotIds` and exposed via
`GameSession.activeLots` / `activeCount` / `isActive()`. `LotManager.addLot`
still initialises it to `true`, but nothing consumes it. New code must
consult `GameSession`.

### 5.1 `GameSession` — current-game state and turn lifecycle

Owns the state of the *current game* (both participation and the turn
lifecycle), distinct from the *global* lot list owned by `LotManager`.

| Member | Role |
|--------|------|
| `constructor(modeId, getLots)` | Binds the mode; stores an accessor for the global list (typically `() => lotManager.getAllLots()`); seeds `activeLotIds` from the current list. |
| `mode` (getter) | The `GameMode` governing the session. |
| `allLots` (getter) | Live view of the global list. |
| `activeLots` (getter) | Global list filtered by `activeLotIds`, recomputed on every read. |
| `activeCount` (getter) | `activeLots.length`. |
| `state` (getter) | `{ allLots, activeLots }` snapshot for `GameMode.processRoll`. |
| `isActive(id)` | Participation query used by the UI list. |
| `addLot(lot)` / `removeLot(id)` | Explicit participation mutation (paired with `LotManager.addLot` / `deleteLot`). |
| `deactivateMany(ids)` | Removes several participants (spin eliminations). |
| `clearLots()` | Empties participation (paired with `LotManager.clearAll`). |
| `reset()` | Clears any pending spin context, then re-seeds `activeLotIds` from the current global list. |
| `reconcileAfterBulkChange(previousIds)` | Post-import diff: kept ids preserve prior participation, new ids become active, stale ids dropped. |
| **`prepareSpin()`** | **Stage 4.** Validates via `RouletteEngine.canSpin()`, rolls via `RouletteEngine.roll()`, stores the pending rolled lot, and returns it — or `null` if the spin cannot proceed. The winner is decided *before* any animation starts. |
| **`finishSpin()`** | **Stage 4.** Reads the pending rolled lot, processes it through the current mode (`GameMode.processRoll`), applies any eliminations internally (`deactivateMany`), clears the pending context, and returns `{ rolledLot, result }` — or `null` if there is no pending spin. |
| `setMode(modeId)` | Single authoritative mode change. Participation is preserved across a switch. |

**Invariant.** Every lot returned by `activeLots` / `state` exists in
`LotManager` — holds by construction, because both are materialised from
the live accessor. This is the Stage 3 §7 invariant.

**Spin-context invariant (Stage 4).** A pending rolled lot exists only
between a successful `prepareSpin()` and the matching `finishSpin()`.
`finishSpin()` nulls the context *before* invoking `processRoll`, and
`reset()` nulls it as well, so re-entrant or late completions cannot
replay a stale roll (refac4.md §12 / §17).

---

## 6. Game mode strategy — the business core

All mode-specific rules live inside a `GameMode` implementation. There is no
`if (mode === 'survival')` in `App`, `RouletteEngine`, or `LotManager`.

### Registry (`modes.ts`)

```
export const MODES: Record<Mode, GameMode> = {
    normal: new NormalMode(),
    survival: new SurvivalMode()
};
export function getMode(modeId: Mode): GameMode { return MODES[modeId]; }
```

Mode instances are stateless and shared. Adding a new mode requires one new
class and one line in `MODES`; nothing else changes.

### Normal mode (`NormalMode.ts`)

| Aspect | Behaviour |
|--------|-----------|
| Weight | `amount` — higher amount → higher chance to win |
| Roll text | `Winner: {{name}}` |
| `processRoll` | `{ finished: true, winner: rolledLot, deactivate: [] }` |

A single spin selects the winner; the game ends immediately.

### Survival mode (`SurvivalMode.ts`)

| Aspect | Behaviour |
|--------|-----------|
| Weight | `1 / amount` — lower amount → higher chance of elimination |
| Roll text | `Eliminated: {{name}}` |
| `processRoll` | Eliminates the rolled lot; decides the winner from the **post-elimination** state |

`processRoll` logic:

```
remaining = state.activeLots.filter(l => l.id !== rolledLot.id)

if remaining.length === 1:
    → { finished: true, winner: remaining[0], deactivate: [rolledLot.id],
        message: completionMessage(remaining[0]) }
otherwise:
    → { finished: false, winner: null, deactivate: [rolledLot.id] }
```

**Key design point:** the winner is computed from the list *after* removing the
rolled lot. This prevents the historical bug where the last lot standing was
eliminated by an extra spin. The last remaining lot never undergoes another
spin — the spin button is locked as soon as `finished === true`.

### Mode metadata

`name` and `description` are **late-bound getters** that call `t(...)` on each
access, so a language switch updates them immediately (unlike plain string
fields captured at module-load time).

---

## 7. RouletteEngine (`rouletteEngine.ts`)

Static, stateless mechanics. It never references survival, elimination,
winner, or completion.

| Method | Responsibility |
|--------|----------------|
| `roll(lots, mode)` | Weighted random selection via cumulative distribution. The only source of randomness in the game path. Returns `Lot \| null`. |
| `calculateSegments(lots, mode)` | Normalizes weights across `[0, 2π)`; returns `Segment[]` (used by both renderers). |
| `getSegmentCenterAngle(lots, mode, targetLotId)` | Angle at the centre of a lot's segment. |
| `computeFinalRotation(lots, mode, targetLotId, currentRotation, durationMs)` | Wheel: rotation that places the target segment centre under the fixed top pointer, plus extra full turns scaled by duration. |
| `computeFinalScrollOffset(lots, mode, targetLotId, currentOffset, durationMs, canvasWidth)` | Strip: horizontal offset that places the target segment centre under the viewport centre, plus extra cycles. |
| `computeFinalCountingPosition(lots, mode, targetLotId, currentPosition, durationMs)` | Counting Rhyme: returns the cycle-space end position with residue equal to the target circle's midpoint (`endValue ≡ targetMid (mod 1)`), plus extra cycles scaled by duration. Five parameters — no `canvasWidth` (layout math is renderer-side). |
| `canSpin(activeLots)` | Returns `activeLots.length >= 1`. |

Segment width (strip) is derived via `getSegmentWidth(normalizedWeight)` from
`utils.ts` — a **single source of truth** shared by the strip renderer's drawing
pass and `computeFinalScrollOffset`'s scroll math, so the two cannot drift
apart. The formula is `Math.max(60, normalizedWeight * 400)`.

---

## 8. LotManager (`lotManager.ts`)

Owns the *global* `Lot[]` — the universe of lots. Knows nothing about game
modes, winners, rules, or which lots participate in the current game.

**Transitional (Stage 3).** The following members still exist on the API but
are **not used by the game path** and will be removed in a later stage:
`Lot.active` (field), `toggleActive`, `deactivateLot`, `deactivateMany`,
`resetAll`, `getActiveLots`, `getActiveCount`, `getState`. Participation is
owned by `GameSession` (§5.1).

| Method | Purpose |
|--------|---------|
| `addLot(name, amount, color)` | Adds a lot; returns `{ success, message }` (validation lives here) |
| `updateLot(id, patch)` | Updates a lot's fields (e.g. `{ amount }`) |
| `deleteLot(id)` | Removes a lot |
| `deactivateLot(id)` / `deactivateMany(ids)` | Marks lots inactive (transitional — not used by the game path) |
| `resetAll()` | Reactivates all lots (transitional — only keeps the inert flag consistent) |
| `clearAll()` | Removes all lots |
| `getAllLots()` / `getActiveLots()` | Read access |
| `getTotalCount()` / `getActiveCount()` | Counts |
| `getState(): GameState` | Snapshot `{ allLots, activeLots }` (transitional — the session provides its own `state`) |
| `LotManager.MAX_LOTS` | Static limit = `3000` |

---

## 9. Renderers (`baseRenderer.ts`, `wheelRenderer.ts`, `stripRenderer.ts`)

All renderers implement `IRenderer`. They receive a `GameMode` in
`updateSegments` and delegate weight math to `RouletteEngine.calculateSegments`.
None computes weights itself. `BaseRenderer` supplies the shared state and
high-DPI setup; each concrete renderer owns only its drawing and (optionally)
a cached layout.

### `BaseRenderer` (`baseRenderer.ts`)

Abstract base class shared by every concrete renderer. Owns the state and
lifecycle that used to be duplicated between the two renderers:

- **State:** `canvas` and `ctx` (both `protected readonly`), `segments`,
  `currentRotation`, `highlightedLotId`.
- **Constructor:** grabs the 2D context and calls `setupHighDPI()`.
- **`setupHighDPI()`** — reads `devicePixelRatio`, measures the canvas via
  `getBoundingClientRect()`, and falls back to `600 × 500` **only when the
  measured size is zero** (canvas not yet laid out). Sizes the backing store
  and applies `ctx.scale(dpr, dpr)`. No fake `DOMRect`, no type cast.
- **`updateSegments(lots, mode)`** — calls `RouletteEngine.calculateSegments`
  and stores the result. Subclasses override it to add caching (see
  `StripRenderer` below).
- **`setRotation` / `getCurrentRotation` / `setHighlightedLot` / `reset`** —
  trivial state accessors plus a shared reset of `currentRotation`,
  `highlightedLotId`, and `segments`.
- **`render(canvasWidth, canvasHeight)`** is abstract.

### `WheelRenderer` (`wheelRenderer.ts`)

Extends `BaseRenderer`. Segment/ring/pointer/label geometry is defined by
module-level constants (`WHEEL_MARGIN`, `SEGMENT_STROKE_WIDTH`,
`HIGHLIGHT_BRIGHTNESS`, `LABEL_*`, `POINTER_*`, `OUTER_RING_*`,
`INNER_RING_*`). Rendering:

- Radius: `min(centerX, centerY) - WHEEL_MARGIN` (= 30).
- Segments drawn as arcs; white 2 px stroke; labels at `0.7 * radius`, rotated
  by mid-angle, drawn only when the arc span exceeds `LABEL_MIN_ARC`.
- Highlight → `brightenColor(color, HIGHLIGHT_BRIGHTNESS)` (= 30).
- Cursor: a gold (`POINTER_COLOR`) downward triangle at the top, with a glow
  (`POINTER_SHADOW_BLUR`).
- Frame: outer decorative ring at `radius + OUTER_RING_OFFSET` (= 10)
  (`rgba(255,255,255,0.3)`, 4 px), plus a subtle inner ring at
  `radius - INNER_RING_OFFSET` (= 5) (`rgba(255,255,255,0.1)`, 2 px).

### `StripRenderer` (`stripRenderer.ts`)

Extends `BaseRenderer`. Overrides:

- **`updateSegments(lots, mode)`** — after `super.updateSegments`, sums
  `getSegmentWidth(s.weight)` over all segments and caches the result in
  `totalCycleWidth`. This is recomputed only when the lots/mode change, never
  inside the animation frame loop.
- **`reset()`** — calls `super.reset()` and clears `totalCycleWidth`.
- **`render(canvasWidth, canvasHeight)`** — infinite scroll via modulo of the
  accumulated offset over one cycle's width (`getVisualOffset`), with cyclic
  buffer copies (`getCyclesNeeded` → `renderOneCycle`) for seamlessness. The
  helper methods keep the render body focused on the drawing sequence.

Geometry is defined by module-level constants (`BAND_HEIGHT = 160`,
`BAND_HALF_HEIGHT`, `FRAME_PADDING`, `LABEL_*`, `HIGHLIGHT_*`). Behaviour:

- Segment width comes exclusively from `getSegmentWidth(weight)` (same
  function used by `RouletteEngine.computeFinalScrollOffset`).
- Band height 160; vertical labels (rotated `-π/2`), truncated per constants.
- Highlight → `brightenColor(color, HIGHLIGHT_BRIGHTNESS)` (= 40) plus a gold
  glow (`HIGHLIGHT_SHADOW_*`).
- Cursor: a gold dashed vertical centre line with gold down/up arrows at the
  top and bottom edges.
- Frame: rectangular decorative frame
  `(0, centerY - BAND_HALF_HEIGHT - FRAME_PADDING, canvasWidth,
  (BAND_HALF_HEIGHT + FRAME_PADDING) * 2)`
  (`rgba(255,255,255,0.3)`, 4 px) — the strip's counterpart to the wheel's
  outer ring.

The `BaseRenderer` extraction was performed as part of a review of
`stripRenderer.ts`; the fixes (deduplicated segment-width formula, simplified
high-DPI setup, constant extraction, `totalCycleWidth` caching) were applied to
the shared base and to `wheelRenderer.ts` as well, so both sibling renderers
stay aligned.

### `CountingRhymeRenderer` (`countingRhymeRenderer.ts`)

Extends `BaseRenderer`. Each active lot is drawn as a filled circle in a
grid. Speed and visual layout are decoupled from the "current circle"
mechanic: the per-frame highlight is derived **inside `render()` from
`currentRotation` and the cached prefix sums of `Segment.weight`** — **not**
from `highlightedLotId` (which is never driven for this renderer).

- **Cycle domain.** `currentRotation` is measured in *cycles*: `1.0` = one
  full traversal of the circle ring. Circle `i` owns `[P_i, P_{i+1})` of
  `[0, 1)` where `P` is the prefix sum of normalized weights, so dwell per
  traversal is exactly `w_i · T_cycle`.
- **Radius** is proportional to the lot's weight *relative to the heaviest
  active weight* (`w_i / max(w)`), not to the raw normalized weight — the
  heaviest lot fills its grid cell (`MIN_CIRCLE_RADIUS = 14`,
  `MAX_CIRCLE_RADIUS = 250`, `CELL_FILL_RATIO = 0.95`).
- **Grid mapping is permuted** deterministically (FNV-1a seed over the lot
  ids drives an LCG Fisher–Yates shuffle of cell indices). Cosmetic only:
  the highlight order remains `segments[0..n-1]`, only the *position* of each
  circle changes. Same lot set → same arrangement, so Survival does not
  reshuffle between eliminations.
- **Layout is computed once** in `updateSegments()` and cached; `render()`
  never regenerates it. Uses logical `getBoundingClientRect()` sizes, not the
  DPR-scaled backing store.
- **Highlight uses a crossfade** over a `TRANSITION_FRACTION = 0.2` window
  expressed as a fraction of the *current* segment, so dwell proportionality
  is preserved.
- **Last-frame guarantee.** `computeFinalCountingPosition()` returns
  `endValue ≡ targetMid (mod 1)`; `AnimationController` fires
  `onUpdate(endValue, 1)` before `onComplete()`, so the final animated frame
  resolves to the rolled lot.

---

## 10. Visualization strategy (`visualizationStrategy.ts`)

Each visualization is a `VisualizationPackage` bundling a renderer factory and a
final-position function:

```
WHEEL_PACKAGE          = { id: 'wheel',          createRenderer, computeFinalPosition → computeFinalRotation }
STRIP_PACKAGE          = { id: 'strip',          createRenderer, computeFinalPosition → computeFinalScrollOffset }
COUNTING_RHYME_PACKAGE = { id: 'counting-rhyme', createRenderer, computeFinalPosition → computeFinalCountingPosition }
export const VISUALIZATION_PACKAGES = { wheel, strip, 'counting-rhyme' } as const;
export function getVisualizationPackage(type): VisualizationPackage;
```

`computeFinalPosition` exposes an optional `canvasWidth?: number`. The wheel
and strip packages forward it; the Counting Rhyme package deliberately does
not — its position math lives entirely in cycle space (§9).

`App` selects a visualization by registry lookup — no `switch` statement.

---

## 11. App orchestration (`app.ts`)

`App` owns the UI and drives the game. It contains **no mode-specific logic**
and, since Stage 4, **no game-state mutation** either.

**Responsibilities:** DOM wiring, settings panels, lot-list rendering and
sorting, import execution, animation driving, result display, control
enable/disable, theme application.

**Key state:** `lotManager`, `gameSession`, `renderer`,
`animationController`, `settings`, `easingFunction`, `highlightedLotId`,
`isSettingsLocked`, `sortField`, `sortDirection`, DOM handles.

**Derived:** `get mode(): GameMode { return this.gameSession.mode; }` — the
mode is owned by the session. `settings.modeId` is written **only** as a UI /
persistence mirror; it is never read back to drive the session.

**Session orchestration (Stages 1 – 4).** Every global-lot mutation is paired
with the matching `GameSession` call at the mutation site; there is **no**
`syncGameSession()` step to remember:

| `LotManager` operation        | paired `GameSession` operation                       |
|-------------------------------|------------------------------------------------------|
| `addLot(name, amount, color)` | `gameSession.addLot(result.lot)`                     |
| `deleteLot(id)`               | `gameSession.removeLot(id)`                          |
| `clearAll()`                  | `gameSession.clearLots()`                            |
| `resetAll()`                  | `gameSession.reset()`                                |
| (bulk) import strategy        | `gameSession.reconcileAfterBulkChange(idsBefore)`    |
| `updateLot(id, { amount })`   | — (participation unaffected)                         |
| *(turn lifecycle)*            | `gameSession.prepareSpin()` / `gameSession.finishSpin()` (Stage 4) |

Mode change is a single entry point: `gameSession.setMode(id)` plus a
mirror to `settings.modeId`, followed by `renderer.updateSegments(...)` and
`render()`. Participation is deliberately preserved across a mode switch
(§13).

`App` never calls `processRoll()`, `RouletteEngine.roll()`, or
`deactivateMany()` — those live inside `GameSession` (Stage 4).

### Initialization order
1. Create `LotManager`, `renderer` (via `rendererFactory`), `AnimationController`.
2. Cache DOM handles.
3. `updateUI()`; set slider/number input to the 3 s default.
4. Pick a random colour for the new-lot indicator.
5. Read `localStorage` theme (fallback `'dark'`), `applyTheme`, sync selector.
6. Set the result text to the current mode name.
7. `setupEventListeners()`.

The inline head script in `index.html` applies `data-theme` before first
paint, so the theme never flashes on reload.

---

## 12. Spin lifecycle — the critical business flow

Since Stage 4 the turn lifecycle is split cleanly between `App` (animation +
UI) and `GameSession` (validation, rolling, state transitions).

```
spin() [App]
  ├─ rolledLot = gameSession.prepareSpin()                  // session: validate + roll + remember
  │     └─ if null → alert(noLotsToSpin); return
  ├─ isSettingsLocked = true; updateControlsState()          // lock UI (after roll succeeds)
  ├─ vizPackage = getVisualizationPackage(settings.visualization)
  ├─ endRotation = vizPackage.computeFinalPosition(
  │        gameSession.activeLots, gameSession.mode, rolledLot.id,
  │        renderer.getCurrentRotation(), animationDuration, canvasWidth)
  ├─ animationController.configure({ startValue, endValue,
  │        duration, easing, onUpdate: setRotation+render,
  │        onComplete: () => finishSpin() })
  └─ animationController.start()

GameSession.prepareSpin()  (internal)
  ├─ active = activeLots
  ├─ if (!RouletteEngine.canSpin(active)) → return null
  ├─ rolledLot = RouletteEngine.roll(active, currentMode)    // DECISION MADE HERE
  ├─ if (!rolledLot) → return null
  ├─ pendingRolledLot = rolledLot
  └─ return rolledLot

finishSpin() [App]
  ├─ outcome = gameSession.finishSpin()
  │     └─ if null → updateControlsState(); return
  ├─ { rolledLot, result } = outcome
  ├─ highlightedLotId = rolledLot.id
  ├─ resultText = gameSession.mode.getRollText(rolledLot)
  ├─ if result.finished:
  │     highlightedLotId = result.winner?.id ?? highlightedLotId
  │     if result.message → alert(result.message) after 500 ms
  │     isSettingsLocked = true                              // lock until Reset
  │   else:
  │     isSettingsLocked = false                             // next spin allowed
  └─ updateUI(); renderer.updateSegments(gameSession.activeLots, gameSession.mode);
      render(); updateControlsState()

GameSession.finishSpin()  (internal)
  ├─ rolledLot = pendingRolledLot; if null → return null
  ├─ pendingRolledLot = null                                 // clear BEFORE processing
  ├─ result = currentMode.processRoll(rolledLot, state)      // RULES APPLIED HERE
  ├─ if result.deactivate.length > 0 → deactivateMany(result.deactivate)
  └─ return { rolledLot, result }
```

The winner is decided inside `GameSession.prepareSpin()`, i.e. **before**
`App` configures or starts any animation; the animation only moves the
wheel / strip / circle grid to a pre-computed position.

**Refactor note (Stage 4, refac4.md §3–§12).**
- `App` never touches `GameSession.activeLotIds`, never calls
  `processRoll` and never calls `deactivateMany` — all of that is inside
  `GameSession.finishSpin()`.
- `isSettingsLocked = true` is now set **after** `prepareSpin()` succeeds,
  so a failed validation no longer leaves the UI permanently locked.
- `reset()` on the session nulls the pending rolled lot, so a late
  `onComplete` (e.g. after `AnimationController.stop()` followed by a fresh
  start) cannot replay a stale roll — `finishSpin()` returns `null` in that
  case and `App` is a no-op apart from re-evaluating control state.

### Worked example — Survival with three lots (A=1302, B=150, C=148.5)

```
spin #1 → prepareSpin rolls B → finishSpin: deactivate B → active = {A, C}
        → finished=false → next spin allowed
spin #2 → prepareSpin rolls C → finishSpin: remaining = {A} → winner A,
        finished=true → UI locks
```

No third spin occurs. For Normal mode, a single spin yields `finished=true` with
the rolled lot as winner.

---

## 13. Import subsystem

Three cooperating layers:

1. **Tabs** (`csvTabContent.ts`, `linkTabContent.ts`) produce `ParsedLot[]`.
   - CSV tab: textarea + comma/tab separator switch; parses via `csvParser`.
   - Link tab: URL input + fetch; `extractGoogleDocId` validates a Google Sheets
     URL and extracts the document id (and gid).
2. **Coordinator** (`importDialog.ts`) hosts both tabs, tracks the active tab,
   aggregates its `getParsedResult()`, shows a shared valid/error status line
   and a preview, and hands `ParsedLot[]` to the callback on Import.
3. **Strategies** (`importStrategies.ts`) — pure executors `{ id, execute }`,
   with no UI strings:
   - `REPLACE_STRATEGY` — `clearAll()`, then adds new lots up to `MAX_LOTS`.
   - `MERGE_STRATEGY` — matches by lowercase name (updates amount on a match,
     otherwise adds), up to `MAX_LOTS`.
   - Both return `{ lotsAdded, lotsTruncated }`.
   - The conflict-dialog buttons drive their text via
     `data-i18n="importStrategy.<id>.label|description"` keys, so labels
     retranslate on language change.

   **Session reconciliation after import.** Before running a strategy, `App`
   snapshots the global lot ids (`idsBefore`). After the strategy returns it
   calls `gameSession.reconcileAfterBulkChange(idsBefore)`: kept ids preserve
   prior participation, newly created ids become active, stale ids are
   dropped. This is what keeps the §5.1 invariant.

If lots already exist, `ImportConflictDialog` asks the user to Replace / Merge /
Cancel. Truncation is reported via `ErrorDialog` with a summary message.

### CSV parsing (`csvParser.ts`)
- Uses PapaParse with `header: false`, `skipEmptyLines: true`, and the chosen
  delimiter.
- Requires ≥ 2 columns and a non-empty name per row.
- Ambiguous decimal handling via `normalizeAmount`, recognising both
  `1,234.56` (en) and `1.234,56` (eu) conventions.
- Header auto-detection: the first row is silently skipped as a header only if
  at least one further row exists and the first row's amount is not a valid
  number.

---

## 14. Modal system

- `modalManager.ts` — singleton; monotonic z-index for stacked dialogs; tracks
  open modals; `retranslateAllOpenModals`.
- `modalDialog.ts` — abstract base: `overlay`/`content` structure, `renderHeader`,
  `renderContent`, `renderFooter`, `retranslate`, `isHidden`, `destroy`.
- `errorDialog.ts` — simple message dialog with an OK button.
- `importConflictDialog.ts` — Replace / Merge / Cancel chooser.
- `importDialog.ts` — multi-use coordinator; its `onClose` always destroys it,
  preventing stale DOM between openings.

---

## 15. Internationalization (`i18n.ts`)

- Wraps i18next; resources from `locales/en.json` and `locales/ru.json`.
- `t(key, params)` for programmatic lookups.
- `translateDOM()` walks `[data-i18n]`, `[data-i18n-placeholder]`,
  `[data-i18n-title]` and replaces text/attributes.
- `initI18n()` is awaited once at startup (`startApp()`).
- The language `select` calls `i18n.changeLanguage` then `translateDOM()`.
- `syncDocumentLang()` writes the resolved i18n language to
  `<html lang="...">` so screen readers and font shaping target the correct
  locale. It runs once inside `initI18n()` and again from `App`'s language
  handler after every `i18n.changeLanguage(...)`.

---

## 16. Theming (`styles.css`, `index.html`, `app.ts`)

- Palettes are CSS custom properties on `:root` (default / dark) and
  `:root[data-theme="light"|"emerald"|"nordic"|"monochrome"]`. Five themes
  total.
- All stylesheet rules reference these variables; no hardcoded palette colours
  exist outside the theme blocks.
- `index.html` sets `data-theme` from `localStorage` in an inline head script
  before first paint.
- `App.applyTheme(id)` sets the attribute and persists it.
- Theme is intentionally not part of `Settings` and is not reset by `reset()`.

---

## 17. Animation (`animation.ts`)

- `EasingFunctions` — named easing curves; `DEFAULT_EASING` is
  `rouletteEaseOut` (a cubic/quintic blend deliberately distinct from
  `easeOutQuint`).
- `AnimationController` — `configure({ startValue, endValue, duration, easing,
  onUpdate, onComplete })`, `start()`, `stop()`, `isAnimating()`.
- Frame loop uses `requestAnimationFrame` with elapsed-time progress and applies
  the easing curve; on completion it fires `onUpdate(endValue, 1)`, clears its
  state (so `isAnimating()` returns `false`), then fires `onComplete()` — a
  correct ordering for the app's final `updateControlsState()`.

---

## 18. Utilities (`utils.ts`)

| Function | Purpose |
|----------|---------|
| `generateRandomReadableColor()` | HSL colour with controlled lightness for label contrast |
| `brightenColor(color, percent)` | Hex → lightened hex, used for highlights |
| `getSegmentWidth(weight)` | Strip segment width from a normalized weight; single source of truth shared by the strip renderer and RouletteEngine's scroll math |
| `sliderToDuration(v)` / `durationToSlider(s)` | Bidirectional mapping; 1–60 s linear, above that a non-linear map |
| `getRandomPositionInRange(...)` | Random landing position within a segment, with edge margins |

Constants: `MIN_DURATION_SEC`, `MAX_DURATION_SEC`, `MAX_DURATION_SLIDER_VALUE`,
`MIN_SEGMENT_WIDTH` (= 60), `SEGMENT_WIDTH_SCALE` (= 400).

---

## 19. Business-logic invariants

1. **Result before animation.** The winner/eliminated lot is chosen inside
   `GameSession.prepareSpin()` — before the animation starts. The animation
   only moves the visualization to a pre-computed position and cannot change
   the outcome.
2. **Modes own their rules.** All game rules live in `NormalMode` /
   `SurvivalMode`. Adding a mode requires editing only `modes.ts` and one new
   class.
3. **Engine and state are mode-agnostic.** `RouletteEngine` and `LotManager`
   never reference mode names.
4. **Winner decided post-elimination.** Survival computes its winner from the
   list after removing the rolled lot, so the last standing lot is never spun
   again.
5. **Locked until Reset.** Once a game finishes (`finished === true`), spin is
   locked until the user presses Reset.
6. **GameSession owns participation.** The game path never reads or writes
   `Lot.active`. The participant set lives in `GameSession.activeLotIds`;
   global lot existence lives in `LotManager`. The `GameState` passed to
   `processRoll` is materialised from the session, so a stale id can never
   leak into a mode.
7. **GameSession owns the turn lifecycle.** Since Stage 4, rules are applied
   inside `GameSession.finishSpin()`. `App` reads the returned
   `{ rolledLot, result }` for UI only and never mutates game state itself.
8. **Pending-spin context is single-use.** A pending rolled lot exists only
   between `prepareSpin()` and `finishSpin()`; `finishSpin()` clears it
   before invoking `processRoll`, and `reset()` clears it too — a stale roll
   can never be replayed.

---

## 20. Known issues / technical debt

**Remaining (Stage 5+).**

| # | Issue | Impact |
|---|-------|--------|
| 1 | `App` still re-resolves `gameSession.mode` inline in `spin()` / `finishSpin()`; a mode change during animation would desync the current mode from the animation-time mode | Rare — capture the mode once at `spin()` entry if the hazard is worth closing |
| 2 | `rendererFactory.ts` duplicates the registry lookup already exposed by `VisualizationPackage.createRenderer` | Redundant indirection, harmless |
| 3 | Dead imports in `app.ts` (`parseCSV`, `ModalManager`, `IMPORT_STRATEGIES`, `ParseResult`, `SeparatorType`) | Obscures ownership of CSV parsing; TS `noUnusedLocals` would flag them |
| 4 | `RouletteEngine.getSegmentCenterAngle` is defined but unused | Dead code |
| 5 | **Transitional (Stage 3).** `Lot.active` and `LotManager` members `toggleActive` / `deactivateLot` / `deactivateMany` / `resetAll` / `getActiveLots` / `getActiveCount` / `getState` are no longer used by the game path | Dead code — removal is a follow-up refactor stage |
| 6 | **Transitional (Stage 3).** `App.reset()` still calls `lotManager.resetAll()` **and** `gameSession.reset()` — the first is kept only to keep the inert `Lot.active` flag consistent | Two-step reset; collapses to `gameSession.reset()` once `Lot.active` is removed |
| 7 | `importStrategies.ts` receives `LotManager` typed as `any` in the `ImportStrategy` interface rather than a concrete type | Intentional while `LotManager` owns the global list; the `any` obscures the contract |

**Resolved during the refactor (kept for traceability).**

- The former `#lot-form input` selector in `updateControlsState()` (now targets
  the actual add-row / per-lot controls).
- The module-load-time `i18n.t()` calls and hardcoded English
  `MERGE_STRATEGY.description` in `importStrategies.ts` (labels live in
  locales, driven by `data-i18n`).
- The failing `<html lang>` update on language switch (`syncDocumentLang()`
  now runs from `initI18n` and from the language handler).
- The `rouletteEaseOut === easeOutQuint` duplicate (now a distinct
  cubic/quintic blend).
- **Stage 3:** participation state moved from `Lot.active` to
  `GameSession.activeLotIds`; `syncGameSession()` eliminated in favour of
  explicit participation mutations; post-import reconciliation via
  `GameSession.reconcileAfterBulkChange(previousIds)`.
- **Stage 4:** the turn lifecycle (`RouletteEngine.roll` → `GameMode.processRoll`
  → `deactivateMany`) moved from `App.finishSpin` into
  `GameSession.prepareSpin()` / `GameSession.finishSpin()`. `App.spin` no
  longer sets `isSettingsLocked = true` before validation runs, so a failed
  spin cannot leave the UI locked. The former `App.spin` early-return-after-lock
  hazard (previously listed here) is now closed.
