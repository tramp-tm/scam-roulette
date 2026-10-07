import type { Lot } from './types.js';

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

/** Minimum width (px) of a strip band, regardless of its visual fraction. */
const MIN_BAND_WIDTH = 60;

/**
 * Multiplier applied to a band's normalized visual fraction to get its width.
 * Exported because the strip's "real chances" mode needs the bare scale: it draws
 * `fraction * BAND_WIDTH_SCALE` WITHOUT the minimum-width floor.
 */
export const BAND_WIDTH_SCALE = 400;

/**
 * Rendered width (px) of a strip band from its normalized visual fraction
 * (yValue / Σ yValue). Strip-specific visual geometry — it is NOT a
 * shared roulette contract and is not used by RouletteEngine.
 */
export function getStripBandWidth(fraction: number): number {
    return Math.max(MIN_BAND_WIDTH, fraction * BAND_WIDTH_SCALE);
}

// ========================================
// VISUAL CHANCE FLOOR (readable sectors)
// ========================================

/** Smallest visible share of a wheel sector (a fraction of the full circle). */
export const MIN_VISUAL_SECTOR = 0.01;

/**
 * Reshapes honest chance fractions (Σ = 1) so their MINIMUM becomes exactly
 * `minSector`, keeping the sum at 1 and the order (and the relative gaps) intact:
 * `b_i = m + k·(a_i − aMin)` with `k = (1 − n·m)/(1 − n·aMin)`.
 *
 * The map is affine, so distinct chances never collapse onto one another (unlike
 * a plain `max(floor, a)`), and the floor is adaptive: `m = min(minSector, 1/n)` —
 * with many participants it degrades to the even share, and `m = 1/n` gives
 * `k = 0` (every sector equal), which is the only way to keep Σ = 1 once the
 * floor has reached the mean.
 *
 * Returns the input UNCHANGED unless it is a proper distribution whose smallest
 * share is below the floor: `n <= 1`, a sum other than 1 (e.g. the all-zero
 * degenerate case), `m <= 0`, `aMin >= m` (the floor is already satisfied — the
 * operator never LOWERS the smallest share) or a non-positive/non-finite scale.
 */
export function normalizeChancesAffine(fractions: readonly number[], minSector: number): number[] {
    const n = fractions.length;
    if (n <= 1) return [...fractions];

    let sum = 0;
    for (const a of fractions) sum += a;
    if (Math.abs(sum - 1) > 1e-9) return [...fractions];

    const aMin = Math.min(...fractions);
    const m = Math.min(minSector, 1 / n);
    if (!(m > 0)) return [...fractions];
    if (aMin >= m) return [...fractions];

    // k === 0 is the documented degenerate case (m reached the mean => every
    // share becomes exactly 1/n); k < 0 or a non-finite k means bad input.
    const k = (1 - n * m) / (1 - n * aMin);
    if (!isFinite(k) || k < 0) return [...fractions];

    return fractions.map(a => m + k * (a - aMin));
}

/**
 * Index lots by id (`lotId -> Lot`) — the neutral lookup map shared by the
 * session and the modes. Lives here (not in a mode-specific module) because it
 * carries no roulette/mode semantics.
 */
export function indexLots(lots: readonly Lot[]): Map<string, Lot> {
    return new Map(lots.map(l => [l.id, l]));
}

/**
 * Normalizes a list of non-negative magnitudes so they sum to 1 (fractions).
 * Non-positive entries map to 0. Neutral helper used by renderers to turn a
 * magnitude distribution into geometry; it carries no participant semantics
 * and no roulette geometry.
 */
export function normalizeToFractions(values: readonly number[]): number[] {
    let total = 0;
    for (const v of values) if (v > 0) total += v;
    if (!(total > 0)) return values.map(() => 0);
    return values.map(v => (v > 0 ? v / total : 0));
}

/**
 * Min–max normalization (min–max scaling): linearly rescales `values` from
 * their own range onto `[minValue, maxValue]`:
 *
 *   x' = (x - min(A)) / (max(A) - min(A)) · (maxValue - minValue) + minValue
 *
 * Optimized over the literal three-array form: `min` and `max` are found in a
 * single pass, the output is produced in a second pass, there are no
 * intermediate `B[]`/`C[]` arrays, and the division by the range is folded into
 * one per-element scale+offset pair. The source array is never modified.
 *
 * Degenerate case `max(A) === min(A)` (all values equal, or a single element)
 * would divide by zero; following the standard min–max scaler behaviour, every
 * result is then the lower bound `minValue`.
 */
export function normalizeToRange(
    values: readonly number[],
    minValue: number,
    maxValue: number
): number[] {
    if (values.length === 0) return [];

    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
        if (v < min) min = v;
        if (v > max) max = v;
    }

    const range = max - min;
    if (!(range > 0)) return values.map(() => minValue);

    const scale = (maxValue - minValue) / range;
    return values.map(v => (v - min) * scale + minValue);
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
const MAX_DURATION_SLIDER_VALUE = Object.keys(DURATION_MAP).reduce((max, key) => 
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

// ========================================
// FORMATTING
// ========================================

/**
 * Formats a percentage for display: an exact integer keeps no decimals
 * ("100%", "50%"), otherwise one decimal ("42.5%", "7.1%").
 */
export function formatPercent(percent: number): string {
    const rounded = Math.round(percent * 10) / 10;
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${text}%`;
}

/**
 * Smallest positive percentage `formatPercent` can render (it keeps one
 * decimal place); anything below it would collapse to the misleading "0%".
 */
const MIN_DISPLAYABLE_PERCENT = 0.1;

/** Shown instead of a percentage below the displayable minimum. */
const BELOW_MINIMUM_PERCENT = '< 0.1%';

/**
 * Like `formatPercent`, but never renders a below-resolution probability as
 * "0%": values under `MIN_DISPLAYABLE_PERCENT` become the "< 0.1%" marker, so
 * a non-zero chance is never shown as impossible.
 */
export function formatPercentFloor(percent: number): string {
    return percent < MIN_DISPLAYABLE_PERCENT ? BELOW_MINIMUM_PERCENT : formatPercent(percent);
}
