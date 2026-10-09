import type { RenderableParticipant } from './types.js';
import { RouletteEngine } from './rouletteEngine.js';
import { BaseRenderer } from './baseRenderer.js';
import { normalizeToFractions } from './utils.js';

/**
 * CountingRhymeRenderer
 * ---------------------
 * Each drawn lot is a circle. Two independent axes drive it:
 *  - the circle RADIUS comes from the participant's `yValue` (axis 2, scaled by
 *    `presence`) — the abstract presentation magnitude, NOT the probability;
 *  - the highlight "beat" / cursor / spin target come from the participant's
 *    `xValue` partition (axis 1, the roulette chance), which is why the
 *    dwell time per circle is proportional to its chance.
 *
 * Hover (`setHover`, lots-list interaction) draws an additive outer halo: it
 * changes no radius/timing/cursor and composes with the lot accent halo.
 *
 * Contract:
 *  - `animationValue` is measured in *cycles* (one unit = one full traversal of
 *    the circle ring). `beatPrefix` partitions [0,1) by the selection weights,
 *    so circle i owns [P_i, P_{i+1}) of a traversal.
 *  - the engine guarantees endValue ≡ targetMid (mod 1), so the final animated
 *    frame highlights the rolled lot.
 *
 * The cursor/highlight follows the ANIMATION POSITION, never the drawn set: it is
 * re-resolved only when the position moves. An elimination re-indexes the ring,
 * so re-resolving a frozen position would pass the cursor to the neighbour of the
 * lot that vanished; instead the cursor stays on that lot (which draws nothing
 * once it is gone).
 *
 * PERFORMANCE: the deterministic grid (cell permutation + jitter) depends only
 * on the drawn lot-id set and the canvas size, so it is cached and rebuilt only
 * when that signature changes — NOT on every transition frame. Radius is
 * computed per render from the current `yValue` (× `presence`); when axis 2 is
 * ABSENT (`yValue` undefined everywhere) every circle uses the MAXIMUM radius.
 *
 * NOTE: the segment → grid-cell mapping is a deterministic permutation (FNV-1a
 * seeded LCG); `Math.random()` is never called.
 */

const HIGHLIGHT_COLOR = 'gold';    // cursor / beat emphasis
const HIGHLIGHT_GLOW_BLUR = 24;
const HIGHLIGHT_STROKE_WIDTH = 4;

const BASE_STROKE_COLOR = 'rgba(255, 255, 255, 0.45)';
const BASE_STROKE_WIDTH = 2;

const MIN_CIRCLE_RADIUS = 14;
const MAX_CIRCLE_RADIUS = 250;

// Lot accents — additive outer halo in the accent colour, further out than the
// hover halo so the two rings never cover each other. The circle radius is
// never changed.
const ACCENT_GLOW_BLUR = 18;
const ACCENT_RING_OFFSET = 12;

// Hover (lots-list interaction) — additive outer halo, distinct from the lot accents
const HOVER_COLOR = '#7fd4ff';
const HOVER_STROKE_WIDTH = 3;
const HOVER_GLOW_BLUR = 18;
const HOVER_RING_OFFSET = 6;

const CELL_FILL_RATIO = 0.95;

/** Crossfade window as a fraction of the current beat segment. */
const TRANSITION_FRACTION = 0.2;

const LABEL_FONT = '16px sans-serif';
const LABEL_MIN_RADIUS = 22;
const LABEL_SHADOW_COLOR = 'rgba(0, 0, 0, 0.65)';

interface CircleCell {
    lotId: string;
    cx: number;
    cy: number;
}

export class CountingRhymeRenderer extends BaseRenderer {
    /** Drawn participants (visual geometry), rebuilt on view-state change. */
    private circles: RenderableParticipant[] = [];

    /** Cached grid cells, aligned by index with `circles`. */
    private cells: CircleCell[] = [];
    private lastCellIds: string[] = [];
    private lastWidth = 0;
    private lastHeight = 0;
    private effectiveMaxRadius = 0;

    /** Prefix sums of the selection-weight (beat) partition. */
    private beatPrefix: number[] = [];

    /**
     * Cursor memo: the lot the cursor sits on and the normalized position it was
     * resolved at. See `cursorFor` — the cursor follows the animation, not the
     * participant set.
     */
    private heldCursorLotId: string | null = null;
    private heldCursorFraction: number | null = null;

    protected override onViewStateChanged(): void {
        this.circles = this.drawableParticipants();
        this.rebuildBeat();
        this.ensureCells();
    }

    protected override onReset(): void {
        this.circles = [];
        this.cells = [];
        this.lastCellIds = [];
        this.lastWidth = 0;
        this.lastHeight = 0;
        this.effectiveMaxRadius = 0;
        this.beatPrefix = [];
        this.heldCursorLotId = null;
        this.heldCursorFraction = null;
    }

    render(): void {
        const ctx = this.ctx;
        const { width: canvasWidth, height: canvasHeight } = this.getLogicalSize();
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        const n = Math.min(this.cells.length, this.circles.length);
        if (n === 0) return;

        const magnitudes = this.magnitudes();
        let maxVisual = 0;
        for (let i = 0; i < n; i++) {
            const v = magnitudes[i] * this.circles[i].presence;
            if (v > maxVisual) maxVisual = v;
        }
        const frac = this.normalizePosition(this.animationValue);
        const intensities = this.computeIntensities(frac);

        for (let i = 0; i < n; i++) {
            const p = this.circles[i];
            const cell = this.cells[i];
            // `presence` still gates hover and the label's visibility (transient
            // UI channel); the circle's own drawing uses `presence × zValue`.
            const presence = p.presence;
            const opacity = this.opacityOf(p.lot.id);

            const radius = this.radiusFor(magnitudes[i], presence, maxVisual);

            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.beginPath();
            ctx.arc(cell.cx, cell.cy, radius, 0, Math.PI * 2);
            ctx.fillStyle = p.lot.color || '#888888';
            ctx.fill();
            ctx.restore();

            const intensity = intensities[i];

            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.beginPath();
            ctx.arc(cell.cx, cell.cy, radius, 0, Math.PI * 2);
            if (intensity > 0.01) {
                ctx.strokeStyle = HIGHLIGHT_COLOR;
                ctx.lineWidth = HIGHLIGHT_STROKE_WIDTH;
                ctx.shadowColor = HIGHLIGHT_COLOR;
                ctx.shadowBlur = HIGHLIGHT_GLOW_BLUR * intensity;
                ctx.globalAlpha = opacity * intensity;
            } else {
                ctx.strokeStyle = BASE_STROKE_COLOR;
                ctx.lineWidth = BASE_STROKE_WIDTH;
            }
            ctx.stroke();
            ctx.restore();

            // Lot accent: an outer halo in the accent colour. It leaves the
            // circle radius untouched and never replaces the cursor stroke.
            const accent = this.accentVisual(p.lot.id);
            if (accent && accent.alpha > 0) {
                ctx.save();
                ctx.globalAlpha = opacity * accent.alpha;
                ctx.beginPath();
                ctx.arc(cell.cx, cell.cy, radius + ACCENT_RING_OFFSET, 0, Math.PI * 2);
                ctx.strokeStyle = accent.color;
                ctx.lineWidth = accent.strokeWidth;
                ctx.shadowColor = accent.color;
                ctx.shadowBlur = ACCENT_GLOW_BLUR;
                ctx.stroke();
                ctx.restore();
            }

            // Hover adds an outer halo; it leaves the circle radius untouched and
            // composes with the accent halo and the cursor stroke.
            if (this.isHovered(p.lot.id)) {
                ctx.save();
                ctx.globalAlpha = presence;
                ctx.beginPath();
                ctx.arc(cell.cx, cell.cy, radius + HOVER_RING_OFFSET, 0, Math.PI * 2);
                ctx.strokeStyle = HOVER_COLOR;
                ctx.lineWidth = HOVER_STROKE_WIDTH;
                ctx.shadowColor = HOVER_COLOR;
                ctx.shadowBlur = HOVER_GLOW_BLUR;
                ctx.stroke();
                ctx.restore();
            }

            if (radius >= LABEL_MIN_RADIUS && presence > 0.05) {
                this.drawLabel(p.lot.name, cell.cx, cell.cy, radius, opacity);
            }
        }
    }

    computeSpinTarget(rolledLotId: string, durationMs: number): number {
        // A new spin re-targets the cursor: drop any held lot so the next
        // resolution happens over the current ring (see `cursorFor`).
        this.heldCursorFraction = null;

        const idx = this.circles.findIndex(p => p.lot.id === rolledLotId);
        if (idx < 0 || this.beatPrefix.length < idx + 2) return this.animationValue;

        const start = this.beatPrefix[idx];
        const weight = this.beatPrefix[idx + 1] - start;
        const targetMid = start + weight / 2;

        return RouletteEngine.computeFinalCountingPosition(
            targetMid,
            this.animationValue,
            durationMs
        );
    }

    getCursorLotId(animationValue: number): string | null {
        return this.cursorFor(this.normalizePosition(animationValue));
    }

    /**
     * The lot under the cursor at `frac`, resolved ONLY when the animation
     * position moves. The index table is rebuilt whenever a lot is eliminated, so
     * re-resolving a position that just stopped would hand the cursor to the
     * neighbour of the lot that vanished; holding the previous lot instead keeps
     * the cursor on the vanishing lot (it draws nothing once it is gone).
     */
    private cursorFor(frac: number): string | null {
        if (this.heldCursorFraction === null || this.heldCursorFraction !== frac) {
            this.heldCursorFraction = frac;
            this.heldCursorLotId = this.lotIdAt(frac);
        }
        return this.heldCursorLotId;
    }

    /** Index-based cursor resolution over the currently drawn ring. */
    private lotIdAt(frac: number): string | null {
        const n = this.circles.length;
        if (n === 0 || this.beatPrefix.length < n + 1) return null;

        for (let i = 0; i < n; i++) {
            if (frac < this.beatPrefix[i + 1]) return this.circles[i].lot.id;
        }
        return this.circles[n - 1].lot.id;
    }

    // ------------------------------------------------------------------
    // Magnitude -> radius (axis 2)
    // ------------------------------------------------------------------

    /**
     * Per-circle magnitude on axis 2 (`yValue`), aligned by index with
     * `circles`. A missing value counts as the MAXIMUM defined magnitude; when
     * NO circle carries one, the axis is absent and every magnitude is 0 (the
     * radius then defaults to the maximum — see `radiusFor`).
     */
    private magnitudes(): number[] {
        let maxDefined = 0;
        let anyDefined = false;
        for (const p of this.circles) {
            if (p.yValue === undefined) continue;
            anyDefined = true;
            if (p.yValue > maxDefined) maxDefined = p.yValue;
        }
        return this.circles.map(p => (anyDefined ? (p.yValue ?? maxDefined) : 0));
    }

    /**
     * Circle radius: axis 2 (`magnitude × presence`) scaled onto
     * `[MIN_CIRCLE_RADIUS, effectiveMaxRadius]`. When the axis is absent
     * (`maxVisual === 0`) — the degenerate "maximum" case — every circle uses
     * the full radius (the visualization's default for a missing magnitude).
     */
    private radiusFor(magnitude: number, presence: number, maxVisual: number): number {
        if (maxVisual <= 0) return this.effectiveMaxRadius;
        const range = Math.max(0, this.effectiveMaxRadius - MIN_CIRCLE_RADIUS);
        return MIN_CIRCLE_RADIUS + ((magnitude * presence) / maxVisual) * range;
    }

    // ------------------------------------------------------------------
    // Beat partition (axis 1: chance)
    // ------------------------------------------------------------------

    private rebuildBeat(): void {
        const n = this.circles.length;
        if (n === 0) {
            this.beatPrefix = [];
            return;
        }

        const weights = this.circles.map(p => (p.xValue > 0 ? p.xValue : 0));
        let fractions = normalizeToFractions(weights);
        if (fractions.every(f => f === 0)) {
            // No selection weights at all — fall back to a uniform beat so the
            // highlight still cycles deterministically.
            fractions = this.circles.map(() => 1 / n);
        }

        this.beatPrefix = [0];
        for (const f of fractions) {
            this.beatPrefix.push(this.beatPrefix[this.beatPrefix.length - 1] + f);
        }
    }

    private computeIntensities(frac: number): number[] {
        const n = this.circles.length;
        const intensities = new Array<number>(n).fill(0);
        if (n === 0 || this.beatPrefix.length < n + 1) return intensities;

        // Emphasis belongs to the HELD cursor (see `cursorFor`), not to a fresh
        // index lookup: a lot eliminated under a frozen position lights nothing
        // instead of passing its emphasis to the next lot.
        const fresh = this.heldCursorFraction !== frac;
        const cursorLotId = this.cursorFor(frac);
        const idx = cursorLotId === null ? -1 : this.circles.findIndex(p => p.lot.id === cursorLotId);
        if (idx < 0) return intensities;

        const start = this.beatPrefix[idx];
        const weight = this.beatPrefix[idx + 1] - start;
        const local = weight > 0 ? (frac - start) / weight : 0;

        // A HELD cursor (the position has not moved) keeps the FULL emphasis on
        // its lot: no crossfade into whatever beat the frozen position happens to
        // fall in once the ring has been re-indexed. `local < 0` means the held
        // lot falls outside this segment — same treatment.
        if (!fresh || n === 1 || local < 0 || local >= TRANSITION_FRACTION) {
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
    // Grid layout (cached; rebuilt only when the id set or size changes)
    // ------------------------------------------------------------------

    private ensureCells(): void {
        const n = this.circles.length;
        const { width, height } = this.getLogicalSize();
        const rw = Math.round(width);
        const rh = Math.round(height);

        const sameSet = this.lastCellIds.length === n
            && this.circles.every((p, i) => p.lot.id === this.lastCellIds[i]);

        if (n === 0) {
            this.cells = [];
            this.lastCellIds = [];
            this.lastWidth = rw;
            this.lastHeight = rh;
            this.effectiveMaxRadius = 0;
            return;
        }

        if (sameSet && rw === this.lastWidth && rh === this.lastHeight) return;

        this.lastWidth = rw;
        this.lastHeight = rh;
        this.lastCellIds = this.circles.map(p => p.lot.id);
        this.rebuildCells(n, width, height);
    }

    private rebuildCells(n: number, width: number, height: number): void {
        this.cells = [];

        const aspect = width / height;
        const cols = Math.max(1, Math.ceil(Math.sqrt(n * aspect)));
        const rows = Math.ceil(n / cols);

        const cellWidth = width / cols;
        const cellHeight = height / rows;
        const cellHalf = Math.min(cellWidth, cellHeight) / 2;
        this.effectiveMaxRadius = Math.min(MAX_CIRCLE_RADIUS, cellHalf * CELL_FILL_RATIO);

        const magnitudes = this.magnitudes();
        let maxVisual = 0;
        for (let i = 0; i < n; i++) {
            const v = magnitudes[i] * this.circles[i].presence;
            if (v > maxVisual) maxVisual = v;
        }
        const seed = this.hashIds(this.circles.map(p => p.lot.id));
        const rand = this.makeLcg(seed);
        const cellOfSegment = this.buildCellPermutation(n, rand);

        for (let i = 0; i < n; i++) {
            const cell = cellOfSegment[i];
            const col = cell % cols;
            const row = Math.floor(cell / cols);

            const itemsInRow = row === rows - 1 ? n - row * cols : cols;
            const rowOffset = (cols - itemsInRow) / 2;

            const buildRadius = this.radiusFor(magnitudes[i], this.circles[i].presence, maxVisual);
            const gapW = Math.max(0, cellWidth - 2 * buildRadius);
            const gapH = Math.max(0, cellHeight - 2 * buildRadius);

            const offsetX = (rand() - 0.5) * gapW;
            const offsetY = (rand() - 0.5) * gapH;

            this.cells.push({
                lotId: this.circles[i].lot.id,
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

    private normalizePosition(position: number): number {
        return ((position % 1) + 1) % 1;
    }

    private drawLabel(name: string, cx: number, cy: number, radius: number, alpha: number): void {
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
        ctx.globalAlpha = alpha;
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
