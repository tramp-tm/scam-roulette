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

/** Maximum slider position value */
export const MAX_DURATION_SLIDER_VALUE = 68;

/**
 * Converts a slider position to duration in seconds.
 * Positions 1-60 map directly to seconds (1s-60s).
 * Positions 61+ use predefined values from DURATION_MAP.
 */
export function sliderToDuration(sliderValue: number): number {
    const clampedPos = Math.max(1, Math.min(MAX_DURATION_SLIDER_VALUE, sliderValue));
    
    if (clampedPos <= 60) {
        return clampedPos; // Direct mapping for positions 1-60
    } else {
        return DURATION_MAP[clampedPos] ?? 300; // Lookup or default to 300s
    }
}

/**
 * Converts a duration in seconds to slider position value.
 * Inverse of sliderToDuration().
 */
export function durationToSlider(durationSeconds: number): number {
    const clamped = Math.max(1, Math.min(300, durationSeconds));
    
    if (clamped <= 60) {
        return clamped; // Direct mapping for durations 1-60 seconds
    } else {
        // Find the slider position that maps to this duration
        for (const [pos, dur] of Object.entries(DURATION_MAP)) {
            if (dur === clamped) {
                return parseInt(pos);
            }
        }
        // Default to max position (300s) if not found in map
        return MAX_DURATION_SLIDER_VALUE;
    }
}

