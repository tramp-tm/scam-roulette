import type { RenderableParticipant } from './types.js';
import { RouletteEngine } from './rouletteEngine.js';
import { BaseRenderer } from './baseRenderer.js';
import { normalizeToFractions } from './utils.js';

/**
 * CountingRhymeRenderer
 * ---------------------
 * Each drawn lot is a circle. Two independent quantities drive it:
 *  - the circle RADIUS comes from the participant's `visualValue` (scaled by
 *    `presence`) — the abstract presentation magnitude, NOT the probability;
 *  - the highlight "beat" / cursor / spin target come from the participant's
 *    `selectionWeight` partition (the roulette probability), which is why the
 *    dwell time per circle is proportional to its chance.
 *
 * Contract:
 *  - `animationValue` is measured in *cycles* (one unit = one full traversal of
 *    the circle ring). `beatPrefix` partitions [0,1) by the selection weights,
 *    so circle i owns [P_i, P_{i+1}) of a traversal.
 *  - the engine guarantees endValue ≡ targetMid (mod 1), so the final animated
 *    frame highlights the rolled lot.
 *
 * PERFORMANCE: the deterministic grid (cell permutation + jitter) depends only
 * on the drawn lot-id set and the canvas size, so it is cached and rebuilt only
 * when that signature changes — NOT on every transition frame. Radius is
 * computed per render from the current `visualValue * presence`.
 *
 * NOTE: the segment → grid-cell mapping is a deterministic permutation (FNV-1a
 * seeded LCG); `Math.random()` is never called.
 */

const HIGHLIGHT_COLOR = 'gold';
const HIGHLIGHT_GLOW_BLUR = 24;
const HIGHLIGHT_STROKE_WIDTH = 4;

const BASE_STROKE_COLOR = 'rgba(255, 255, 255, 0.45)';
const BASE_STROKE_WIDTH = 2;

const GAME_HIGHLIGHT_STROKE_WIDTH = 6;
const GAME_HIGHLIGHT_GLOW_BLUR = 30;

const MIN_CIRCLE_RADIUS = 14;
const MAX_CIRCLE_RADIUS = 250;

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
    }

    render(): void {
        const ctx = this.ctx;
        const { width: canvasWidth, height: canvasHeight } = this.getLogicalSize();
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        const n = Math.min(this.cells.length, this.circles.length);
        if (n === 0) return;

        let maxVisual = 0;
        for (const p of this.circles) {
            const v = p.visualValue * p.presence;
            if (v > maxVisual) maxVisual = v;
        }
        const radiusRange = Math.max(0, this.effectiveMaxRadius - MIN_CIRCLE_RADIUS);
        const frac = this.normalizePosition(this.animationValue);
        const intensities = this.computeIntensities(frac);

        for (let i = 0; i < n; i++) {
            const p = this.circles[i];
            const cell = this.cells[i];
            const presence = p.presence;

            const visuals = p.visualValue * p.presence;
            const radius = MIN_CIRCLE_RADIUS + (maxVisual > 0 ? visuals / maxVisual : 0) * radiusRange;

            ctx.save();
            ctx.globalAlpha = presence;
            ctx.beginPath();
            ctx.arc(cell.cx, cell.cy, radius, 0, Math.PI * 2);
            ctx.fillStyle = p.lot.color || '#888888';
            ctx.fill();
            ctx.restore();

            const intensity = intensities[i];
            const game = this.isGameHighlighted(p.lot.id);

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
                this.drawLabel(p.lot.name, cell.cx, cell.cy, radius, presence);
            }
        }
    }

    computeSpinTarget(rolledLotId: string, durationMs: number): number {
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
        const n = this.circles.length;
        if (n === 0 || this.beatPrefix.length < n + 1) return null;

        const frac = this.normalizePosition(animationValue);
        for (let i = 0; i < n; i++) {
            if (frac < this.beatPrefix[i + 1]) return this.circles[i].lot.id;
        }
        return this.circles[n - 1].lot.id;
    }

    // ------------------------------------------------------------------
    // Beat partition (selection weights)
    // ------------------------------------------------------------------

    private rebuildBeat(): void {
        const n = this.circles.length;
        if (n === 0) {
            this.beatPrefix = [];
            return;
        }

        const weights = this.circles.map(p => (p.selectionWeight > 0 ? p.selectionWeight : 0));
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

        let idx = n - 1;
        for (let i = 0; i < n; i++) {
            if (frac < this.beatPrefix[i + 1]) {
                idx = i;
                break;
            }
        }

        const start = this.beatPrefix[idx];
        const weight = this.beatPrefix[idx + 1] - start;
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

        let maxVisual = 0;
        for (const p of this.circles) {
            const v = p.visualValue * p.presence;
            if (v > maxVisual) maxVisual = v;
        }
        const safeMax = maxVisual > 0 ? maxVisual : 1;
        const radiusRange = Math.max(0, this.effectiveMaxRadius - MIN_CIRCLE_RADIUS);

        const seed = this.hashIds(this.circles.map(p => p.lot.id));
        const rand = this.makeLcg(seed);
        const cellOfSegment = this.buildCellPermutation(n, rand);

        for (let i = 0; i < n; i++) {
            const cell = cellOfSegment[i];
            const col = cell % cols;
            const row = Math.floor(cell / cols);

            const itemsInRow = row === rows - 1 ? n - row * cols : cols;
            const rowOffset = (cols - itemsInRow) / 2;

            const buildRadius = MIN_CIRCLE_RADIUS
                + (this.circles[i].visualValue * this.circles[i].presence / safeMax) * radiusRange;
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
