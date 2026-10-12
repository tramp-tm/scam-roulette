// ========================================
// CORE DOMAIN
// ========================================

/**
 * Global lot — permanent data only. No in-game properties (hp, lives, …).
 * Anything that exists only inside one game mode / one game lives in the
 * session-owned participant state instead.
 */
export interface Lot {
    id: string;
    name: string;
    amount: number;
    color: string;
}

export type Mode =
    | 'normal'
    | 'survival'
    | 'crown-defense-half-test'
    | 'weakest-link'
    | 'king-of-the-hill-amount'
    | 'tournament';

export type VisualizationType = 'wheel' | 'strip' | 'counting-rhyme';

export interface Settings {
    visualization: VisualizationType;
    animationDuration: number; // milliseconds
    /** Draw the true chance share instead of the readable minimum-share floor. */
    realChances: boolean;
    /** Draw the true magnitude ratio instead of the readable size floor. */
    realMagnitudes: boolean;
}

/**
 * Per-visualization tuning, derived from `Settings` and fed through
 * `IRenderer.setTuning`. Each visualization decides how (and whether) to apply
 * it: the counting rhyme ignores both flags (its beat is always the honest
 * chance partition and its radius the current min-max).
 */
export interface VisualizationTuning {
    realChances: boolean;
    realMagnitudes: boolean;
}

// ========================================
// LOCALIZATION
// ========================================

/**
 * A deferred, language-switchable message produced by a GameMode. The mode
 * never resolves it itself; the UI translates it via i18n, so switching the
 * language afterwards still re-renders correctly.
 */
export interface MessageDescriptor {
    key: string;
    params?: Record<string, unknown>;
}

// ========================================
// GAME MODE STATE
// ========================================

/**
 * Game-level state owned by a GameMode. The core stores it but never
 * inspects it — only the owning mode knows its shape. Treat it as a value:
 * a mode must return a NEW object when something changed, never mutate a
 * stored state in place.
 */
export type GameModeState = unknown;

/**
 * Per-participant state owned by a GameMode. Opaque to the core; same
 * value-semantics rule as `GameModeState`.
 */
export type ParticipantModeState = unknown;

/**
 * Generic extra-info descriptor a GameMode can attach to a participant for the
 * lots list's optional "ext" column. The mode owns both the meaning and the
 * formatting; the list renders `value` verbatim. Opaque to the core — it is
 * never interpreted.
 */
export interface ModeExtraInfo {
    /** Display-ready text for this participant (e.g. "♥ 90", "73.1%", "—"). */
    value: string;
}

/**
 * Standard accent palette. A single vocabulary shared by modes, the lots list
 * and the visualizations — the meaning of each kind is documented here but is
 * never interpreted by the list or the renderers (they only draw it).
 */
export type AccentKind = 'accent' | 'good' | 'bad' | 'info' | 'warning';

/** Where a lot accent is surfaced. */
export type AccentTarget = 'list' | 'visualization';

/**
 * A lot's accent: exactly ONE kind per lot; `targets` selects where it is
 * shown and defaults to both surfaces. A lot without an `accent` has none.
 */
export interface LotAccent {
    kind: AccentKind;
    targets?: readonly AccentTarget[];
}

/**
 * Mode-defined presentation payload attached to a participant. Generic and
 * opaque: the core and the visualizations never interpret it. `ext` is the
 * optional extra-info column the lots list can display — its meaning (HP, win
 * probability, score, rank, …) is entirely the mode's, so new modes need no
 * change in the list. `accent` is the mode-owned accent for this lot (at most
 * one); it overrides the outcome-derived default for the same lot.
 */
export interface ModePresentationData {
    ext?: ModeExtraInfo;
    /** Mode-owned accent for this participant (at most one). */
    accent?: LotAccent;
}

/**
 * Session-owned participant record: identity + activity + the mode-owned
 * state for this participant. The core never inspects `modeState`.
 */
export interface GameParticipantState {
    lotId: string;
    active: boolean;
    modeState: ParticipantModeState;
}

/** Optional free-form event emitted by a turn. */
export interface TurnEvent {
    type: string;
    lotIds?: string[];
    data?: Record<string, unknown>;
}

/**
 * Generalized result of one turn (spin). `winners` / `eliminated` / `changed`
 * are all ordinary lists — a single winner or a single elimination is simply
 * a list of length one, so there are no hidden special-case fields.
 */
export interface TurnOutcome {
    /** The lot that was decided for this turn. */
    rolledLotId: string;
    /** Winners of this turn (0..n). */
    winners: string[];
    /** Participants eliminated by this turn (0..n). */
    eliminated: string[];
    /** Participants whose mode state changed this turn (0..n). */
    changed: string[];
    /** True when the game reached its terminal state. */
    finished: boolean;
    /** Immediate, localized description of the roll (e.g. "Eliminated: B"). */
    result: MessageDescriptor;
    /** Optional localized game-over / completion message. */
    message?: MessageDescriptor;
    /** Optional mode-defined events for the UI / visualization. */
    events?: TurnEvent[];
}

/**
 * Game mode strategy. Owns its rules AND the lifecycle of its own state,
 * but knows nothing about the DOM, rendering, animation or the concrete
 * visualization.
 *
 * STATELESS, SHARED INSTANCE
 * An implementation must be stateless. The registry keeps ONE shared instance
 * per mode (`modes.ts`), reused by every game session. All game data lives in
 * the `GameModeState` / per-participant `modeState` values passed in and
 * returned — never on the mode instance. Do not cache or accumulate anything
 * on `this`: such a field would silently become state shared across sessions,
 * and `GameSession.reset()` (which recreates the state objects, not the mode)
 * would not clear it.
 *
 * PURE TRANSITIONS
 * `processRoll()` and `onParticipantsChanged()` must not mutate their inputs.
 * In particular `participants` / `state` may be a snapshot the session still
 * references as the turn's "before" image. Return new objects for anything
 * that changed.
 *
 * SELECTION vs PRESENTATION
 * The mode defines independent, explicitly separated semantics:
 *  - selection:    `calculateSelectionWeight()` — probability for the roulette.
 *                  The core transports it into the snapshot's `xValue` axis; it
 *                  never drives size/scale.
 *  - presentation: the axes `yValue` (magnitude → size/scale) and `zValue`
 *                  (opacity, via the optional `getParticipantOpacity()`), plus
 *                  `getPresentationData()` for extra mode-specific data
 *                  (`modeData`). The meaning of each axis is the mode's own —
 *                  see the axis definitions on `RenderableParticipant`.
 * A mode must not assume `yValue` means weight/amount/HP to the renderer, and
 * the core must not derive one axis from another.
 */
export interface GameMode {
    readonly id: Mode;
    readonly name: string;
    readonly description: string;

    /** Create the initial game-level state for a fresh session. */
    createGameState(lots: readonly Lot[]): GameModeState;

    /** Create the mode-specific state for a participant joining the game. */
    createParticipantState(lot: Lot): ParticipantModeState;

    /**
     * Recompute game-level state after the participant set changed. Receives
     * the current global lots so a mode can re-derive lot-based state (e.g. a
     * normalization reference built from amounts). Pure.
     */
    onParticipantsChanged(
        state: GameModeState,
        participants: readonly GameParticipantState[],
        lots: readonly Lot[]
    ): GameModeState;

    /**
     * Optional pre-roll hook: produce the game state for the upcoming roll from
     * the current participant set. Called once in `prepareSpin`, after the
     * active-count guard and BEFORE the view snapshot is taken, so the snapshot
     * — and thus the roll and the "before" view — reflects the prepared state.
     * Pure: return a new state object, never mutate the input.
     *
     * E.g. the tournament mode draws its round group here; modes with no
     * pre-roll preparation omit the hook.
     */
    prepareTurn?(participants: readonly GameParticipantState[]): GameModeState;

    /**
     * The lots the VISUALIZATION shows right now, as a subset of the active
     * participants. `null` / absent = every active participant (the default for
     * modes without a staged subset). The roulette roll is performed over exactly
     * this set; the lots list keeps showing the full pool regardless.
     *
     * E.g. the tournament returns its current round's N lots while a round is in
     * progress, and `null` (the whole pool) between rounds.
     */
    getVisualizationLots?(
        state: GameModeState,
        participants: readonly GameParticipantState[]
    ): ReadonlySet<string> | null;

    /**
     * SELECTION weight: how likely this lot is to be rolled by the roulette
     * mechanics. Drives selection only — never visual size. It IS the chance
     * axis (`xValue`) the core shows, so "what you see is what was rolled".
     *
     * Depends on the LOT alone — not on participation or game state.
     */
    calculateSelectionWeight(lot: Lot): number;

    /**
     * Axis 2 (`yValue`): the mode's abstract MAGNITUDE, used by visualizations
     * for size/scale. Independent of `calculateSelectionWeight`; the mode
     * defines its own meaning (amount, score, HP, …) and renderers never assume
     * it. Return `undefined` when the mode has nothing to put on this axis.
     */
    getParticipantMagnitude(
        lot: Lot,
        participant: GameParticipantState,
        state: GameModeState
    ): number | undefined;

    /**
     * Axis 3 (`zValue`): lot OPACITY in [0, 1]; `undefined` = 1 (opaque).
     * Optional — no mode fills it today, so every lot stays fully opaque. The
     * renderers already consume the axis, so the channel is complete: a mode
     * that wants to dim a lot only has to implement this method.
     */
    getParticipantOpacity?(
        lot: Lot,
        participant: GameParticipantState,
        state: GameModeState
    ): number | undefined;

    /**
     * Pure turn processing: (state, rolled lot) -> (state', outcome).
     *
     * The rolled PARTICIPANT is not passed — no mode needs it; one that did could
     * look it up via `lotById.get(rolledLot.id)`. `lotById` is the session's
     * single lot index for this turn — a mode never rebuilds one for the roll.
     */
    processRoll(
        rolledLot: Lot,
        participants: readonly GameParticipantState[],
        lotById: ReadonlyMap<string, Lot>,
        state: GameModeState
    ): {
        state: GameModeState;
        participants: GameParticipantState[];
        outcome: TurnOutcome;
    };

    /**
     * Presentation data for the whole session, keyed by lot id. Called once per
     * view-state build with the full context (participants + the lot index), so
     * a mode can compute set-level presentation — e.g. the eventual win
     * probability — once instead of per participant. Opaque to the core; return
     * an empty map when there is nothing to present.
     *
     * `lotById` is the same index the session built for this view state
     * (`lotId -> Lot`), so a mode never rebuilds it.
     */
    getPresentationData(
        participants: readonly GameParticipantState[],
        lotById: ReadonlyMap<string, Lot>,
        state: GameModeState
    ): ReadonlyMap<string, ModePresentationData>;
}

// ========================================
// PRESENTATION MODEL
// ========================================

/**
 * One participant as the presentation layer sees it.
 *
 * Three INDEPENDENT axes:
 *  - `xValue` — CHANCE: the unnormalised selection weight, always exactly the
 *    number the core used for the roll (the session transports it). Only ratios
 *    matter. It drives the roulette geometry (sector/band width, beat — hence
 *    dwell time) and never determines size/scale.
 *  - `yValue` — MAGNITUDE: the abstract presentation magnitude the visualization
 *    turns into a size/scale. The mode defines its meaning (amount, score, HP,
 *    …); renderers must never assume it means weight, amount or HP.
 *    `undefined` = the mode has nothing on this axis.
 *  - `zValue` — OPACITY in [0, 1]; `undefined` = 1 (opaque). No mode fills it
 *    today, so every lot is fully opaque.
 * Changing one axis never changes another: probability and visual size must not
 * be derived from one another.
 *
 * `presence` is a separate visual multiplier in [0, 1], which animates
 * eliminations by interpolating a view state (a lot leaves the view when it
 * reaches 0); together with `zValue` it forms the lot's alpha
 * (`alpha = presence × zValue`).
 * `modeData` is mode-specific presentation payload the UI may render — the
 * core and the visualizations never interpret its meaning. It is produced once
 * per view-state build by `GameMode.getPresentationData()`.
 */
export interface RenderableParticipant {
    lot: Lot;
    active: boolean;
    xValue: number;
    yValue?: number;
    zValue?: number;
    presence: number;
    modeData?: ModePresentationData;
}

/** Immutable snapshot of the game for the UI and visualizations. */
export interface GameViewState {
    modeId: Mode;
    participants: RenderableParticipant[];
}

/**
 * Accents the visualization must draw, already filtered to the `visualization`
 * target (a flat lotId → kind map: "at most one accent per lot" is expressed
 * by the shape). `pulse` scales the accent emphasis (0..1) so an outcome
 * transition can fade it in — the stable state uses 1.
 *
 * The visualization's *cursor* is deliberately NOT part of this state. It is
 * derived by the visualization itself from its own animation scalar (see
 * `IRenderer.getCursorLotId`) and only exposed read-only — it never round-trips
 * through the driver, so accents and cursor cannot overwrite each other.
 */
export interface AccentState {
    accents: ReadonlyMap<string, AccentKind>;
    pulse: number;
}

/** Everything a visualization needs to animate one turn's transition. */
export interface VisualizationTransition {
    before: GameViewState;
    after: GameViewState;
    outcome: TurnOutcome;
    rolledLotId: string;
}

// ========================================
// ENGINE
// ========================================

/**
 * A candidate for roulette selection: a lot paired with its mode-computed
 * SELECTION weight (the probability of being rolled). Used only by the
 * selection mechanics — never for visual sizing.
 */
export interface SelectionCandidate {
    lot: Lot;
    selectionWeight: number;
}

// ========================================
// VISUALIZATION CONTRACT
// ========================================

/**
 * A visualization: purely visual. It receives the presentation model and
 * accent state, and internally owns its own spin math and cursor. It
 * never knows game rules and never mutates game state.
 *
 * Cursor: derived inside the visualization from its own animation scalar and
 * used for its own cursor emphasis. `getCursorLotId()` is a read-only external
 * query (for the UI); the cursor is never pushed back in through
 * `setViewState`.
 *
 * Emphasis has two independent channels that compose at draw time:
 *  - the lot accents fed via `setViewState` (a lotId → AccentKind map);
 *  - the transient hover highlight (lots-list interaction), fed via `setHover`.
 * Neither mutates the other.
 */
export interface IRenderer {
    /**
     * Adopt the visualization tuning (the "real chances" / "real magnitudes"
     * switches). A pure setter: the geometry is rebuilt by the next
     * `setViewState`, and a visualization may ignore flags it has no use for.
     */
    setTuning(tuning: VisualizationTuning): void;

    /**
     * Adopt a presentation snapshot + accent state. This is the only way
     * accents are fed in; the visualization manages its own cursor internally.
     *
     * Called once for a spin, but once PER FRAME during an outcome transition
     * (with an interpolated snapshot), so `onViewStateChanged` must stay cheap:
     * rebuild derived geometry, but cache heavy layout keyed on its inputs
     * (see CountingRhymeRenderer's grid cache).
     */
    setViewState(view: GameViewState, accents: AccentState): void;

    /**
     * Set the transient hover highlight to a lot id, or `null` to clear it.
     * Identity is the stable `lot.id`; the renderer resolves it against its own
     * Lot Representation (sector / band / circle) and picks the visual
     * treatment. Hover composes with — and never replaces — the accents fed via
     * `setViewState`: it changes no geometry, weight or animation state, and an
     * unknown/absent id simply highlights nothing.
     */
    setHover(lotId: string | null): void;

    /** Draw the current frame. */
    render(): void;

    /** Return to a clean state. */
    reset(): void;

    /** Current animation scalar (radians for wheel, px for strip, cycles for rhyme). */
    getAnimationValue(): number;

    /** Set the animation scalar (called per animation frame). */
    setAnimationValue(value: number): void;

    /** Compute the animation target that lands on `rolledLotId`. */
    computeSpinTarget(rolledLotId: string, durationMs: number): number;

    /** Lot currently under this visualization's cursor, or null. Read-only. */
    getCursorLotId(animationValue: number): string | null;
}

/** Registry entry for a visualization type. */
export interface VisualizationPackage {
    id: VisualizationType;
    createRenderer(canvas: HTMLCanvasElement): IRenderer;
}
