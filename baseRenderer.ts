import type {
    GameViewState,
    HighlightState,
    IRenderer,
    RenderableParticipant,
    WeightedLot
} from './types.js';
import { RouletteEngine } from './rouletteEngine.js';
import type { Segment } from './rouletteEngine.js';

/**
 * Shared base for all canvas renderers (visualizations).
 *
 * Owns the presentation + highlight state and the shared lifecycle. Concrete
 * renderers implement `render()` and `computeSpinTarget()` and may hook
 * `onViewStateChanged()` / `onReset()` to rebuild their cached geometry.
 *
 * Two segment partitions are kept in parallel, in the same participant order:
 *
 *  - `segments` — the DRAWING geometry. Built from `weight * presence`, so a
 *    participant whose `presence` animates 1 → 0 shrinks its sector while the
 *    others grow (normalization) — the outcome transition falls out of view
 *    interpolation.
 *  - `timingSegments` — a STABLE partition built from the raw `weight`
 *    (presence-independent). Used for cursor / timing resolution, so the
 *    cursor does not hop while the drawing geometry is animating during a
 *    transition.
 *
 * Only the base class builds geometry; concrete renderers never compute game
 * weights themselves.
 */
export abstract class BaseRenderer implements IRenderer {
    protected readonly canvas: HTMLCanvasElement;
    protected readonly ctx: CanvasRenderingContext2D;

    protected participants: RenderableParticipant[] = [];
    protected segments: Segment[] = [];
    protected timingSegments: Segment[] = [];
    protected highlight: HighlightState = { game: new Set(), pulse: 1 };
    protected animationValue = 0;

    private presenceByLotId = new Map<string, number>();

    /** Per-frame memo for cursor resolution (avoids O(n) scans per segment). */
    private cursorForValue: number | null = null;
    private cursorLotId: string | null = null;

    protected static readonly FALLBACK_WIDTH = 600;
    protected static readonly FALLBACK_HEIGHT = 500;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.setupHighDPI();
    }

    // ------------------------------------------------------------------
    // Presentation / highlight
    // ------------------------------------------------------------------

    setViewState(view: GameViewState, highlight: HighlightState): void {
        this.participants = view.participants;
        this.highlight = highlight;

        this.presenceByLotId.clear();
        const drawingEntries: WeightedLot[] = [];
        const timingEntries: WeightedLot[] = [];

        for (const p of this.participants) {
            this.presenceByLotId.set(p.lot.id, p.presence);
            if (p.presence <= 0) continue;

            if (p.weight > 0) {
                timingEntries.push({ lot: p.lot, weight: p.weight });
            }
            const effectiveWeight = p.weight * p.presence;
            if (effectiveWeight > 0) {
                drawingEntries.push({ lot: p.lot, weight: effectiveWeight });
            }
        }

        this.segments = RouletteEngine.calculateSegments(drawingEntries);
        this.timingSegments = RouletteEngine.calculateSegments(timingEntries);
        this.onViewStateChanged();
    }

    // ------------------------------------------------------------------
    // Lifecycle / animation scalar
    // ------------------------------------------------------------------

    getAnimationValue(): number {
        return this.animationValue;
    }

    setAnimationValue(value: number): void {
        this.animationValue = value;
    }

    reset(): void {
        this.participants = [];
        this.segments = [];
        this.timingSegments = [];
        this.presenceByLotId.clear();
        this.highlight = { game: new Set(), pulse: 1 };
        this.animationValue = 0;
        this.cursorForValue = null;
        this.cursorLotId = null;
        this.onReset();
    }

    /** Lot currently under the visual cursor, or null (default: no cursor). */
    getCursorLotId(_animationValue: number): string | null {
        return null;
    }

    // ------------------------------------------------------------------
    // Hooks for concrete renderers
    // ------------------------------------------------------------------

    /** Called after geometry was recomputed; rebuild cached layout here. */
    protected onViewStateChanged(): void {}

    /** Called after `reset()` cleared the shared state. */
    protected onReset(): void {}

    // ------------------------------------------------------------------
    // Shared helpers for drawing
    // ------------------------------------------------------------------

    /** Visual presence in [0, 1] for a lot (1 when unknown). */
    protected presenceOf(lotId: string): number {
        const value = this.presenceByLotId.get(lotId);
        return value === undefined ? 1 : value;
    }

    /** Whether the game highlight covers this lot (winners/eliminated). */
    protected isGameHighlighted(lotId: string): boolean {
        return this.highlight.game.has(lotId);
    }

    /**
     * Whether this lot is under the visualization's cursor at the current
     * animation value. The cursor is resolved by the visualization itself
     * (`getCursorLotId`) once per frame and memoized here — it never comes in
     * from the highlight state.
     */
    protected isCursor(lotId: string): boolean {
        if (this.cursorForValue !== this.animationValue) {
            this.cursorForValue = this.animationValue;
            this.cursorLotId = this.getCursorLotId(this.animationValue);
        }
        return this.cursorLotId === lotId;
    }

    /** Logical (CSS-pixel) canvas size, with the shared fallback. */
    protected getLogicalSize(): { width: number; height: number } {
        const rect = this.canvas.getBoundingClientRect();
        return {
            width: rect.width || BaseRenderer.FALLBACK_WIDTH,
            height: rect.height || BaseRenderer.FALLBACK_HEIGHT
        };
    }

    /** Configures the canvas for high-DPI displays. */
    protected setupHighDPI(): void {
        const dpr = window.devicePixelRatio || 1;
        const { width, height } = this.getLogicalSize();

        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;

        this.ctx.scale(dpr, dpr);
    }

    abstract render(): void;
    abstract computeSpinTarget(rolledLotId: string, durationMs: number): number;
}
