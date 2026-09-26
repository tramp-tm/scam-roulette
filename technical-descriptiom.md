# Scam Roulette — Technical Description

Structural description of the application's architecture and business logic.
Client-only, single-page web application.

---

## 1. Overview

Scam Roulette is a weighted random picker. The user builds a list of *lots*
(each with a name, an amount, and a colour), picks a game mode and a
visualization, and spins. The **amount** is the weight; its interpretation is
mode-specific. The result is chosen **before** the animation starts — the
animation is cosmetic and never affects the outcome.

Supported configuration: two game modes (Normal, Survival), two
visualizations (Wheel, Strip), two languages (EN/RU), four themes
(dark, light, emerald, nordic).

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
    ├── types.ts                    # all shared contracts
    ├── modes.ts                    # game-mode registry
    ├── NormalMode.ts               # GameMode implementation
    ├── SurvivalMode.ts             # GameMode implementation
    ├── rouletteEngine.ts           # weighted random + geometry
    ├── lotManager.ts               # lot state
    ├── rendererFactory.ts          # renderer construction
    ├── visualizationStrategy.ts    # visualization-package registry
    ├── baseRenderer.ts             # shared IRenderer base class
    ├── wheelRenderer.ts            # IRenderer implementation (wheel)
    ├── stripRenderer.ts            # IRenderer implementation (strip)
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

**Core rule:** dependencies point downward only. `App` knows *that* a game mode
exists, never *how* it plays. `RouletteEngine` and `LotManager` are entirely
mode-agnostic — they only receive a `GameMode` and call its `calculateWeight`.

---

## 5. Domain model (`types.ts`)

| Type | Shape / role |
|------|--------------|
| `Lot` | `{ id, name, amount, color, active }` — the atomic unit |
| `Mode` | `'normal' \| 'survival'` |
| `VisualizationType` | `'wheel' \| 'strip'` |
| `Settings` | `{ modeId, visualization, animationDuration }`; theme and language are intentionally not part of `Settings` |
| `Segment` | `{ lot, startAngle, endAngle, weight }` — `weight` is normalized (0–1) |
| `GameState` | `{ allLots: Lot[], activeLots: Lot[] }` |
| `RollResult` | `{ finished, winner: Lot\|null, deactivate: string[], message? }` |
| `GameMode` | `{ id, name, description, calculateWeight, getRollText, processRoll }` |
| `IRenderer` | `updateSegments`, `setRotation`, `getCurrentRotation`, `setHighlightedLot`, `render`, `reset` |
| `VisualizationPackage` | `{ id, createRenderer, computeFinalPosition }` |
| `ParsedLot` / `ParseResult` | `{ name, amount }` / `{ validLots, errorCount }` |
| `ImportResult` | `{ lotsAdded, lotsTruncated }` |
| `ImportStrategy` | `{ id, label, description, execute }` |
| `SortField` / `SortDirection` | `'name' \| 'amount'` / `'asc' \| 'desc'` |
| `EasingFunction` | `(t: number) => number` |

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
| `canSpin(activeLots)` | Returns `activeLots.length >= 1`. |

Segment width (strip) is derived via `getSegmentWidth(normalizedWeight)` from
`utils.ts` — a **single source of truth** shared by the strip renderer's drawing
pass and `computeFinalScrollOffset`'s scroll math, so the two cannot drift
apart. The formula is `Math.max(60, normalizedWeight * 400)`.

---

## 8. LotManager (`lotManager.ts`)

Owns the `Lot[]`. Knows nothing about game modes, winners, or rules.

| Method | Purpose |
|--------|---------|
| `addLot(name, amount, color)` | Adds a lot; returns `{ success, message }` (validation lives here) |
| `updateLot(id, patch)` | Updates a lot's fields (e.g. `{ amount }`) |
| `deleteLot(id)` | Removes a lot |
| `deactivateLot(id)` / `deactivateMany(ids)` | Marks lots inactive (used by spin lifecycle) |
| `resetAll()` | Reactivates all lots |
| `clearAll()` | Removes all lots |
| `getAllLots()` / `getActiveLots()` | Read access |
| `getTotalCount()` / `getActiveCount()` | Counts |
| `getState(): GameState` | Snapshot `{ allLots, activeLots }` for a mode's `processRoll` |
| `LotManager.MAX_LOTS` | Static limit = `3000` |

---

## 9. Renderers (`baseRenderer.ts`, `wheelRenderer.ts`, `stripRenderer.ts`)

All renderers implement `IRenderer`. They receive a `GameMode` in
`updateSegments` and delegate weight math to `RouletteEngine.calculateSegments`.
Neither computes weights itself.

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

---

## 10. Visualization strategy (`visualizationStrategy.ts`)

Each visualization is a `VisualizationPackage` bundling a renderer factory and a
final-position function:

```
    WHEEL_PACKAGE = { id: 'wheel', createRenderer, computeFinalPosition → computeFinalRotation }
    STRIP_PACKAGE = { id: 'strip', createRenderer, computeFinalPosition → computeFinalScrollOffset }
    export const VISUALIZATION_PACKAGES = { wheel, strip } as const;
    export function getVisualizationPackage(type): VisualizationPackage;
```

`App` selects a visualization by registry lookup — no `switch` statement.

---

## 11. App orchestration (`app.ts`)

`App` owns the UI and drives the game. It contains **no mode-specific logic**.

**Responsibilities:** DOM wiring, settings panels, lot-list rendering and
sorting, import execution, animation driving, result display, control
enable/disable, theme application.

**Key state:** `lotManager`, `renderer`, `animationController`, `settings`,
`easingFunction`, `highlightedLotId`, `isSettingsLocked`, `sortField`,
`sortDirection`, DOM handles.

**Derived:** `get mode(): GameMode { return getMode(this.settings.modeId); }`.

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

```
    spin()
      ├─ activeLots = lotManager.getActiveLots()
      ├─ if (!RouletteEngine.canSpin(activeLots)) → alert(noLotsToSpin); return
      ├─ isSettingsLocked = true; updateControlsState()          // lock UI
      ├─ rolledLot = RouletteEngine.roll(activeLots, this.mode)  // DECISION MADE HERE
      ├─ if (!rolledLot) return
      ├─ vizPackage = getVisualizationPackage(settings.visualization)
      ├─ endRotation = vizPackage.computeFinalPosition(
      │        activeLots, mode, rolledLot.id,
      │        renderer.getCurrentRotation(), animationDuration, canvasWidth)
      ├─ animationController.configure({ startValue, endValue,
      │        duration, easing, onUpdate: setRotation+render,
      │        onComplete: () => finishSpin(rolledLot) })
      └─ animationController.start()

    finishSpin(rolledLot)
      ├─ if (!rolledLot) → updateControlsState(); return
      ├─ highlightedLotId = rolledLot.id
      ├─ resultText = mode.getRollText(rolledLot)
      ├─ state  = lotManager.getState()
      ├─ result = mode.processRoll(rolledLot, state)             // RULES APPLIED HERE
      ├─ lotManager.deactivateMany(result.deactivate)
      ├─ if result.finished:
      │     highlightedLotId = result.winner?.id ?? highlightedLotId
      │     if result.message → alert(result.message) after 500 ms
      │     isSettingsLocked = true                              // lock until Reset
      │   else:
      │     isSettingsLocked = false                             // next spin allowed
      └─ updateUI(); renderer.updateSegments(activeLots, mode); render(); updateControlsState()
```

The winner is captured in the animation closure; the animation only moves the
wheel/strip to a pre-computed position.

### Worked example — Survival with three lots (A=1302, B=150, C=148.5)

```
    spin #1 → B rolled → deactivate B → active = {A, C} → finished=false → next spin allowed
    spin #2 → C rolled → deactivate C → remaining = {A}  → winner A, finished=true → UI locks
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
3. **Strategies** (`importStrategies.ts`):
   - `REPLACE_STRATEGY` — `clearAll()`, then adds new lots up to `MAX_LOTS`.
   - `MERGE_STRATEGY` — matches by lowercase name (updates amount on a match,
     otherwise adds), up to `MAX_LOTS`.
   - Both return `{ lotsAdded, lotsTruncated }`.

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

---

## 16. Theming (`styles.css`, `index.html`, `app.ts`)

- Palettes are CSS custom properties on `:root` (dark) and
  `:root[data-theme="light"|"emerald"|"nordic"]`.
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

1. **Result before animation.** The winner/eliminated lot is chosen in `spin()`
   before the animation starts; the animation cannot change the outcome.
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

---

## 20. Known issues / technical debt

| # | Issue | Impact |
|---|-------|--------|
| 1 | `App.updateControlsState()` selects `#lot-form input`, which does not exist in `index.html` | The inline add-lot inputs are not disabled while the game is locked |
| 2 | `importStrategies.ts` evaluates `i18n.t(...)` at module-load time (before `initI18n()`); `MERGE_STRATEGY.description` is hardcoded English | Strategy labels may show raw keys; they do not retranslate on language change |
| 3 | `App.mode` is a getter re-resolved in `finishSpin`; a mode change during animation can desync the applied rules from the animation | Rare, but a correctness hazard — capture the mode once per spin |
| 4 | `rendererFactory.ts` duplicates the registry lookup already exposed by `VisualizationPackage.createRenderer` | Redundant indirection, harmless |
| 5 | `App.spin` early-returns on `!rolledLot` after setting `isSettingsLocked = true` | Lockout trap if upstream validation changes |
| 6 | Dead imports in `app.ts` (`parseCSV`, `ModalManager`, `IMPORT_STRATEGIES`, `ParseResult`, `SeparatorType`) | Obscures ownership of CSV parsing |
| 7 | `<html lang>` is never updated on language switch | Accessibility / font-shaping |
| 8 | `RouletteEngine.getSegmentCenterAngle` is defined but unused | Dead code |
