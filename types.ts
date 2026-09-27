// Lot interface - represents a single item in the roulette
export interface Lot {
    id: string;
    name: string;
    amount: number;
    color: string;
}

// ========================================
// GAME MODE STRATEGY TYPES
// ========================================

/**
 * Snapshot of the game state, passed to a mode's roll-processing logic.
 */
export interface GameState {
    allLots: Lot[];
    activeLots: Lot[];
}

/**
 * Result of processing a roll through a game mode.
 */
export interface RollResult {
    finished: boolean;
    winner: Lot | null;
    deactivate: string[];
    message?: string;
}

/**
 * Reasons `GameSession.prepareSpin()` can refuse a spin. Exactly the
 * four current failure branches — no hypothetical states.
 */
export type PrepareSpinFailureReason =
    | 'spinInProgress'
    | 'gameFinished'
    | 'noActiveLots'
    | 'noValidWeights';

/**
 * Result of `GameSession.prepareSpin()`. Replaces the previous
 * `Lot | null` so `App` can surface the correct message.
 */
export type PrepareSpinResult =
    | { ok: true; lot: Lot }
    | { ok: false; reason: PrepareSpinFailureReason };

/**
 * A spin that has been decided (lot AND mode chosen) but not yet applied.
 * Created only by GameSession.prepareSpin(); consumed only by
 * GameSession.finishSpin(). Carries the mode that governed the roll so the
 * later application cannot drift if the session mode ever changed between
 * the two calls (planB).
 */
export interface PendingSpin {
    rolledLot: Lot;
    mode: GameMode;
}

/**
 * Game mode strategy. Encapsulates all mode-specific behavior without
 * switch statements or branching in the core app/engine.
 */
export interface GameMode {
    readonly id: Mode;
    readonly name: string;
    readonly description: string;
    calculateWeight(lot: Lot, activeLots: Lot[]): number;
    getRollText(rolledLot: Lot): string;
    processRoll(rolledLot: Lot, state: GameState): RollResult;
}

// Application modes
export type Mode = 'normal' | 'survival';

// Visualization types
export type VisualizationType = 'wheel' | 'strip' | 'counting-rhyme';

// Settings interface
export interface Settings {
    modeId: Mode;  // Changed from 'mode' to 'modeId' for clarity
    visualization: VisualizationType;
    animationDuration: number; // in milliseconds
}


// Segment data for rendering
export interface Segment {
    lot: Lot;
    startAngle: number; // in radians, 0 = top (wheel) or left (strip)
    endAngle: number;   // in radians
    weight: number;     // normalized weight (0-1)
}

// Easing function type
export type EasingFunction = (t: number) => number;

// ========================================
// SORTING TYPES
// ========================================

/** Sort field options for lots list */
export type SortField = 'name' | 'amount';

/** Sort direction */
export type SortDirection = 'asc' | 'desc';

// ========================================
// IMPORT FEATURE TYPES
// ========================================

/**
 * Separator types for CSV import parsing.
 */
export type SeparatorType = 'comma' | 'tab';

/**
 * Represents a lot parsed from CSV input (before being added to the application).
 */
export interface ParsedLot {
    name: string;
    amount: number;
}

/**
 * Result of parsing CSV text.
 * Contains valid lots that can be imported and count of error rows.
 */
export interface ParseResult {
    validLots: ParsedLot[];
    errorCount: number;
}

/** Result of import execution - tracks success and truncation */
export interface ImportResult {
    lotsAdded: number;
    lotsTruncated: number;  // How many were skipped due to MAX_LOTS limit
}

/**
 * Strategy object for handling import operations.
 * Encapsulates the logic for a specific import strategy.
 *
 * Note: the former `label` / `description` fields were removed. They were
 * dead code — the only UI consumer (importConflictDialog.ts) drives its
 * text through `data-i18n="importStrategy.<id>.label|description"` keys so
 * the strings are translated by translateDOM() and re-render on language
 * change. Any in-strategy strings would have been frozen at module-load
 * time (before initI18n resolved) and never reflected the active locale.
 */
export interface ImportStrategy {
    id: 'replace' | 'merge';
    /** Execute function - LotManager type is referenced but not imported to avoid circular dependency */
    execute: (parsedLots: ParsedLot[], lotManager: any) => ImportResult;
}

/** Strategies are defined in strategies.ts to avoid circular dependencies */

// ========================================
// UI RENDERING TYPES
// ========================================

/**
 * Interface for lot data that can be rendered in a list.
 * Supports both full Lot objects and ParsedLot from CSV import.
 */
export interface RenderableLot {
    name: string;
    amount: number;
    id?: string;
    color?: string;
    active?: boolean;
}

/**
 * Options for rendering a lots list via `LotListView`.
 */
export interface LotListViewOptions {
    showActions?: boolean;
    highlightId?: string | null;
    editableAmount?: boolean;
    onAmountChange?: (id: string, newAmount: number) => void;
    onDelete?: (id: string) => void;
}

// ========================================
// MODAL DIALOG TYPES
// ========================================

/** Callback type for receiving parsed lots from ImportDialog */
export type ImportCallback = (parsedLots: ParsedLot[]) => void;

// ========================================
// RENDERER INTERFACE
// ========================================

/**
 * Abstract renderer interface for visualization strategies.
 */
export interface IRenderer {
    /** Update segments based on lots and mode configuration */
    updateSegments(lots: Lot[], mode: GameMode): void;
    
    /** Set current rotation value (for animation) */
    setRotation(value: number): void;
    
    /** Get current rotation value */
    getCurrentRotation(): number;
    
    /** Set highlighted lot ID */
    setHighlightedLot(id: string | null): void;
    
    /** Render the visualization to canvas (uses the renderer's own logical canvas size) */
    render(): void;
    
    /** Reset renderer state */
    reset(): void;
}

// ========================================
// VISUALIZATION PACKAGE TYPES
// ========================================

/**
 * Bundled package containing everything needed for a visualization type.
 * Eliminates string-based branching by providing renderer factory and strategy together.
 */
export interface VisualizationPackage {
    id: VisualizationType;
    createRenderer: (canvas: HTMLCanvasElement) => IRenderer;
    computeFinalPosition: (
        lots: Lot[],
        mode: GameMode,
        targetLotId: string,
        currentPosition: number,
        animationDurationMs: number,
        canvasWidth?: number
    ) => number;
}
