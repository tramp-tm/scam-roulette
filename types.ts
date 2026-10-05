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

export type Mode = 'normal' | 'survival' | 'crown-defense';

export type VisualizationType = 'wheel' | 'strip' | 'counting-rhyme';

export interface Settings {
    modeId: Mode;
    visualization: VisualizationType;
    animationDuration: number; // milliseconds
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
 * previously stored state in place.
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
 * Mode-defined presentation payload attached to a participant. Generic and
 * opaque: the core and the visualizations never interpret it. `ext` is the
 * optional extra-info column the lots list can display — its meaning (HP, win
 * probability, score, rank, …) is entirely the mode's, so new modes need no
 * change in the list.
 */
export interface ModePresentationData {
    ext?: ModeExtraInfo;
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
 * The mode defines two independent, explicitly separated semantics:
 *  - selection:    `calculateSelectionWeight()` — probability for roulette;
 *  - presentation: `getParticipantVisualValue()` — the abstract magnitude a
 *                  visualization renders as size/scale, independent of the
 *                  selection probability; plus `getPresentationData()` for
 *                  extra mode-specific data (`modeData`).
 * A mode must not assume `visualValue` means weight/amount/HP to the renderer,
 * and the core must not derive one from the other.
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
     * SELECTION weight: how likely this participant is to be rolled by the
     * roulette mechanics. Drives selection only — never visual size.
     */
    calculateSelectionWeight(
        lot: Lot,
        participant: GameParticipantState,
        state: GameModeState
    ): number;

    /**
     * VISUAL magnitude for this participant, used by visualizations for
     * size/scale. Independent of `calculateSelectionWeight`; the mode defines
     * its own meaning (amount, score, HP, …) and renderers never assume it.
     */
    getParticipantVisualValue(
        lot: Lot,
        participant: GameParticipantState,
        state: GameModeState
    ): number;

    /** Pure turn processing: (state, rolled participant) -> (state', outcome). */
    processRoll(
        rolledLot: Lot,
        rolled: GameParticipantState,
        participants: readonly GameParticipantState[],
        lots: readonly Lot[],
        state: GameModeState
    ): {
        state: GameModeState;
        participants: GameParticipantState[];
        outcome: TurnOutcome;
    };

    /**
     * Presentation data for the whole session, keyed by lot id. Called once per
     * view-state build with the full context (participants + lots), so a mode
     * can compute set-level presentation — e.g. the eventual win probability —
     * once instead of per participant. Opaque to the core; return an empty map
     * when there is nothing to present.
     */
    getPresentationData(
        participants: readonly GameParticipantState[],
        lots: readonly Lot[],
        state: GameModeState
    ): ReadonlyMap<string, ModePresentationData>;
}

// ========================================
// PRESENTATION MODEL
// ========================================

/**
 * One participant as the presentation layer sees it.
 *
 * Two INDEPENDENT magnitudes:
 *  - `selectionWeight` — probability weight used by roulette selection. It
 *    never determines visual size.
 *  - `visualValue` — abstract presentation magnitude the visualization turns
 *    into a size/scale. The mode defines its meaning (amount, score, HP, …);
 *    renderers must never assume it means weight, amount or HP. Changing it
 *    does not change the selection probability, and vice versa.
 *
 * `presence` is a visual multiplier in [0, 1] used to animate eliminations by
 * interpolating a view state (a lot leaves the view when it reaches 0).
 * `modeData` is mode-specific presentation payload the UI may render — the
 * core and the visualizations never interpret its meaning. It is produced once
 * per view-state build by `GameMode.getPresentationData()`.
 */
export interface RenderableParticipant {
    lot: Lot;
    active: boolean;
    selectionWeight: number;
    visualValue: number;
    presence: number;
    modeData?: ModePresentationData;
}

/** Immutable snapshot of the game for the UI and visualizations. */
export interface GameViewState {
    modeId: Mode;
    participants: RenderableParticipant[];
}

/**
 * Highlight state driven by the game: `game` is the set of lots emphasised
 * because of game state / outcome (winners, eliminated, …); `pulse` scales
 * that emphasis (0..1) so an outcome transition can fade it in — the stable
 * state uses 1.
 *
 * The visualization's *cursor* is deliberately NOT part of this state. It is
 * derived by the visualization itself from its own animation scalar (see
 * `IRenderer.getCursorLotId`) and only exposed read-only — it never round-trips
 * through the driver, so game and cursor highlights cannot overwrite each other.
 */
export interface HighlightState {
    game: ReadonlySet<string>;
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
 * highlight state, and internally owns its own spin math and cursor. It
 * never knows game rules and never mutates game state.
 *
 * Cursor: derived inside the visualization from its own animation scalar and
 * used for its own cursor emphasis. `getCursorLotId()` is a read-only external
 * query (for the UI); the cursor is never pushed back in through
 * `setViewState`.
 *
 * Highlight has two independent channels that compose at draw time:
 *  - the game highlight (winners / eliminated), fed via `setViewState`;
 *  - the transient hover highlight (lots-list interaction), fed via `setHover`.
 * Neither mutates the other.
 */
export interface IRenderer {
    /**
     * Adopt a presentation snapshot + highlight state. This is the only way
     * highlight state is fed in; the visualization manages its own cursor
     * internally.
     *
     * Called once for a spin, but once PER FRAME during an outcome transition
     * (with an interpolated snapshot), so `onViewStateChanged` must stay cheap:
     * rebuild derived geometry, but cache heavy layout keyed on its inputs
     * (see CountingRhymeRenderer's grid cache).
     */
    setViewState(view: GameViewState, highlight: HighlightState): void;

    /**
     * Set the transient hover highlight to a lot id, or `null` to clear it.
     * Identity is the stable `lot.id`; the renderer resolves it against its own
     * Lot Representation (sector / band / circle) and picks the visual
     * treatment. Hover composes with — and never replaces — the game highlight
     * fed via `setViewState`: it changes no geometry, weight or animation
     * state, and an unknown/absent id simply highlights nothing.
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
