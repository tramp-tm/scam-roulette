/**
 * Generates a random color with good contrast for white text.
 * Uses HSL to ensure colors are dark enough (lightness 20-45%).
 */
export function generateRandomReadableColor(): string {
    const hue = Math.floor(Math.random() * 360);
    const saturation = Math.floor(Math.random() * 40) + 60; // 60-100%
    const lightness = Math.floor(Math.random() * 25) + 20; // 20-45%
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Brightens a color by the specified percentage.
 * Converts hex to RGB, brightens each channel, returns rgb() string.
 */
export function brightenColor(color: string, percent: number): string {
    let r = 0, g = 0, b = 0;
    
    if (color.length === 4) {
        r = parseInt('0x' + color[1] + color[1]);
        g = parseInt('0x' + color[2] + color[2]);
        b = parseInt('0x' + color[3] + color[3]);
    } else if (color.length === 7) {
        r = parseInt('0x' + color[1] + color[2]);
        g = parseInt('0x' + color[3] + color[4]);
        b = parseInt('0x' + color[5] + color[6]);
    }

    r = Math.min(255, r + percent);
    g = Math.min(255, g + percent);
    b = Math.min(255, b + percent);

    return `rgb(${r}, ${g}, ${b})`;
}

// ========================================
// DURATION SLIDER MAPPING
// ========================================

/**
 * Map for slider positions > 60 to predefined duration values in seconds.
 */
const DURATION_MAP: Record<number, number> = {
    61: 70,
    62: 80,
    63: 90,
    64: 120,
    65: 150,
    66: 180,
    67: 240,
    68: 300,
};

/** Maximum slider position value - derived from DURATION_MAP's last key */
export const MAX_DURATION_SLIDER_VALUE = Object.keys(DURATION_MAP).reduce((max, key) => 
    Math.max(max, parseInt(key)), 0);

/** Maximum duration in seconds - derived from DURATION_MAP's max value */
export const MAX_DURATION_SEC = Object.keys(DURATION_MAP)
    .map(key => DURATION_MAP[parseInt(key)])
    .reduce((max, val) => Math.max(max, val), 60);

/** Minimum animation duration in seconds */
export const MIN_DURATION_SEC = 1;

/**
 * Converts a slider position to duration in SECONDS.
 */
export function sliderToDuration(sliderValue: number): number {
    const clampedPos = Math.max(1, Math.min(MAX_DURATION_SLIDER_VALUE, sliderValue));
    
    if (clampedPos <= 60) {
        return clampedPos; // Direct mapping for positions 1-60 → returns SECONDS
    } else {
        return DURATION_MAP[clampedPos] ?? MAX_DURATION_SEC; // Returns SECONDS
    }
}

/**
 * Converts a duration in SECONDS to slider position value.
 * Finds nearest allowed position when exact match not found.
 */
export function durationToSlider(durationSeconds: number): number {
    const clamped = Math.max(1, Math.min(MAX_DURATION_SEC, durationSeconds));
    
    if (clamped <= 60) {
        return clamped; // Direct mapping for durations 1-60 seconds
    } else {
        // Find the slider position that maps to this duration using a simple loop
        const keys = Object.keys(DURATION_MAP);
        
        // First try exact match
        for (let i = 0; i < keys.length; i++) {
            const pos = parseInt(keys[i]);
            if (DURATION_MAP[pos] === clamped) {
                return pos;
            }
        }
        
        // No exact match - find nearest allowed duration value
        let nearestPos = MAX_DURATION_SLIDER_VALUE;
        let minDiff = Infinity;
        
        for (let i = 0; i < keys.length; i++) {
            const pos = parseInt(keys[i]);
            const diff = Math.abs(DURATION_MAP[pos] - clamped);
            if (diff < minDiff) {
                minDiff = diff;
                nearestPos = pos;
            }
        }
        
        return nearestPos;
    }
}

/**
 * Generates a random position within a span with edge margins.
 * Used for landing positions in wheel/strip animations.
 */
export function getRandomPositionInRange(
    span: number,
    edgeMarginPercent: number = 0.02,
    maxEdgeMargin: number = 3
): number {
    const margin = Math.min(span * edgeMarginPercent, maxEdgeMargin);
    const minOffset = margin;
    const maxOffset = span - margin;
    return Math.random() * (maxOffset - minOffset) + minOffset;
}

