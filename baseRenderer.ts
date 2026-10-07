import type {
    AccentKind,
    AccentState,
    GameViewState,
    IRenderer,
    RenderableParticipant,
    VisualizationTuning
} from './types.js';

/**
 * Canvas visual for each accent kind — the single source of truth for the
 * renderers (colour + stroke width). Fixed hex on purpose: the canvas palette
 * is independent of the CSS theme variables, exactly like the other canvas
 * colours. `alpha` is NOT here: it comes from the transition `pulse` (see
 * `BaseRenderer.accentVisual`).
 */
export const ACCENT_VISUAL: Record<AccentKind, { color: string; strokeWidth: number }> = {
    accent:  { color: '#f39c12', strokeWidth: 4 },
    good:    { color: '#2ecc71', strokeWidth: 4 },
    bad:     { color: '#e74c3c', strokeWidth: 4 },
    info:    { color: '#3498db', strokeWidth: 4 },
    warning: { color: '#f1c40f', strokeWidth: 4 }
};

/**
 * Shared base for all canvas renderers (visualizations).
 *
 * Owns the presentation model + highlight state and the shared lifecycle, and
 * provides the drawing helpers. It does NOT build any geometry: each concrete
 * renderer derives its OWN geometry (wheel angles, strip bands, counting-rhyme
 * cells) from the presentation model in `onViewStateChanged()`. There is no
 * shared `Segment`/angle type crossing visualizations.
 *
 * Presentation facts the renderers work from (all per participant):
 *  - `xValue`  — axis 1, the roulette CHANCE (exactly the value the roll used);
 *                drives the roulette geometry (sector/band width, counting-rhyme
 *                beat/dwell/target), never the drawing size;
 *  - `yValue`  — axis 2, the mode's abstract MAGNITUDE → size/scale; may be
 *                absent (the renderer then uses its own default);
 *  - `zValue`  — axis 3, OPACITY in [0,1]; absent = 1;
 *  - `presence`— [0,1] visibility multiplier for the elimination animation;
 *                alpha uses `presence × zValue`, geometry uses `presence`;
 *  - `modeData`— opaque mode payload the renderer may display.
 *
 * It also carries the transient hover highlight (`hoverLotId`, a stable lot
 * id fed through `setHover`), kept separate from the lot accents so both can be
 * composed when they target the same Lot Representation.
 */
export abstract class BaseRenderer implements IRenderer {
    protected readonly canvas: HTMLCanvasElement;
    protected readonly ctx: CanvasRenderingContext2D;

    protected participants: RenderableParticipant[] = [];

    /** Lot accents to draw (lotId → kind), already filtered to this surface. */
    protected accents: ReadonlyMap<string, AccentKind> = new Map();

    /** Emphasis ramp for the accents during an outcome transition (1 = stable). */
    protected pulse = 1;

    /**
     * Presentation tuning ("real chances" / "real magnitudes"). Each renderer
     * decides how to apply it — the counting rhyme ignores both flags. Changing
     * it only takes effect on the next `setViewState`, which rebuilds geometry.
     */
    protected tuning: VisualizationTuning = { realChances: false, realMagnitudes: false };

    protected animationValue = 0;

    /** Transient hover highlight (lots-list interaction); see `setHover`. */
    protected hoverLotId: string | null = null;

    private presenceByLotId = new Map<string, number>();
    /** Opacity axis (axis 3) per lot, resolved to `1` when the mode omits it. */
    private zValueByLotId = new Map<string, number>();

    /** Per-frame memo for cursor resolution (avoids O(n) scans per element). */
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

    /** Adopts the tuning; the geometry follows on the next `setViewState`. */
    setTuning(tuning: VisualizationTuning): void {
        this.tuning = tuning;
    }

    setViewState(view: GameViewState, accents: AccentState): void {
        this.participants = view.participants;
        this.accents = accents.accents;
        this.pulse = accents.pulse;

        this.presenceByLotId.clear();
        this.zValueByLotId.clear();
        for (const p of this.participants) {
            this.presenceByLotId.set(p.lot.id, p.presence);
            this.zValueByLotId.set(p.lot.id, p.zValue ?? 1);
        }

        this.onViewStateChanged();
    }

    /**
     * Stores the transient hover highlight. Identity is the stable lot id; the
     * concrete renderer decides the visual treatment and composes it with the
     * lot accents. Stored only — the driver asks for a redraw.
     */
    setHover(lotId: string | null): void {
        this.hoverLotId = lotId;
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
        this.presenceByLotId.clear();
        this.zValueByLotId.clear();
        this.accents = new Map();
        this.pulse = 1;
        this.animationValue = 0;
        this.hoverLotId = null;
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

    /** Called after the presentation model changed; rebuild geometry here. */
    protected onViewStateChanged(): void {}

    /** Called after `reset()` cleared the shared state. */
    protected onReset(): void {}

    // ------------------------------------------------------------------
    // Helpers for concrete renderers
    // ------------------------------------------------------------------

    /**
     * Participants that should be drawn: visible (`presence > 0`). A lot
     * WITHOUT a magnitude on axis 2 is still drawn — what an absent axis means
     * is the visualization's own decision (its default is the maximum size), so
     * the base class filters by visibility only. The renderer maps axis 1
     * (`xValue`) to its roulette geometry, axis 2 (`yValue`) to size and
     * `presence × zValue` to alpha.
     */
    protected drawableParticipants(): RenderableParticipant[] {
        return this.participants.filter(p => p.presence > 0);
    }

    /** Visual presence in [0, 1] for a lot (1 when unknown). */
    protected presenceOf(lotId: string): number {
        const value = this.presenceByLotId.get(lotId);
        return value === undefined ? 1 : value;
    }

    /** Opacity axis (axis 3) in [0, 1] for a lot (1 when absent/unknown). */
    protected zValueOf(lotId: string): number {
        const value = this.zValueByLotId.get(lotId);
        return value === undefined ? 1 : value;
    }

    /**
     * Alpha for the lot's OWN drawing (fill, stroke, label, accent overlay):
     * `presence × zValue`. Hover is a separate transient UI channel and does
     * NOT use this.
     */
    protected opacityOf(lotId: string): number {
        return this.presenceOf(lotId) * this.zValueOf(lotId);
    }

    /**
     * Accent kind assigned to this lot, or `null` when it has none. This is the
     * only emphasis a renderer reads from the game; the concrete renderer picks
     * the visual treatment.
     */
    protected accentOf(lotId: string): AccentKind | null {
        return this.accents.get(lotId) ?? null;
    }

    /**
     * Canvas visual for this lot's accent, or `null` when it has none.
     * `alpha` folds in the transition `pulse` (stable state = 1), so a renderer
     * draws the accent uniformly: stroke + glow, both scaled by `alpha`.
     */
    protected accentVisual(lotId: string): { color: string; strokeWidth: number; alpha: number } | null {
        const kind = this.accentOf(lotId);
        if (!kind) return null;
        const visual = ACCENT_VISUAL[kind];
        return {
            color: visual.color,
            strokeWidth: visual.strokeWidth,
            alpha: Math.max(0, Math.min(1, this.pulse))
        };
    }

    /** Whether this lot is under the transient hover highlight (lots list). */
    protected isHovered(lotId: string): boolean {
        return this.hoverLotId === lotId;
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
