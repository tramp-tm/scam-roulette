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
 * Game mode strategy. All mode-specific rules live here; the core app and
 * engine never branch on a mode id.
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
    modeId: Mode;
    visualization: VisualizationType;
    animationDuration: number; // in milliseconds
}

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
