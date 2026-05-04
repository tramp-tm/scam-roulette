// Lot interface - represents a single item in the roulette
export interface Lot {
    id: string;
    name: string;
    amount: number;
    color: string;
    active: boolean;
}

// Application modes
export type Mode = 'normal' | 'survival';

// Visualization types
export type VisualizationType = 'wheel' | 'strip';

// Settings interface
export interface Settings {
    mode: Mode;
    visualization: VisualizationType;
    animationDuration: number; // in milliseconds
}

// Animation state interface
export interface AnimationState {
    isPlaying: boolean;
    progress: number;
    currentValue: number;
}

// Application state
export interface AppState {
    lots: Lot[];
    settings: Settings;
    animation: AnimationState;
    highlightedLotId: string | null; // Currently highlighted lot (winner/eliminated)
    isSettingsLocked: boolean;
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
