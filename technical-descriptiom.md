# Scam Roulette — Technical Description

Structural description of the application's architecture and business logic.
Client-only, single-page web application.

> **STATUS: consolidated state.**
> The staged refactor has completed through **Stage 5**, **Sub-stage A**
> (session / spin lifecycle locks), **Sub-stage B** (spin-time configuration
> widening), and the **A1/A2 corrective pass** (lifecycle consistency,
> exception safety, structured spin-failure reporting, finished-game UI
> freeze, unified lock derivation). §20 lists what remains for later
> stages.

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
├── styles.css                  # all styling; 5 theme palettes via :root[data-theme="…"]
├── papaparse.min.js            # third-party CSV parser
├── technical-descriptiom.md    # this document
├── locales/
│   ├── en.json
│   └── ru.json
└── *.ts                        # application sources (compiled to sibling *.js)
    ├── app.ts                      # entry point + orchestration + UI
    ├── gameSession.ts              # current-game state, turn lifecycle, locks
    ├── types.ts                    # all shared contracts
    ├── modes.ts                    # game-mode registry
    ├── NormalMode.ts               # GameMode implementation
    ├── SurvivalMode.ts             # GameMode implementation
    ├── rouletteEngine.ts           # weighted random + geometry
    ├── lotManager.ts               # global lot storage
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

Dependencies point downward only.

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
                │ lotManager (global)    │
                │ gameSession (session)  │
                └──────────────┬─────────┘
 L1 Domain      ┌──────────────▼─────────┐
                │ types.ts               │
 L0 Infra       │ i18n.ts, utils.ts,     │
                │ animation.ts,          │
                │ csvParser.ts           │
                └────────────────────────┘
```

**Core rule:** dependencies point downward only. `App` knows *that* a game
mode exists, never *how* it plays. `RouletteEngine` and `LotManager` are
entirely mode-agnostic — they only receive a `GameMode` and call its
`calculateWeight`.

**Refactor note (Stages 1 – 5, Sub-stage A/B, A1/A2).** `GameSession`
(`gameSession.ts`) sits between `App` and the state layers. It owns:

- the current `GameMode`;
- the participation set (`activeLotIds: Set<string>`);
- the **turn lifecycle** (`prepareSpin()` / `finishSpin()`, Stage 4);
- the **lifecycle locks** (`sessionLocked`, `spinInProgress`, `gameFinished`,
  Sub-stage A).

It exposes `allLots` / `activeLots` / `activeCount` / `state` / `isActive()`
as live projections over `LotManager`'s global list. `LotManager` owns the
**global** lot collection only. There is no `syncGameSession()` anywhere —
participation mutations are explicit calls on `GameSession` (§5.1, §11, §12).
The evolution of the model across the staged iterations is documented in §20.

---

## 5. Domain model (`types.ts`)

| Type | Shape / role |
|------|--------------|
| `Lot` | `{ id, name, amount, color }` — the atomic unit |
| `Mode` | `'normal' \| 'survival'` |
| `VisualizationType` | `'wheel' \| 'strip' \| 'counting-rhyme'` |
| `Settings` | `{ modeId, visualization, animationDuration }`; theme and language are intentionally not part of `Settings` |
| `Segment` | `{ lot, startAngle, endAngle, weight }` — `weight` is normalized (0–1) |
| `GameState` | `{ allLots: Lot[], activeLots: Lot[] }` |
| `RollResult` | `{ finished, winner: Lot\|null, deactivate: string[], message? }` |
| `PrepareSpinFailureReason` | `'spinInProgress' \| 'gameFinished' \| 'noActiveLots' \| 'noValidWeights'` — the four current `prepareSpin()` refusal branches (A1/A2) |
| `PrepareSpinResult` | Discriminated union: `{ ok: true, lot }` \| `{ ok: false, reason }` — replaces the previous `Lot \| null` (A1/A2) |
| `GameMode` | `{ id, name, description, calculateWeight, getRollText, processRoll }` |
| `IRenderer` | `updateSegments`, `setRotation`, `getCurrentRotation`, `setHighlightedLot`, `render`, `reset`. `render()` takes **no arguments** — each renderer derives its own logical canvas size |
| `VisualizationPackage` | `{ id, createRenderer, computeFinalPosition }` (optional `canvasWidth?` in `computeFinalPosition`) |
| `ParsedLot` / `ParseResult` | `{ name, amount }` / `{ validLots, errorCount }` |
| `ImportResult` | `{ lotsAdded, lotsTruncated }` |
| `ImportStrategy` | `{ id, execute(parsedLots, lotManager): ImportResult }` — labels/descriptions live only in locale files (`data-i18n="importStrategy.<id>.…"`), not on the strategy object |
| `SortField` / `SortDirection` | `'name' \| 'amount'` / `'asc' \| 'desc'` |
| `EasingFunction` | `(t: number) => number` |

### 5.1 `GameSession` — current-game state, lifecycle, and locks

Owns the state of the *current game* — separate from the *global* lot list
owned by `LotManager`.

| Member | Role |
|--------|------|
| `constructor(modeId, getLots)` | Binds the mode; stores an accessor for the global list (typically `() => lotManager.getAllLots()`); seeds `activeLotIds` from the current list; starts with every lock released. |
| `mode` (getter) | The `GameMode` governing the session. |
| `allLots` (getter) | Live view of the global list. |
| `activeLots` (getter) | Global list filtered by `activeLotIds`, recomputed on every read. |
| `activeCount` (getter) | `activeLots.length`. |
| `state` (getter) | `{ allLots, activeLots }` snapshot for `GameMode.processRoll`. |
| `isActive(id)` | Participation query used by the UI list. |
| `addLot(lot)` / `removeLot(id)` | Explicit participation mutation (paired with `LotManager.addLot` / `deleteLot`). **Rejected while `sessionLocked`.** |
| `deactivateMany(ids)` | Removes several participants (spin eliminations). **Deliberately not guarded** — it is invoked from `finishSpin()` while the session is already locked (§3 of planA). |
| `clearLots()` | Empties participation (paired with `LotManager.clearAll`). **Rejected while `sessionLocked`.** |
| `reset()` | Clears the pending spin context and **releases every lifecycle flag** (`sessionLocked`, `spinInProgress`, `gameFinished`); re-seeds `activeLotIds` from the current global list. |
| `reconcileAfterBulkChange(previousIds)` | Post-import diff: kept ids preserve prior participation, new ids become active, stale ids dropped. **Rejected while `sessionLocked`.** |
| `prepareSpin()` | Validates via `RouletteEngine.canSpin()`, refuses if a spin is in flight or the game is finished, rolls via `RouletteEngine.roll()`, stores the pending rolled lot, and **atomically raises both `sessionLocked` and `spinInProgress`**. Returns a discriminated **`PrepareSpinResult`** — `{ ok: true, lot }` on success, `{ ok: false, reason }` on each of the four refusal branches. The winner is decided *before* any animation starts. |
| `finishSpin()` | Reads the pending rolled lot; **nulls the pending context** and invokes `GameMode.processRoll` **inside a `try/finally`**. Applies any eliminations internally (`deactivateMany`), sets `gameFinished` on a `finished` result, and **releases `spinInProgress` in `finally`**. Returns `{ rolledLot, result }` — or `null` if there is no pending spin. An exception from `processRoll` is **not** swallowed: it propagates to `App`, and the session stays `sessionLocked` with `gameFinished` untouched. |
| `setMode(modeId)` | Single authoritative mode change. **Rejected while `sessionLocked`** (planA §14). Participation is preserved across a switch. |
| `isSessionLocked` / `isSpinInProgress` / `isGameFinished` (getters) | Read-only mirrors of the three lifecycle flags; the UI derives `disabled` states from them and stores no copy. |

**Flag semantics (Sub-stage A; refined by A1/A2).** The three flags are
orthogonal concepts:

- `sessionLocked` — set on the first successful `prepareSpin()`; cleared only
  by `reset()`. Freezes every session-level mutation (participation, mode,
  bulk reconciliation). Never cleared by `finishSpin()`.
- `spinInProgress` — set by `prepareSpin()`, released by the matching
  `finishSpin()` (in its `finally`). Freezes the controls that cannot change
  mid-animation: duration slider/number input, visualization select, easing
  select, Spin itself. Between the spins of an unfinished Survival game it
  is released, so those controls become editable again.
- `gameFinished` — set when a `RollResult` with `finished === true` is
  applied; cleared only by `reset()`. Keeps Spin disabled after the game
  ends, and — through the derived `spinTimeLocked` in `App` — also freezes
  the spin-time configuration controls even after `spinInProgress` is
  released by the last `finishSpin()`.

**Implicit invariant:** `spinInProgress === true` always implies
`sessionLocked === true`, because both are raised by the same
`prepareSpin()` call, and `spinInProgress` is only cleared by `finishSpin()`
which never touches `sessionLocked`. A review of `prepareSpin()`,
`finishSpin()`, `reset()`, and every error path confirms no place exists
where `spinInProgress` could be raised alone. `App` relies on this
invariant when it simplifies its session-level guards (§11).

**Invariants.**

- Every lot returned by `activeLots` / `state` exists in `LotManager` —
  holds by construction, because both are materialised from the live
  accessor. This is the Stage 3 §7 invariant.
- A pending rolled lot exists only between a successful `prepareSpin()` and
  the matching `finishSpin()`. `finishSpin()` nulls the context *before*
  invoking `processRoll`, and `reset()` nulls it as well, so re-entrant or
  late completions cannot replay a stale roll (refac4.md §12 / §17).
- A failed `prepareSpin()` (any `{ ok: false, reason }` result) leaves all
  three lifecycle flags and `pendingRolledLot` untouched (A1/A2).

---

## 6. Game mode strategy — the business core

All mode-specific rules live inside a `GameMode` implementation. There is no
`if (mode === 'survival')` in `App`, `RouletteEngine`, or `LotManager`.

### Registry (`modes.ts`)

`modes.ts` exposes a `MODES` map holding one shared, stateless instance per
`Mode` (`normal`, `survival`), plus a `getMode(modeId)` accessor that returns
the cached instance. Adding a new mode requires one new class and one new
entry in `MODES`; nothing else changes.

### Normal mode (`NormalMode.ts`)

| Aspect | Behaviour |
|--------|-----------|
| Weight | `amount` — higher amount → higher chance to win |
| Roll text | `Winner: {{name}}` |
| `processRoll` | Returns `finished: true`, the rolled lot as winner, and an empty `deactivate` list |

A single spin selects the winner; the game ends immediately.

### Survival mode (`SurvivalMode.ts`)

| Aspect | Behaviour |
|--------|-----------|
| Weight | `1 / amount` — lower amount → higher chance of elimination |
| Roll text | `Eliminated: {{name}}` |
| `processRoll` | Eliminates the rolled lot; decides the winner from the **post-elimination** state |

`processRoll` logic:

```
remaining = state.activeLots minus the rolled lot

if remaining.length === 1:
    finished = true
    winner    = remaining[0]
    deactivate = [rolledLot.id]
    message    = completionMessage(winner)
otherwise:
    finished  = false
    winner    = null
    deactivate = [rolledLot.id]
```

**Key design point:** the winner is computed from the list *after* removing
the rolled lot. This prevents the historical bug where the last lot standing
was eliminated by an extra spin. The last remaining lot never undergoes
another spin — the spin button is disabled as soon as the game is finished.

### Mode metadata

`name` and `description` are **late-bound getters** that call `t(...)` on
each access, so a language switch updates them immediately (unlike plain
string fields captured at module-load time).

---

## 7. RouletteEngine (`rouletteEngine.ts`)

Static, stateless mechanics. It never references survival, elimination,
winner, or completion.

| Method | Responsibility |
|--------|----------------|
| `roll(lots, mode)` | Weighted random selection via cumulative distribution. The only source of randomness in the game path. Returns `Lot \| null`. |
| `calculateSegments(lots, mode)` | Normalizes weights across `[0, 2π)`; returns `Segment[]` (used by every renderer). |
| `computeFinalRotation(lots, mode, targetLotId, currentRotation, durationMs)` | Wheel: rotation that places the target segment centre under the fixed top pointer, plus extra full turns scaled by duration. |
| `computeFinalScrollOffset(lots, mode, targetLotId, currentOffset, durationMs, canvasWidth)` | Strip: horizontal offset that places the target segment centre under the viewport centre, plus extra cycles. |
| `computeFinalCountingPosition(lots, mode, targetLotId, currentPosition, durationMs)` | Counting Rhyme: returns the cycle-space end position with residue equal to the target circle's midpoint (`endValue ≡ targetMid (mod 1)`), plus extra cycles scaled by duration. Five parameters — no `canvasWidth` (layout math is renderer-side). |
| `canSpin(activeLots)` | Returns `activeLots.length >= 1`. |

Segment width (strip) is derived via `getSegmentWidth(normalizedWeight)` from
`utils.ts` — a **single source of truth** shared by the strip renderer's
drawing pass and `computeFinalScrollOffset`'s scroll math, so the two cannot
drift apart. The formula is `Math.max(60, normalizedWeight * 400)`.

---

## 8. LotManager (`lotManager.ts`)

Owns the *global* `Lot[]` — the universe of lots. Knows nothing about game
modes, winners, rules, or which lots participate in the current game.
Participation is owned by `GameSession` (§5.1).

| Method | Purpose |
|--------|---------|
| `addLot(name, amount, color)` | Adds a lot; returns `{ success, message }` (validation lives here) |
| `updateLot(id, patch)` | Updates a lot's fields (e.g. `{ amount }`) |
| `deleteLot(id)` | Removes a lot |
| `getLotById(id)` | Read access for a single lot |
| `clearAll()` | Removes all lots |
| `getAllLots()` | Read access |
| `getTotalCount()` | Count |
| `LotManager.MAX_LOTS` | Static limit = `3000` |

---

## 9. Renderers (`baseRenderer.ts`, `wheelRenderer.ts`, `stripRenderer.ts`, `countingRhymeRenderer.ts`)

All renderers implement `IRenderer`. They receive a `GameMode` in
`updateSegments` and delegate weight math to `RouletteEngine.calculateSegments`.
None computes weights itself. `BaseRenderer` supplies the shared state and
high-DPI setup; each concrete renderer owns only its drawing and (optionally)
a cached layout.

### `BaseRenderer`

Abstract base class shared by every concrete renderer. Owns the state and
lifecycle that used to be duplicated between the renderers:

- **State:** `canvas` and `ctx` (both `protected readonly`), `segments`,
  `currentRotation`, `highlightedLotId`.
- **Constructor:** grabs the 2D context and calls `setupHighDPI()`.
- **`getLogicalSize()`** — returns the canvas's logical (CSS-pixel) size,
  with a `600 × 500` fallback applied **only when a rect dimension is zero**
  (canvas not yet laid out). Single source of the fallback, consumed by
  `setupHighDPI()` and by every concrete `render()`.
- **`setupHighDPI()`** — reads `devicePixelRatio`, sizes the backing store
  from `getLogicalSize()`, and applies `ctx.scale(dpr, dpr)`.
- **`updateSegments(lots, mode)`** — calls `RouletteEngine.calculateSegments`
  and stores the result. Subclasses override it to add caching (see
  `StripRenderer` / `CountingRhymeRenderer`).
- **`setRotation` / `getCurrentRotation` / `setHighlightedLot` / `reset`** —
  trivial state accessors plus a shared reset of `currentRotation`,
  `highlightedLotId`, and `segments`.
- **`render()`** is abstract and takes **no arguments** — each renderer
  obtains its own dimensions from `getLogicalSize()`.

### `WheelRenderer`

Segment/ring/pointer/label geometry is defined by module-level constants
(`WHEEL_MARGIN`, `SEGMENT_STROKE_WIDTH`, `HIGHLIGHT_BRIGHTNESS`, `LABEL_*`,
`POINTER_*`, `OUTER_RING_*`, `INNER_RING_*`). `render()` reads its own
dimensions via `getLogicalSize()`. Rendering:

- Radius: `min(centerX, centerY) - WHEEL_MARGIN` (= 30).
- Segments drawn as arcs; white 2 px stroke; labels at `0.7 * radius`,
  rotated by mid-angle, drawn only when the arc span exceeds `LABEL_MIN_ARC`.
- Highlight → `brightenColor(color, HIGHLIGHT_BRIGHTNESS)` (= 30).
- Cursor: a gold downward triangle at the top, with a glow.
- Frame: outer decorative ring at `radius + OUTER_RING_OFFSET` (= 10)
  plus a subtle inner ring at `radius - INNER_RING_OFFSET` (= 5).

### `StripRenderer`

- **`updateSegments(lots, mode)`** — after `super.updateSegments`, sums
  `getSegmentWidth(s.weight)` over all segments and caches the result in
  `totalCycleWidth`. Recomputed only when the lots/mode change, never inside
  the animation frame loop.
- **`reset()`** — calls `super.reset()` and clears `totalCycleWidth`.
- **`render()`** — reads its own dimensions via `getLogicalSize()`; renders
  infinite scroll via modulo of the accumulated offset over one cycle's
  width (`getVisualOffset`), with cyclic buffer copies (`getCyclesNeeded`
  → `renderOneCycle`).

Behaviour: segment width comes exclusively from
`getSegmentWidth(weight)`; band height 160; vertical labels (rotated `-π/2`),
truncated per constants; highlight → `brightenColor` plus a gold glow;
cursor is a gold dashed vertical centre line with arrows; frame is a
rectangular decorative frame (`rgba(255,255,255,0.3)`, 4 px).

### `CountingRhymeRenderer`

Each active lot is drawn as a filled circle in a grid. The per-frame highlight
is derived **inside `render()` from `currentRotation` and the cached prefix
sums of `Segment.weight`** — **not** from `highlightedLotId` (which is never
driven for this renderer). `render()` reads its own dimensions via
`getLogicalSize()`.

- **Cycle domain.** `currentRotation` is measured in *cycles*: `1.0` = one
  full traversal of the circle ring. Circle `i` owns `[P_i, P_{i+1})` of
  `[0, 1)` where `P` is the prefix sum of normalized weights, so dwell per
  traversal is exactly `w_i · T_cycle`.
- **Radius** is proportional to the lot's weight *relative to the heaviest
  active weight* (`w_i / max(w)`), not to the raw normalized weight.
- **Grid mapping is permuted** deterministically (FNV-1a seed over the lot
  ids drives an LCG Fisher–Yates shuffle of cell indices). Cosmetic only:
  the highlight order remains `segments[0..n-1]`, only the *position* of each
  circle changes. Same lot set → same arrangement, so Survival does not
  reshuffle between eliminations.
- **Layout is computed once** in `updateSegments()` and cached; `render()`
  never regenerates it.
- **Highlight uses a crossfade** over a `TRANSITION_FRACTION = 0.2` window
  expressed as a fraction of the *current* segment, so dwell proportionality
  is preserved.
- **Last-frame guarantee.** `computeFinalCountingPosition()` returns
  `endValue ≡ targetMid (mod 1)`; `AnimationController` fires
  `onUpdate(endValue, 1)` before `onComplete()`, so the final animated frame
  resolves to the rolled lot.

---

## 10. Visualization strategy (`visualizationStrategy.ts`)

Each visualization is a `VisualizationPackage` bundling a renderer factory and
a final-position function:

```
WHEEL_PACKAGE          = { id: 'wheel',          createRenderer, computeFinalPosition → computeFinalRotation }
STRIP_PACKAGE          = { id: 'strip',          createRenderer, computeFinalPosition → computeFinalScrollOffset }
COUNTING_RHYME_PACKAGE = { id: 'counting-rhyme', createRenderer, computeFinalPosition → computeFinalCountingPosition }
VISUALIZATION_PACKAGES = { wheel, strip, 'counting-rhyme' }
getVisualizationPackage(type) → the corresponding package
```

`computeFinalPosition` exposes an optional `canvasWidth?: number`. The wheel
and strip packages forward it; the Counting Rhyme package deliberately does
not — its position math lives entirely in cycle space (§9).

`App` selects a visualization by registry lookup — no `switch` statement.
The registry is also the **sole** authority for *which renderer* corresponds
to a visualization — `rendererFactory.ts` was removed in Stage 5 as a
redundant second lookup, and the same registry now also serves the
visualization-change handler via `App.recreateRenderer()` (§11).

---

## 11. App orchestration (`app.ts`)

`App` owns the UI and drives the game. It contains **no mode-specific logic**
and, since Stage 4, **no game-state mutation** either. Since Sub-stage A,
it also **stores no lock flags** — it derives every lifecycle-dependent
`disabled` state from the read-only `GameSession` properties.

**Responsibilities:** DOM wiring, settings panels, lot-list rendering and
sorting, import execution, animation driving, result display, control
enable/disable, theme application, and renderer (re)construction via the
visualization registry.

**Key state:** `lotManager`, `gameSession`, `renderer`,
`animationController`, `settings`, `easingFunction`, `highlightedLotId`,
`sortField`, `sortDirection`, DOM handles. `App` keeps **no** `isLocked`
mirror of any kind.

**Derived:** `get mode(): GameMode { return this.gameSession.mode; }` — the
mode is owned by the session. `settings.modeId` is written **only** as a UI /
persistence mirror; it is never read back to drive the session.

**Renderer construction:** `App.recreateRenderer()` is a private factory
method that asks the visualization registry for a fresh `IRenderer` bound to
the app's canvas. It is called once from the constructor (after the canvas
has been resolved) and again from the `visualizationSelect` change handler.
It performs no drawing and does not seed segments — callers assign its
return value to `this.renderer` and follow up with `updateSegments` +
`render()`.

### Control-state derivation (`updateControlsState`)

`App.updateControlsState()` is the single point that translates the three
`GameSession` lifecycle flags into `disabled` attributes. It never stores
lock state of its own.

Two derived booleans drive the mapping:

- `sessionLevelLocked = isSessionLocked` — simplification of the former
  ORed form `isSessionLocked || isSpinInProgress`, which was redundant
  because of the §5.1 invariant `spinInProgress ⇒ sessionLocked` (A1 §3).
  The two *concepts* stay separate — only the redundancy was removed.
- `spinTimeLocked = isSpinInProgress || isGameFinished` — covers both the
  mid-animation state and the finished-game state. It governs precisely
  the configuration controls that used to be tied to `spinning` alone
  (A1 — finished-game UI).

Mapping per control group:

- **Spin** — disabled while `isSpinInProgress || isGameFinished`.
- **Reset** — always enabled (the user must be able to abandon a session,
  including mid-spin and after a failure).
- **Session-level configuration** (mode select, import button, clear button)
  — disabled while `sessionLevelLocked`.
- **Lot-editing controls** (`.add-row` inputs, per-lot amount inputs, delete
  buttons) — disabled while `sessionLevelLocked`.
- **Spin-time configuration** (duration slider and number input,
  visualization select, easing select) — disabled while `spinTimeLocked`.
  Editable between spins of an unfinished Survival game (planA §5); frozen
  once the game has finished (A1).
- **Sorting** — never disabled: sorting is a pure presentation operation
  (planA §11). Sorting freely does not touch participation.

Where `updateControlsState()` is called from (A1 — single derivation point):

- `renderLotsList()` invokes it at the end, so **any path that re-renders
  the lot list re-applies the lock state to the freshly-created controls**
  without the caller needing a follow-up call. `setSortField()` and
  `updateUI()` rely on this and no longer call it explicitly.
- `spin()` calls it explicitly right after a successful `prepareSpin()` —
  that state transition is not preceded by a list render.
- The early-return branch of `finishSpin()` (no pending spin, e.g. a late
  `onComplete` after reset) calls it explicitly, since that path does not
  reach `updateUI()`.

### Session orchestration (Stages 1 – 5)

Every global-lot mutation is paired with the matching `GameSession` call at
the mutation site; there is **no** `syncGameSession()` step to remember:

| `LotManager` operation        | paired `GameSession` operation                       |
|-------------------------------|------------------------------------------------------|
| `addLot(name, amount, color)` | `gameSession.addLot(result.lot)`                     |
| `deleteLot(id)`               | `gameSession.removeLot(id)`                          |
| `clearAll()`                  | `gameSession.clearLots()`                            |
| (bulk) import strategy        | `gameSession.reconcileAfterBulkChange(idsBefore)`    |
| `updateLot(id, { amount })`   | — (participation unaffected)                         |
| *(turn lifecycle)*            | `gameSession.prepareSpin()` / `gameSession.finishSpin()` |

Mode change goes through `gameSession.setMode(id)` plus a mirror to
`settings.modeId`. Participation is deliberately preserved across a mode
switch. On rejection (session locked) the select is restored from
`this.gameSession.mode.id` — the authoritative value, because mode is
session state.

Visualization change is a renderer/UI concern only: it is rejected while
`isSpinInProgress || isGameFinished` (matching the derived `spinTimeLocked`),
restoring the select from `settings.visualization` — the authoritative value,
because visualization is UI state, not session state. On acceptance,
`App.recreateRenderer()` builds a fresh renderer via the registry lookup
and refreshes segments + render. Visualization-changes never touch
participation.

`App` never calls `processRoll()`, `RouletteEngine.roll()`, or
`deactivateMany()` — those live inside `GameSession`.

### Failure paths surfaced to the user (A1/A2)

- **Failed `prepareSpin()`** — `App.spin()` maps the discriminated reason
  from `PrepareSpinResult` to a specific i18n key via
  `prepareSpinFailureKey()` and alerts the user with that key.
- **`processRoll()` exception** — `App.finishSpin()` wraps
  `gameSession.finishSpin()` in `try/catch`, logs the error, shows an
  `ErrorDialog` with `error.spinProcessingFailed`, refreshes control state,
  and returns **without** updating the result text, highlight, or renderer.
  A processing failure is never presented as a normal completed spin.
- **Import blocked by a session lock that raced in** — `App.executeImport()`
  surfaces `ErrorDialog(import.sessionLocked)` when the conflict dialog was
  opened *before* the session locked and its callback fires afterwards,
  instead of silently returning.

### Initialization order

1. Create `LotManager`, `GameSession`.
2. Resolve the canvas element, then call `recreateRenderer()` and assign the
   result to `this.renderer`.
3. Create `AnimationController`.
4. Cache the remaining DOM handles.
5. `updateUI()`; set slider/number input to the 3 s default.
6. Pick a random colour for the new-lot indicator.
7. Read `localStorage` theme (fallback `'dark'`), `applyTheme`, sync selector.
8. Set the result text to the current mode name.
9. `setupEventListeners()`.

The inline head script in `index.html` applies `data-theme` before first
paint, so the theme never flashes on reload.

---

## 12. Spin lifecycle — the critical business flow

Since Stage 4 the turn lifecycle is split cleanly between `App` (animation +
UI) and `GameSession` (validation, rolling, state transitions, locks).
The A1/A2 pass tightened the failure paths (structured `prepareSpin()`
result; `try/finally` around `processRoll`; dedicated error dialogs).

```
spin() [App]
  ├─ prepared = gameSession.prepareSpin()
  │     └─ if !prepared.ok → alert(prepareSpinFailureKey(prepared.reason))
  │        return                                           // no state change on failure
  ├─ rolledLot = prepared.lot
  ├─ updateControlsState()                                  // reflect the new locks in the DOM
  ├─ vizPackage = getVisualizationPackage(settings.visualization)
  ├─ endRotation = vizPackage.computeFinalPosition(
  │        gameSession.activeLots, gameSession.mode, rolledLot.id,
  │        renderer.getCurrentRotation(), animationDuration, canvasWidth)
  ├─ animationController.configure({ startValue, endValue,
  │        duration, easing, onUpdate: setRotation + render,
  │        onComplete: () => finishSpin() })
  └─ animationController.start()

GameSession.prepareSpin()
  ├─ if spinInProgress → { ok: false, reason: 'spinInProgress' }
  ├─ if gameFinished   → { ok: false, reason: 'gameFinished' }
  ├─ if !RouletteEngine.canSpin(activeLots) → { ok: false, reason: 'noActiveLots' }
  ├─ rolledLot = RouletteEngine.roll(activeLots, currentMode)   // DECISION MADE HERE
  ├─ if !rolledLot → { ok: false, reason: 'noValidWeights' }
  ├─ pendingRolledLot = rolledLot
  ├─ sessionLocked = true                                       // persists until reset()
  ├─ spinInProgress = true                                      // released by finishSpin()
  └─ { ok: true, lot: rolledLot }

finishSpin() [App]
  ├─ try { outcome = gameSession.finishSpin() }
  │    catch → log; ErrorDialog('error.spinProcessingFailed')
  │            updateControlsState(); return                    // never present as a normal spin
  ├─ if !outcome → updateControlsState(); return                // late onComplete after reset()
  ├─ { rolledLot, result } = outcome
  ├─ highlightedLotId = rolledLot.id
  ├─ resultText = gameSession.mode.getRollText(rolledLot)
  ├─ if result.finished:
  │     if winner  → highlightedLotId = winner.id
  │     if message → alert(message) after 500 ms
  ├─ updateUI()                                                 // re-renders list; renderLotsList re-applies lock state
  └─ renderer.updateSegments(gameSession.activeLots, mode); renderer.render()

GameSession.finishSpin()
  ├─ rolledLot = pendingRolledLot; if !rolledLot → return null
  ├─ pendingRolledLot = null                                    // clear BEFORE processing
  ├─ try:
  │     result = currentMode.processRoll(rolledLot, state)      // RULES APPLIED HERE
  │     if result.deactivate.length > 0 → deactivateMany(result.deactivate)
  │     if result.finished → gameFinished = true
  │     return { rolledLot, result }
  └─ finally:
        spinInProgress = false                                  // ALWAYS released
```

The winner is decided inside `GameSession.prepareSpin()`, i.e. **before**
`App` configures or starts any animation; the animation only moves the
wheel / strip / circle grid to a pre-computed position.

**Refactor notes (Stage 4 + Sub-stage A + A1).**

- `App` never touches `GameSession.activeLotIds`, never calls `processRoll`
  and never calls `deactivateMany` — all of that is inside
  `GameSession.finishSpin()`.
- The session-level lock is raised *after* validation succeeds inside
  `prepareSpin()`, so a failed validation cannot leave the UI locked
  (planA §7). The A1/A2 pass formalised the failure reasons in the returned
  `PrepareSpinResult`, so `App.spin()` can display the correct message.
- `finishSpin()` wraps `processRoll` in `try/finally`: the spin-time lock
  is always released, so a throwing rule cannot leave the session stuck
  "spinning". The session lock remains — only Reset can unlock — and
  `gameFinished` stays untouched, so the failure is distinguishable from a
  normal completed turn. The exception itself propagates to `App`, which
  surfaces it via `ErrorDialog`.
- `reset()` on the session nulls the pending rolled lot and releases every
  flag, so a late `onComplete` (e.g. after `AnimationController.stop()`
  followed by a fresh start) cannot replay a stale roll —
  `GameSession.finishSpin()` returns `null` in that case and `App` is a
  no-op apart from re-evaluating control state.

### Worked example — Survival with three lots (A=1302, B=150, C=148.5)

```
spin #1 → prepareSpin rolls B → finishSpin: deactivate B → active = {A, C}
        → finished=false → spin lock released → next spin allowed
spin #2 → prepareSpin rolls C → finishSpin: remaining = {A} → winner A,
        finished=true → gameFinished=true → Spin disabled until Reset
```

No third spin occurs. For Normal mode, a single spin yields `finished=true`
with the rolled lot as winner.

---

## 13. Import subsystem

Three cooperating layers:

1. **Tabs** (`csvTabContent.ts`, `linkTabContent.ts`) produce `ParsedLot[]`.
   - CSV tab: textarea + comma/tab separator switch; parses via `csvParser`.
   - Link tab: URL input + fetch; `extractGoogleDocId` validates a Google
     Sheets URL and extracts the document id (and gid).
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
prior participation, newly created ids become active, stale ids are dropped.
This is what keeps the §5.1 invariant. Like every other participation
mutation, the call is **rejected while `sessionLocked`**.

**Race handling (A1/A2).** The guard lives both in `App` (before opening the
dialog and again in `executeImport`) and inside `GameSession` itself. If the
session locked *between* the moment the conflict dialog was opened and the
moment its callback fires, `App.executeImport()` rejects and — instead of
silently returning — shows an `ErrorDialog(import.sessionLocked)` so the
user knows why nothing happened.

If lots already exist, `ImportConflictDialog` asks the user to Replace / Merge
/ Cancel. Truncation is reported via `ErrorDialog` with a summary message.

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

- `modalManager.ts` — singleton; monotonic z-index for stacked dialogs;
  tracks open modals; `retranslateAllOpenModals`.
- `modalDialog.ts` — abstract base: `overlay`/`content` structure,
  `renderHeader`, `renderContent`, `renderFooter`, `retranslate`,
  `isHidden`, `destroy`.
- `errorDialog.ts` — simple message dialog with an OK button. Used for
  validation errors, the import-session-lock rejection, the truncation
  summary, and the spin-processing failure.
- `importConflictDialog.ts` — Replace / Merge / Cancel chooser.
- `importDialog.ts` — multi-use coordinator; its `onClose` always destroys
  it, preventing stale DOM between openings.

---

## 15. Internationalization (`i18n.ts`)

- Wraps i18next; resources are loaded asynchronously from `locales/en.json`
  and `locales/ru.json` via `initI18n()`, which is awaited once at startup.
- `t(key, params)` for programmatic lookups.
- `translateDOM()` walks `[data-i18n]`, `[data-i18n-placeholder]`,
  `[data-i18n-title]` and replaces text/attributes.
- The language `select` calls `i18n.changeLanguage` then `translateDOM()`.
- `syncDocumentLang()` writes the resolved i18n language to
  `<html lang="...">` so screen readers and font shaping target the correct
  locale. It runs once inside `initI18n()` and again from `App`'s language
  handler after every `i18n.changeLanguage(...)`.
- The A1/A2 pass added four new keys: `validation.spinInProgress`,
  `validation.gameFinished`, `validation.noValidWeights`, and
  `import.sessionLocked` — all present in both locale files.

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
- The disabled-control styling covers `button`, `input`, `select`, and
  `textarea` uniformly (a shared `opacity: 0.5` + `cursor: not-allowed`
  rule), so locked controls are visually consistent across the add-row,
  list, and settings panels.

---

## 17. Animation (`animation.ts`)

- `EasingFunctions` — named easing curves; `DEFAULT_EASING` is
  `rouletteEaseOut` (a cubic/quintic blend deliberately distinct from
  `easeOutQuint`).
- `AnimationController` — `configure({ startValue, endValue, duration, easing,
  onUpdate, onComplete })`, `start()`, `stop()`, `isAnimating()`.
- Frame loop uses `requestAnimationFrame` with elapsed-time progress and
  applies the easing curve; on completion it fires `onUpdate(endValue, 1)`,
  clears its internal state (so `isAnimating()` returns `false`), then fires
  `onComplete()`.

**Reset-during-animation guarantee.** `stop()` synchronously cancels the
pending RAF handle and sets the controller's internal start time to `null`;
the frame callback early-returns whenever the start time is `null`, so a
late `onComplete` from a cancelled animation cannot fire. This is the
guarantee `App.reset()` relies on: it calls `animationController.stop()`
*before* `gameSession.reset()`, and that session reset additionally nulls
the pending rolled lot — so even if a stray completion reached
`App.finishSpin()`, `GameSession.finishSpin()` would return `null`. Two
independent invalidation mechanisms, not a timing assumption.

---

## 18. Utilities (`utils.ts`)

| Function | Purpose |
|----------|---------|
| `generateRandomReadableColor()` | HSL colour with controlled lightness for label contrast |
| `brightenColor(color, percent)` | Hex → lightened RGB, used for highlights |
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
5. **Locked until Reset.** Once a game finishes (`finished === true`), Spin is
   disabled until `GameSession.reset()` clears `gameFinished`.
6. **GameSession owns participation.** The participant set lives in
   `GameSession.activeLotIds`; global lot existence lives in `LotManager`. The
   `GameState` passed to `processRoll` is materialised from the session, so a
   stale id can never leak into a mode.
7. **GameSession owns the turn lifecycle.** Since Stage 4, rules are applied
   inside `GameSession.finishSpin()`. `App` reads the returned
   `{ rolledLot, result }` for UI only and never mutates game state itself.
8. **Pending-spin context is single-use.** A pending rolled lot exists only
   between `prepareSpin()` and `finishSpin()`; `finishSpin()` clears it
   before invoking `processRoll`, and `reset()` clears it too — a stale roll
   can never be replayed.
9. **Two distinct locks, never conflated.** `sessionLocked` (raised once,
   cleared only by reset) governs session-level mutations; `spinInProgress`
   (raised/cleared by the spin pair) governs the controls that cannot change
   mid-animation. `App` derives its disabled states from both and stores no
   copy.
10. **No state change on a failed spin.** A `prepareSpin()` that returns
    `{ ok: false, reason }` leaves `sessionLocked`, `spinInProgress`,
    `gameFinished`, and `pendingRolledLot` untouched.
11. **Spin-time lock always released.** `finishSpin()` uses `try/finally` so
    `spinInProgress` is released even when the mode's `processRoll` throws.
    The exception itself is not swallowed — it propagates to `App`, which
    surfaces it to the user without presenting a normal spin result.
12. **Session lock survives a processing failure.** After an exception in
    `processRoll`, `sessionLocked` stays `true` and `gameFinished` stays
    `false`. The only way out is `reset()`.
13. **`render()` is self-contained.** Every renderer knows its own canvas;
    `IRenderer.render()` takes no dimensions. `App` never passes canvas
    measurements to a renderer.

---

## 20. Known issues / technical debt

**Remaining (Stage 6+).**

| # | Issue | Impact |
|---|-------|--------|
| 1 | `importStrategies.ts` receives `LotManager` typed as `any` in the `ImportStrategy` interface rather than a concrete type | Intentional while `LotManager` owns the global list; the `any` obscures the contract |
| 2 | `GameSession.deactivateMany()` is deliberately unguarded | It is currently only called from `finishSpin()`; any future external caller must be reviewed against planA §3 |
| 3 | `App.spin()` surfaces a failed `prepareSpin()` via a native `alert()`, while `App.executeImport()` and the exception path in `App.finishSpin()` use `ErrorDialog` | Two UX patterns for user-facing errors; a unified pattern would be more consistent |
| 4 | The visualization-change handler's rejection path is effectively unreachable in the current code (the select is disabled exactly when the guard can fire) | Kept for defence in depth; a candidate for removal in a future cleanup |
| 5 | `App.updateControlsState()` is still invoked imperatively — from `renderLotsList()` (the centralization point), from `spin()`, and from the early-return branch of `finishSpin()` | A new render path that bypasses `renderLotsList()` would still miss a refresh; a state-change notification from `GameSession` would be the radical fix |
| 6 | The mode-change handler restores from `gameSession.mode.id`; the visualization-change handler restores from `settings.visualization` | Semantically correct (mode is session state, visualization is UI state), but worth unifying in naming |

**Resolved during the refactor (kept for traceability).**

- The former `#lot-form input` selector in `updateControlsState()` (now
  targets the actual add-row / per-lot controls).
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
- **Stage 4:** the turn lifecycle (`RouletteEngine.roll` →
  `GameMode.processRoll` → `deactivateMany`) moved from `App.finishSpin` into
  `GameSession.prepareSpin()` / `GameSession.finishSpin()`.
- **Stage 5:** removed the transitional `Lot.active` field and the unused
  `LotManager` API; deleted the unused `RouletteEngine.getSegmentCenterAngle`;
  collapsed `rendererFactory.ts` into `visualizationStrategy.ts` (now the sole
  renderer registry); dropped dead imports from `app.ts`; simplified
  `App.reset()` to a single `gameSession.reset()` call; captured the current
  mode once at the top of `App.spin` / `App.finishSpin`.
- **Sub-stage A:** introduced the explicit two-lock model (`sessionLocked` /
  `spinInProgress`) plus `gameFinished`. `App` no longer keeps an
  `isSettingsLocked` field; every disabled state is derived from the
  `GameSession` flags via `updateControlsState()`. The session lock is now
  raised *inside* `prepareSpin()` after validation succeeds, so a failed spin
  cannot leave the UI locked. The CSS disabled-control rule was extended to
  `input`, `select`, and `textarea`.
- **Sub-stage B:** `visualizationSelect` and `easingSelect` were moved from
  the session-lock class to the spin-time-lock class, joining the duration
  controls. They are now editable between spins of an unfinished Survival
  game. `App.updateControlsState()` splits its "session-level" and
  "spin-time" blocks accordingly; the visualization-change handler narrows
  its rejection guard from `isSessionLocked || isSpinInProgress` to
  `isSpinInProgress` alone.
- **Corrective pass A1/A2:** the following were resolved together.
  - `prepareSpin()` returns a discriminated `PrepareSpinResult`
    (`{ ok: true, lot }` | `{ ok: false, reason }`) instead of
    `Lot | null`, with four reasons matching the four actual refusal
    branches. `App.spin()` maps the reason to a specific i18n key via
    `prepareSpinFailureKey()`.
  - `finishSpin()` wraps the mode's `processRoll` in `try/finally`, so
    `spinInProgress` is always released. Exceptions propagate to `App`,
    which logs them and shows `ErrorDialog(error.spinProcessingFailed)`
    without presenting a normal spin result.
  - `App`'s session-level guards were simplified from
    `isSessionLocked || isSpinInProgress` to `isSessionLocked` at all seven
    affected sites, exploiting the `spinInProgress ⇒ sessionLocked`
    invariant. The two concepts remain separate in `GameSession`.
  - The finished-game UI freeze: duration, visualization, and easing are
    now tied to the derived `spinTimeLocked = isSpinInProgress ||
    isGameFinished`, so a finished game truly freezes everything except
    Reset.
  - The lock-derivation centralization point moved into `renderLotsList()`;
    `setSortField()` and `updateUI()` no longer call `updateControlsState()`
    explicitly.
  - `App.executeImport()` now surfaces a session-lock race with
    `ErrorDialog(import.sessionLocked)` instead of silently returning.
  - `IRenderer.render()` no longer takes `canvasWidth` / `canvasHeight`.
    Each renderer derives its dimensions from its own canvas via
    `BaseRenderer.getLogicalSize()`. `App.render()` was removed; every call
    site now calls `renderer.render()` directly.
