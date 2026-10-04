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
 * Parses a CSS colour the app can produce into RGB channels, or null when the
 * format is not recognised.
 *
 * Supports `#RGB`, `#RRGGBB`, `rgb(...)`/`rgba(...)` and `hsl(...)`/`hsla(...)`
 * — the app produces `rgb(...)` (read back from `style.backgroundColor`) for
 * manually added lots and `hsl(...)` for imported ones.
 */
function parseColorToRgb(color: string): { r: number; g: number; b: number } | null {
    const c = color.trim().toLowerCase();

    if (c.startsWith('#')) {
        if (c.length === 4) {
            return {
                r: parseInt(c[1] + c[1], 16),
                g: parseInt(c[2] + c[2], 16),
                b: parseInt(c[3] + c[3], 16)
            };
        }
        if (c.length === 7) {
            return {
                r: parseInt(c.slice(1, 3), 16),
                g: parseInt(c.slice(3, 5), 16),
                b: parseInt(c.slice(5, 7), 16)
            };
        }
        return null;
    }

    const rgbMatch = c.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
    if (rgbMatch) {
        return { r: Math.round(+rgbMatch[1]), g: Math.round(+rgbMatch[2]), b: Math.round(+rgbMatch[3]) };
    }

    const hslMatch = c.match(/^hsla?\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%/);
    if (hslMatch) {
        return hslToRgb(+hslMatch[1], +hslMatch[2] / 100, +hslMatch[3] / 100);
    }

    return null;
}

/** Standard HSL → RGB conversion. h in [0,360), s and l in [0,1]. */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hh = ((h % 360) + 360) % 360 / 60;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (hh < 1) { r = c; g = x; }
    else if (hh < 2) { r = x; g = c; }
    else if (hh < 3) { g = c; b = x; }
    else if (hh < 4) { g = x; b = c; }
    else if (hh < 5) { r = x; b = c; }
    else { r = c; b = x; }

    const m = l - c / 2;
    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
    };
}

/**
 * Brightens a colour by the specified percentage (0–255 per channel), on top
 * of the colour's own RGB. Returns an `rgb(...)` string. When the input format
 * is not recognised the colour is returned unchanged (never black).
 */
export function brightenColor(color: string, percent: number): string {
    const parsed = parseColorToRgb(color);
    if (!parsed) return color;

    const r = Math.min(255, parsed.r + percent);
    const g = Math.min(255, parsed.g + percent);
    const b = Math.min(255, parsed.b + percent);

    return `rgb(${r}, ${g}, ${b})`;
}

// ========================================
// STRIP GEOMETRY
// ========================================

/** Minimum width (px) of a strip segment, regardless of weight */
export const MIN_SEGMENT_WIDTH = 60;

/** Multiplier applied to a segment's normalized weight to get its width */
export const SEGMENT_WIDTH_SCALE = 400;

/**
 * Computes the rendered width of a strip segment from its normalized weight.
 * This is the single source of truth shared by StripRenderer (drawing) and
 * RouletteEngine.computeFinalScrollOffset (scroll math) — they must never drift.
 */
export function getSegmentWidth(weight: number): number {
    return Math.max(MIN_SEGMENT_WIDTH, weight * SEGMENT_WIDTH_SCALE);
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
