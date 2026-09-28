import { Lot, GameMode, IRenderer } from './types.js';
import { RouletteEngine } from './rouletteEngine.js';
import type { Segment } from './rouletteEngine.js';

/**
 * Shared base for all canvas renderers.
 * Owns state and lifecycle shared by every concrete renderer.
 */
export abstract class BaseRenderer implements IRenderer {
    protected readonly canvas: HTMLCanvasElement;
    protected readonly ctx: CanvasRenderingContext2D;

    protected segments: Segment[] = [];
    protected currentRotation = 0;
    protected highlightedLotId: string | null = null;

    protected static readonly FALLBACK_WIDTH = 600;
    protected static readonly FALLBACK_HEIGHT = 500;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.setupHighDPI();
    }

    /**
     * Configures the canvas for high-DPI displays, applying the shared
     * logical-size fallback when layout has not yet run.
     */
    protected setupHighDPI(): void {
        const dpr = window.devicePixelRatio || 1;
        const { width, height } = this.getLogicalSize();

        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;

        this.ctx.scale(dpr, dpr);
    }

    /**
     * Updates the segments to render.
     */
    updateSegments(lots: Lot[], mode: GameMode): void {
        this.segments = RouletteEngine.calculateSegments(lots, mode);
    }

    /**
     * Sets the current rotation value (for animation).
     */
    setRotation(value: number): void {
        this.currentRotation = value;
    }

    /**
     * Gets the current rotation value.
     */
    getCurrentRotation(): number {
        return this.currentRotation;
    }

    /**
     * Sets the highlighted lot ID.
     */
    setHighlightedLot(id: string | null): void {
        this.highlightedLotId = id;
    }

    /**
     * Resets the renderer state.
     */
    reset(): void {
        this.currentRotation = 0;
        this.highlightedLotId = null;
        this.segments = [];
    }

    /**
     * Logical (CSS-pixel) size of the renderer's canvas, with the shared
     * fallbacks applied when layout has not yet run (rect dimension = 0).
     * Single source of the fallback used by setupHighDPI() and every
     * concrete render().
     */
    protected getLogicalSize(): { width: number; height: number } {
        const rect = this.canvas.getBoundingClientRect();
        return {
            width: rect.width || BaseRenderer.FALLBACK_WIDTH,
            height: rect.height || BaseRenderer.FALLBACK_HEIGHT
        };
    }

    abstract render(): void;
}
