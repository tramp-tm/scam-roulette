// Lot interface - represents a single item in the roulette
export interface Lot {
    id: string;
    name: string;
    amount: number;
    color: string;
    active: boolean;
}

// Mode configuration interface - encapsulates all mode-specific behavior
export interface ModeConfig {
    id: Mode;
    name: string;
    description: string;
    /** Calculates weight for a lot in this mode */
    calculateWeight: (lot: Lot, allLots: Lot[]) => number;
    /** Generates the result text shown after a roll */
    getResultText: (winner: Lot) => string;
    /** Optional hook called after each roll completes (for survival elimination, etc.) */
    onRollEnd?: (winner: Lot, activeLots: Lot[], totalLots: number) => {
        eliminatedLotId?: string;
        isComplete?: boolean;
        completionMessage?: string;
    };
}

// Mode configurations - all mode logic lives here
export const MODES: Record<Mode, ModeConfig> = {
    normal: {
        id: 'normal',
        name: 'Normal',
        description: 'Higher amount = Higher chance to win',
        calculateWeight: (lot: Lot) => lot.amount,
        getResultText: (winner: Lot) => `Winner: ${winner.name}`,
    },
    survival: {
        id: 'survival',
        name: 'Survival',
        description: 'Lower amount = Higher chance to be eliminated',
        calculateWeight: (lot: Lot) => 1 / lot.amount,
        getResultText: (winner: Lot) => `Eliminated: ${winner.name}`,
        onRollEnd: (winner: Lot, activeLots: Lot[], totalLots: number) => {
            // In survival mode, the "winner" is actually eliminated
            const result = {
                eliminatedLotId: winner.id,
                isComplete: false as boolean,
                completionMessage: '' as string
            };
            
            // Check if only one lot remains (survival complete)
            if (activeLots.length === 1 && totalLots > 1) {
                result.isComplete = true;
                const survivor = activeLots.find((l: Lot) => l.id !== winner.id);
                result.completionMessage = `🏆 SURVIVAL COMPLETE! 🏆\n\nThe last lot standing is:\n${survivor?.name}`;
            }
            
            return result;
        },
    },
};

// Helper to get mode config by ID
export function getModeConfig(modeId: Mode): ModeConfig {
    return MODES[modeId];
}

// Application modes
export type Mode = 'normal' | 'survival';

// Visualization types
export type VisualizationType = 'wheel' | 'strip';

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
 */
export interface ImportStrategy {
    id: 'replace' | 'merge';
    label: string;
    description: string;
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
 * Options for rendering a lots list.
 */
export interface LotsListRenderOptions {
    showActions?: boolean;  // Show delete/edit buttons
    highlightId?: string | null;  // ID of lot to highlight
    editableAmount?: boolean;  // Whether amount input is editable
    onAmountChange?: (id: string, newAmount: number) => void;  // Callback for amount changes
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
    updateSegments(lots: Lot[], modeConfig: ModeConfig): void;
    
    /** Set current rotation value (for animation) */
    setRotation(value: number): void;
    
    /** Get current rotation value */
    getCurrentRotation(): number;
    
    /** Set highlighted lot ID */
    setHighlightedLot(id: string | null): void;
    
    /** Render the visualization to canvas */
    render(canvasWidth: number, canvasHeight: number): void;
    
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
        modeConfig: ModeConfig,
        targetLotId: string,
        currentPosition: number,
        animationDurationMs: number,
        canvasWidth?: number
    ) => number;
}
