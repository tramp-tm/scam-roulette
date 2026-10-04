import { RouletteEngine } from './rouletteEngine.js';
import { BaseRenderer } from './baseRenderer.js';

/**
 * CountingRhymeRenderer
 * ---------------------
 * Each active lot is drawn as a circle whose radius reflects its weight
 * *relative to the heaviest active lot*. During animation the
 * "counting-rhyme" highlight hops from circle to circle.
 *
 * Contract:
 *  - geometry comes from BaseRenderer: `segments` is the drawing partition
 *    (presence-scaled, so radii shrink during an elimination transition) and
 *    `timingSegments` is the STABLE partition used for highlight timing and
 *    cursor resolution. This renderer never computes game weights itself.
 *  - radius uses the *drawing* partition (`weight * presence`, relative to the
 *    heaviest), so an eliminated circle shrinks as its presence goes to 0.
 *  - the highlight index / cursor use the *timing* partition (raw weights),
 *    which is constant across an outcome transition — the "beat" does not hop
 *    while the geometry is animating.
 *  - the per-frame highlighted circle is derived inside render() from
 *    `animationValue`; the game/cursor emphasis is a separate layer.
 *  - `animationValue` is measured in *cycles*: one unit = one full traversal
 *    of the circle ring. Circle i owns [P_i, P_{i+1}) where P is the prefix
 *    sum of the timing weights, so dwell per traversal is w_i · T_cycle.
 *  - the engine guarantees endValue ≡ targetMid (mod 1), so the final
 *    animated frame highlights the rolled lot.
 *
 * PERFORMANCE: the deterministic grid (cell permutation + jitter) depends only
 * on the lot-id set and the canvas size, so it is cached and rebuilt only when
 * that signature changes — NOT on every transition frame. Radius is computed
 * per render from the current drawing weights.
 *
 * NOTE ON COSMETIC SHUFFLE: the segment → grid-cell mapping is permuted so the
 * highlight order is decoupled from the visual position; a deterministic
 * in-cell jitter is applied next. Both are seeded from the lot ids.
 * Math.random() is never called.
 */

/** Gold that matches the wheel / strip pointers. */
const HIGHLIGHT_COLOR = 'gold';
const HIGHLIGHT_GLOW_BLUR = 24;
const HIGHLIGHT_STROKE_WIDTH = 4;

const BASE_STROKE_COLOR = 'rgba(255, 255, 255, 0.45)';
const BASE_STROKE_WIDTH = 2;

const GAME_HIGHLIGHT_STROKE_WIDTH = 6;
const GAME_HIGHLIGHT_GLOW_BLUR = 30;

const MIN_CIRCLE_RADIUS = 14;
const MAX_CIRCLE_RADIUS = 250;

/** Fraction of the (smaller) grid cell a circle may occupy at most. */
const CELL_FILL_RATIO = 0.95;

/**
 * Crossfade window expressed as a fraction of the *current* segment, so dwell
 * time per lot stays proportional to its weight.
 */
const TRANSITION_FRACTION = 0.2;

const LABEL_FONT = '16px sans-serif';
const LABEL_MIN_RADIUS = 22;
const LABEL_SHADOW_COLOR = 'rgba(0, 0, 0, 0.65)';

/** Cached grid cell (position only; radius is per-frame). */
interface CircleCell {
    lotId: string;
    cx: number;
    cy: number;
}

export class CountingRhymeRenderer extends BaseRenderer {
    /** Cached grid cells, aligned by index with `segments`. */
    private cells: CircleCell[] = [];

    /** Signature (canvas size + lot-id set) the cells were built for. */
    private cellSignature = '';

    /** Max radius for the current grid (set when cells are (re)built). */
    private effectiveMaxRadius = 0;

    /** Prefix sums of the STABLE timing weights. */
    private timingPrefix: number[] = [];

    protected override onViewStateChanged(): void {
        this.rebuildTimingPrefix();
        this.ensureCells();
    }

    protected override onReset(): void {
        this.cells = [];
        this.cellSignature = '';
        this.effectiveMaxRadius = 0;
        this.timingPrefix = [];
    }

    render(): void {
        const ctx = this.ctx;
        const { width: canvasWidth, height: canvasHeight } = this.getLogicalSize();
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        const n = Math.min(this.cells.length, this.segments.length);
        if (n === 0) return;

        const maxWeight = this.maxSegmentWeight();
        const radiusRange = Math.max(0, this.effectiveMaxRadius - MIN_CIRCLE_RADIUS);

        const frac = this.normalizePosition(this.animationValue);
        const intensities = this.computeIntensities(frac);

        for (let i = 0; i < n; i++) {
            const cell = this.cells[i];
            const segment = this.segments[i];
            const presence = this.presenceOf(segment.lot.id);

            // Radius from the DRAWING weight (presence-scaled) → shrinks during
            // an elimination transition.
            const weightRatio = maxWeight > 0 ? segment.weight / maxWeight : 0;
            const radius = MIN_CIRCLE_RADIUS + weightRatio * radiusRange;

            // ---- filled disc ------------------------------------------
            ctx.save();
            ctx.globalAlpha = presence;
            ctx.beginPath();
            ctx.arc(cell.cx, cell.cy, radius, 0, Math.PI * 2);
            ctx.fillStyle = segment.lot.color || '#888888';
            ctx.fill();
            ctx.restore();

            // ---- outline / highlight ----------------------------------
            const intensity = intensities[i];
            const game = this.isGameHighlighted(segment.lot.id);

            ctx.save();
            ctx.globalAlpha = presence;
            ctx.beginPath();
            ctx.arc(cell.cx, cell.cy, radius, 0, Math.PI * 2);

            if (game) {
                ctx.strokeStyle = HIGHLIGHT_COLOR;
                ctx.lineWidth = GAME_HIGHLIGHT_STROKE_WIDTH;
                ctx.shadowColor = HIGHLIGHT_COLOR;
                ctx.shadowBlur = GAME_HIGHLIGHT_GLOW_BLUR * this.highlight.pulse;
            } else if (intensity > 0.01) {
                ctx.strokeStyle = HIGHLIGHT_COLOR;
                ctx.lineWidth = HIGHLIGHT_STROKE_WIDTH;
                ctx.shadowColor = HIGHLIGHT_COLOR;
                ctx.shadowBlur = HIGHLIGHT_GLOW_BLUR * intensity;
                ctx.globalAlpha = presence * intensity;
            } else {
                ctx.strokeStyle = BASE_STROKE_COLOR;
                ctx.lineWidth = BASE_STROKE_WIDTH;
            }
            ctx.stroke();
            ctx.restore();

            if (radius >= LABEL_MIN_RADIUS && presence > 0.05) {
                this.drawLabel(segment.lot.name, cell.cx, cell.cy, radius, presence);
            }
        }
    }

    computeSpinTarget(rolledLotId: string, durationMs: number): number {
        // Uses the stable partition; at spin time it equals the drawing one.
        return RouletteEngine.computeFinalCountingPosition(
            this.timingSegments,
            rolledLotId,
            this.animationValue,
            durationMs
        );
    }

    getCursorLotId(animationValue: number): string | null {
        const segments = this.timingSegments;
        const n = segments.length;
        if (n === 0 || this.timingPrefix.length < n + 1) return null;

        const frac = this.normalizePosition(animationValue);
        for (let i = 0; i < n; i++) {
            if (frac < this.timingPrefix[i + 1]) return segments[i].lot.id;
        }
        return segments[n - 1].lot.id;
    }

    // ------------------------------------------------------------------
    // Timing partition (stable / presence-independent)
    // ------------------------------------------------------------------

    private rebuildTimingPrefix(): void {
        this.timingPrefix = [0];
        for (const s of this.timingSegments) {
            this.timingPrefix.push(this.timingPrefix[this.timingPrefix.length - 1] + s.weight);
        }
    }

    private maxSegmentWeight(): number {
        let max = 0;
        for (const s of this.segments) if (s.weight > max) max = s.weight;
        return max;
    }

    // ------------------------------------------------------------------
    // Grid layout (cached; rebuilt only when the id set or size changes)
    // ------------------------------------------------------------------

    private ensureCells(): void {
        const n = this.segments.length;
        if (n === 0) {
            this.cells = [];
            this.cellSignature = '';
            this.effectiveMaxRadius = 0;
            return;
        }

        const { width, height } = this.getLogicalSize();
        const signature = `${Math.round(width)}x${Math.round(height)}|${this.segments.map(s => s.lot.id).join(',')}`;
        if (signature === this.cellSignature && this.cells.length === n) return;

        this.cellSignature = signature;
        this.rebuildCells(n, width, height);
    }

    /**
     * Deterministic grid cells for the current lot set and canvas size.
     * The segment → cell mapping is a deterministic permutation and each
     * circle's centre is nudged within its cell by a deterministic jitter.
     * Both come from a single LCG seeded from the lot-id set, so an unchanged
     * set reproduces the exact layout (Survival eliminations do not reshuffle
     * the surviving circles).
     */
    private rebuildCells(n: number, width: number, height: number): void {
        this.cells = [];

        const aspect = width / height;
        const cols = Math.max(1, Math.ceil(Math.sqrt(n * aspect)));
        const rows = Math.ceil(n / cols);

        const cellWidth = width / cols;
        const cellHeight = height / rows;
        const cellHalf = Math.min(cellWidth, cellHeight) / 2;
        this.effectiveMaxRadius = Math.min(MAX_CIRCLE_RADIUS, cellHalf * CELL_FILL_RATIO);

        const maxWeight = this.maxSegmentWeight();
        const safeMaxWeight = maxWeight > 0 ? maxWeight : 1;
        const radiusRange = Math.max(0, this.effectiveMaxRadius - MIN_CIRCLE_RADIUS);

        const seed = this.hashIds(this.segments.map(s => s.lot.id));
        const rand = this.makeLcg(seed);
        const cellOfSegment = this.buildCellPermutation(n, rand);

        for (let i = 0; i < n; i++) {
            const cell = cellOfSegment[i];
            const col = cell % cols;
            const row = Math.floor(cell / cols);

            const itemsInRow = row === rows - 1 ? n - row * cols : cols;
            const rowOffset = (cols - itemsInRow) / 2;

            // Jitter gaps use the radius at build time; since radii only shrink
            // afterwards (presence ≤ 1) the circle stays inside its cell.
            const buildRadius = MIN_CIRCLE_RADIUS + (this.segments[i].weight / safeMaxWeight) * radiusRange;
            const gapW = Math.max(0, cellWidth - 2 * buildRadius);
            const gapH = Math.max(0, cellHeight - 2 * buildRadius);

            const offsetX = (rand() - 0.5) * gapW;
            const offsetY = (rand() - 0.5) * gapH;

            this.cells.push({
                lotId: this.segments[i].lot.id,
                cx: (col + rowOffset + 0.5) * cellWidth + offsetX,
                cy: (row + 0.5) * cellHeight + offsetY
            });
        }
    }

    private hashIds(ids: string[]): number {
        let seed = 2166136261;
        for (const s of ids) {
            for (let i = 0; i < s.length; i++) {
                seed = (seed ^ s.charCodeAt(i)) * 16777619 >>> 0;
            }
        }
        return seed >>> 0;
    }

    private makeLcg(seed: number): () => number {
        let state = seed >>> 0;
        return () => {
            state = (state * 1664525 + 1013904223) >>> 0;
            return state / 0xFFFFFFFF;
        };
    }

    private buildCellPermutation(n: number, rand: () => number): number[] {
        const perm = new Array<number>(n);
        for (let i = 0; i < n; i++) perm[i] = i;
        for (let i = n - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [perm[i], perm[j]] = [perm[j], perm[i]];
        }
        return perm;
    }

    // ------------------------------------------------------------------
    // Position → highlight (counting-rhyme mechanics)
    // ------------------------------------------------------------------

    private normalizePosition(position: number): number {
        return ((position % 1) + 1) % 1;
    }

    /**
     * Highlight intensity per circle for a fractional cycle position, using
     * the STABLE timing partition (raw weights) so it does not shift while the
     * drawing geometry animates. Exactly one circle is current; the transition
     * into it is smoothed over the first TRANSITION_FRACTION of its segment.
     */
    private computeIntensities(frac: number): number[] {
        const segments = this.timingSegments;
        const n = segments.length;
        const intensities = new Array<number>(n).fill(0);
        if (n === 0 || this.timingPrefix.length < n + 1) return intensities;

        let idx = n - 1;
        for (let i = 0; i < n; i++) {
            if (frac < this.timingPrefix[i + 1]) {
                idx = i;
                break;
            }
        }

        const start = this.timingPrefix[idx];
        const weight = segments[idx].weight;
        const local = weight > 0 ? (frac - start) / weight : 0;

        if (n === 1 || local >= TRANSITION_FRACTION) {
            intensities[idx] = 1;
            return intensities;
        }

        const t = local / TRANSITION_FRACTION;
        const prevIdx = (idx - 1 + n) % n;
        intensities[idx] = t;
        intensities[prevIdx] = 1 - t;
        return intensities;
    }

    // ------------------------------------------------------------------
    // Label helper
    // ------------------------------------------------------------------

    private drawLabel(name: string, cx: number, cy: number, radius: number, presence: number): void {
        const ctx = this.ctx;
        const maxWidth = radius * 1.6;

        let label = name;
        ctx.save();
        ctx.font = LABEL_FONT;
        if (ctx.measureText(label).width > maxWidth) {
            while (label.length > 1 && ctx.measureText(label + '…').width > maxWidth) {
                label = label.slice(0, -1);
            }
            label += '…';
        }
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = presence;
        ctx.fillStyle = '#ffffff';
        ctx.font = LABEL_FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = LABEL_SHADOW_COLOR;
        ctx.lineWidth = 3;
        ctx.strokeText(label, cx, cy);
        ctx.fillText(label, cx, cy);
        ctx.restore();
    }
}
