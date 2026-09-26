import { Lot, GameMode } from './types.js';
import { BaseRenderer } from './baseRenderer.js';

/**
 * CountingRhymeRenderer
 * ---------------------
 * New visualization: each active lot is drawn as a circle whose radius
 * reflects its weight *relative to the heaviest active lot*. During animation
 * the "counting-rhyme" highlight hops from circle to circle.
 *
 * Contract (§ of the task spec):
 *  - §6:  weights come from the shared Segment[] produced by
 *         RouletteEngine.calculateSegments() via BaseRenderer.updateSegments().
 *         This renderer never calls GameMode.calculateWeight() itself.
 *  - §7:  radius is proportional to the lot's weight *relative to the largest
 *         active weight* (w_i / max(w)), not to the raw normalized weight.
 *         The mapping is still monotone in weight; only the baseline (the
 *         heaviest lot fills the cell) differs.
 *  - §10: the per-frame highlighted circle is derived inside render() from
 *         `currentRotation` + `segments`. `highlightedLotId` (the field set by
 *         App via IRenderer.setHighlightedLot) is NOT the driver here.
 *         The resolved index lives in `currentHighlighted` and is internal.
 *  - §11: `currentRotation` is measured in *cycles*. One unit = one full
 *         traversal of the circle ring. Circle i owns the interval
 *         [P_i, P_{i+1}) where P is the prefix sum of Segment.weight.
 *         Dwell per traversal is therefore exactly w_i · T_cycle.
 *  - §21: the engine guarantees endValue ≡ targetMid (mod 1), so the final
 *         animated frame highlights the rolled lot.
 *  - §32: layout is computed once per updateSegments() and cached;
 *         render() never regenerates positions; the grid uses logical
 *         getBoundingClientRect() dimensions, not canvas.width / canvas.height.
 *
 * NOTE: radius and dwell are deliberately derived from *two different*
 * normalizations of the same weight — timing from raw `w` (probability),
 * radius from `w / max(w)` (relative magnitude). Do not "unify" them:
 * dividing the dwell partition by max(w) would break the Σw = 1 invariant
 * that computeIntensities() relies on.
 */

/** Gold that matches the wheel / strip pointers. */
const HIGHLIGHT_COLOR = 'gold';
const HIGHLIGHT_GLOW_BLUR = 24;
const HIGHLIGHT_STROKE_WIDTH = 4;

const BASE_STROKE_COLOR = 'rgba(255, 255, 255, 0.45)';
const BASE_STROKE_WIDTH = 2;

const MIN_CIRCLE_RADIUS = 14;
const MAX_CIRCLE_RADIUS = 250;

/** Fraction of the (smaller) grid cell a circle may occupy at most. */
const CELL_FILL_RATIO =0.25+ 0.85;

/**
 * Crossfade window expressed as a fraction of the *current* segment.
 * Because the window scales with the segment's own length, dwell time per
 * lot stays proportional to its weight (§15).
 */
const TRANSITION_FRACTION = 0.2;

const LABEL_FONT = '16px sans-serif';
const LABEL_MIN_RADIUS = 22;
const LABEL_SHADOW_COLOR = 'rgba(0, 0, 0, 0.65)';

interface CircleLayout {
    lotId: string;
    cx: number;
    cy: number;
    radius: number;
}

export class CountingRhymeRenderer extends BaseRenderer {
    /** Deterministic layout, rebuilt only when segments change. */
    private layout: CircleLayout[] = [];

    /** prefixSums[i] = sum of Segment.weight for segments[0..i-1]. */
    private prefixSums: number[] = [];

    /** Currently resolved circle index (internal; not driven by highlightLotId). */
    private currentHighlighted: number = -1;

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    override updateSegments(lots: Lot[], mode: GameMode): void {
        super.updateSegments(lots, mode);
        this.rebuildPrefixSums();
        this.rebuildLayout();
    }

    override reset(): void {
        super.reset();
        // §23 / §32: also clear the cached layout so the next updateSegments()
        // starts from a clean slate.
        this.layout = [];
        this.prefixSums = [];
        this.currentHighlighted = -1;
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------

    render(canvasWidth: number, canvasHeight: number): void {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        if (this.layout.length === 0) return;

        // §10 / §11: resolve highlighted index from currentRotation — the
        // animation value unit here is "cycles", not radians.
        const frac = this.normalizePosition(this.currentRotation);
        const intensities = this.computeIntensities(frac);

        for (let i = 0; i < this.layout.length; i++) {
            const circle = this.layout[i];
            const segment = this.segments[i];
            const intensity = intensities[i];

            // ---- filled disc ------------------------------------------
            ctx.save();
            ctx.beginPath();
            ctx.arc(circle.cx, circle.cy, circle.radius, 0, Math.PI * 2);
            ctx.fillStyle = segment.lot.color || '#888888';
            ctx.fill();
            ctx.restore();

            // ---- outline / highlight ----------------------------------
            ctx.save();
            ctx.beginPath();
            ctx.arc(circle.cx, circle.cy, circle.radius, 0, Math.PI * 2);
            if (intensity > 0.01) {
                ctx.strokeStyle = HIGHLIGHT_COLOR;
                ctx.lineWidth = HIGHLIGHT_STROKE_WIDTH;
                ctx.shadowColor = HIGHLIGHT_COLOR;
                ctx.shadowBlur = HIGHLIGHT_GLOW_BLUR * intensity;
                ctx.globalAlpha = intensity;
            } else {
                ctx.strokeStyle = BASE_STROKE_COLOR;
                ctx.lineWidth = BASE_STROKE_WIDTH;
            }
            ctx.stroke();
            ctx.restore();

            // ---- label ------------------------------------------------
            if (circle.radius >= LABEL_MIN_RADIUS) {
                this.drawLabel(segment.lot.name, circle);
            }
        }
    }

    // ------------------------------------------------------------------
    // Layout (§8 / §9 / §32)
    // ------------------------------------------------------------------

    private rebuildPrefixSums(): void {
        this.prefixSums = [0];
        for (const s of this.segments) {
            this.prefixSums.push(this.prefixSums[this.prefixSums.length - 1] + s.weight);
        }
    }

    /**
     * Deterministic grid layout, computed once per updateSegments() and
     * cached for the whole spin. No randomness, no per-frame repositioning.
     */
    private rebuildLayout(): void {
        this.layout = [];

        const n = this.segments.length;
        if (n === 0) return;

        // Logical CSS pixels — the backing store is dpr-scaled by BaseRenderer.
        const rect = this.canvas.getBoundingClientRect();
        const width = rect.width || BaseRenderer.FALLBACK_WIDTH;
        const height = rect.height || BaseRenderer.FALLBACK_HEIGHT;

        const aspect = width / height;
        const cols = Math.max(1, Math.ceil(Math.sqrt(n * aspect)));
        const rows = Math.ceil(n / cols);

        const cellWidth = width / cols;
        const cellHeight = height / rows;
        const cellHalf = Math.min(cellWidth, cellHeight) / 2;
        // Single shared cap → monotonic radius mapping is preserved even
        // when the grid is tight (§7).
        const effectiveMaxRadius = Math.min(
            MAX_CIRCLE_RADIUS,
            cellHalf * CELL_FILL_RATIO
        );

        // Radius maps weight RELATIVE to the heaviest lot, not the raw
        // normalized weight. Since calculateSegments() normalizes weights so
        // that Σwᵢ = 1, using wᵢ directly would cap every circle at
        // MIN + (1/n)·range — the largest possible radius would shrink as
        // lots are added. Dividing by maxWeight lifts the heaviest lot to
        // exactly effectiveMaxRadius and keeps monotonicity in weight (§7).
        let maxWeight = 0;
        for (const s of this.segments) {
            if (s.weight > maxWeight) maxWeight = s.weight;
        }
        const safeMaxWeight = maxWeight > 0 ? maxWeight : 1;
        const radiusRange = Math.max(0, effectiveMaxRadius - MIN_CIRCLE_RADIUS);

        for (let i = 0; i < n; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);

            // Center a possibly-partial final row horizontally.
            const itemsInRow = row === rows - 1 ? n - row * cols : cols;
            const rowOffset = (cols - itemsInRow) / 2;

            const cx = (col + rowOffset + 0.5) * cellWidth;
            const cy = (row + 0.5) * cellHeight;

            const weightRatio = this.segments[i].weight / safeMaxWeight;
            const radius = MIN_CIRCLE_RADIUS + weightRatio * radiusRange;

            this.layout.push({
                lotId: this.segments[i].lot.id,
                cx,
                cy,
                radius
            });
        }
    }

    // ------------------------------------------------------------------
    // Position → highlight (counting-rhyme mechanics, §11 / §20)
    // ------------------------------------------------------------------

    private normalizePosition(position: number): number {
        return ((position % 1) + 1) % 1;
    }

    /**
     * Returns the highlight intensity per circle for a fractional cycle
     * position. Exactly one circle is "current" at any given moment; the
     * transition into it is smoothed over the first TRANSITION_FRACTION of
     * its own segment, so the visual crossfade spans w_i · T_cycle · f.
     *
     * Uses the raw normalized Segment.weight (NOT the per-max ratio used for
     * radius): the cycle must be partitioned by actual probabilities so that
     * dwell time stays proportional to weight (§11 / §15).
     */
    private computeIntensities(frac: number): number[] {
        const n = this.segments.length;
        const intensities = new Array<number>(n).fill(0);
        if (n === 0) return intensities;

        // Find i such that P_i <= frac < P_{i+1}.
        let idx = n - 1; // fallback for floating-point rounding on frac ≈ 1
        for (let i = 0; i < n; i++) {
            if (frac < this.prefixSums[i + 1]) {
                idx = i;
                break;
            }
        }
        this.currentHighlighted = idx;

        const start = this.prefixSums[idx];
        const weight = this.segments[idx].weight;
        const local = weight > 0 ? (frac - start) / weight : 0;

        if (n === 1 || local >= TRANSITION_FRACTION) {
            // Steady state — the current circle owns the whole frame.
            intensities[idx] = 1;
            return intensities;
        }

        // Crossfade from the previous circle into the current one.
        const t = local / TRANSITION_FRACTION; // 0 → 1 within the window
        const prevIdx = (idx - 1 + n) % n;
        intensities[idx] = t;
        intensities[prevIdx] = 1 - t;
        return intensities;
    }

    // ------------------------------------------------------------------
    // Label helper
    // ------------------------------------------------------------------

    private drawLabel(name: string, circle: CircleLayout): void {
        const ctx = this.ctx;
        const maxWidth = circle.radius * 1.6;

        let label = name;
        ctx.save();
        ctx.font = LABEL_FONT;
        if (ctx.measureText(label).width > maxWidth) {
            while (
                label.length > 1 &&
                ctx.measureText(label + '…').width > maxWidth
            ) {
                label = label.slice(0, -1);
            }
            label += '…';
        }
        ctx.restore();

        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.font = LABEL_FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = LABEL_SHADOW_COLOR;
        ctx.lineWidth = 3;
        ctx.strokeText(label, circle.cx, circle.cy);
        ctx.fillText(label, circle.cx, circle.cy);
        ctx.restore();
    }
}
