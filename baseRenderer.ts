import type {
    GameViewState,
    HighlightState,
    IRenderer,
    RenderableParticipant
} from './types.js';

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
 *  - `visualValue`    — the magnitude a renderer turns into size/scale;
 *  - `selectionWeight`— the roulette probability; used only where a renderer
 *                       needs the selection partition (e.g. the counting-rhyme
 *                       dwell/target), never for drawing size;
 *  - `presence`       — [0,1] visibility multiplier for elimination animation;
 *  - `modeData`       — opaque mode payload the renderer may display.
 *
 * It also carries the transient hover highlight (`hoverLotId`, a stable lot
 * id fed through `setHover`), kept separate from the game highlight so both
 * can be composed when they target the same Lot Representation.
 */
export abstract class BaseRenderer implements IRenderer {
    protected readonly canvas: HTMLCanvasElement;
    protected readonly ctx: CanvasRenderingContext2D;

    protected participants: RenderableParticipant[] = [];
    protected highlight: HighlightState = { game: new Set(), pulse: 1 };
    protected animationValue = 0;

    /** Transient hover highlight (lots-list interaction); see `setHover`. */
    protected hoverLotId: string | null = null;

    private presenceByLotId = new Map<string, number>();

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

    setViewState(view: GameViewState, highlight: HighlightState): void {
        this.participants = view.participants;
        this.highlight = highlight;

        this.presenceByLotId.clear();
        for (const p of this.participants) {
            this.presenceByLotId.set(p.lot.id, p.presence);
        }

        this.onViewStateChanged();
    }

    /**
     * Stores the transient hover highlight. Identity is the stable lot id; the
     * concrete renderer decides the visual treatment and composes it with the
     * game highlight. Stored only — the driver asks for a redraw.
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
        this.highlight = { game: new Set(), pulse: 1 };
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
     * Participants that should be drawn: visible (`presence > 0`) and with a
     * positive visual magnitude. The renderer maps `visualValue * presence`
     * to its own geometry.
     */
    protected drawableParticipants(): RenderableParticipant[] {
        return this.participants.filter(p => p.presence > 0 && p.visualValue > 0);
    }

    /**
     * Participants that take part in the roulette/cursor partition
     * (`selectionWeight > 0`), independent of `visualValue`.
     */
    protected selectableParticipants(): RenderableParticipant[] {
        return this.participants.filter(p => p.presence > 0 && p.selectionWeight > 0);
    }

    /** Visual presence in [0, 1] for a lot (1 when unknown). */
    protected presenceOf(lotId: string): number {
        const value = this.presenceByLotId.get(lotId);
        return value === undefined ? 1 : value;
    }

    /** Whether the game highlight covers this lot (winners/eliminated). */
    protected isGameHighlighted(lotId: string): boolean {
        return this.highlight.game.has(lotId);
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
