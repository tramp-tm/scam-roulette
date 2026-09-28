import { Lot, GameMode } from './types.js';
import type { Segment } from './rouletteEngine.js';
import { BaseRenderer } from './baseRenderer.js';
import { brightenColor, getSegmentWidth } from './utils.js';

// Segment band geometry
const BAND_HEIGHT = 160;
const BAND_HALF_HEIGHT = BAND_HEIGHT / 2;

// Outer frame
const FRAME_PADDING = 10;

// Labels
const LABEL_FONT = 'bold 14px Arial';
const LABEL_OFFSET_Y = -12;
const LABEL_MAX_CHARS = 15;
const LABEL_TRUNCATED_CHARS = 13;

// Highlight glow
const HIGHLIGHT_BRIGHTNESS = 40;
const HIGHLIGHT_SHADOW_COLOR = 'rgba(255, 215, 0, 0.8)';
const HIGHLIGHT_SHADOW_BLUR = 15;

/**
 * Strip (ribbon) visualization renderer.
 */
export class StripRenderer extends BaseRenderer {
    /** Cached output of getSegmentWidth() summed over one full cycle. */
    private totalCycleWidth = 0;

    constructor(canvas: HTMLCanvasElement) {
        super(canvas);
    }

    /**
     * Updates the segments to render and caches the total cycle width.
     */
    updateSegments(lots: Lot[], mode: GameMode): void {
        super.updateSegments(lots, mode);
        this.totalCycleWidth = this.segments.reduce(
            (sum, s) => sum + getSegmentWidth(s.weight),
            0
        );
    }

    /**
     * Renders the strip visualization with infinite scrolling effect.
     *
     * Uses modulo arithmetic to map large mathematical offsets to visual offsets,
     * then renders multiple buffer copies for a seamless infinite illusion.
     */
    public render(): void {
        const { width: canvasWidth, height: canvasHeight } = this.getLogicalSize();
        const centerY = canvasHeight / 2;

        // Clear canvas
        this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        if (this.segments.length === 0 || this.totalCycleWidth === 0) return;

        const visualScrollOffset = this.getVisualOffset(this.totalCycleWidth);
        const cyclesNeeded = this.getCyclesNeeded(canvasWidth, this.totalCycleWidth);

        this.ctx.save();
        this.ctx.translate(-visualScrollOffset, 0);
        for (let cycle = -1; cycle <= cyclesNeeded; cycle++) {
            this.renderOneCycle(cycle * this.totalCycleWidth, centerY);
        }
        this.ctx.restore();

        // Draw center marker at viewport center (independent of scroll)
        this.drawCenterMarker(canvasWidth / 2, canvasHeight);

        // Draw outer decorative frame around the band
        this.drawFrame(canvasWidth, centerY);
    }

    /**
     * Maps the mathematical scroll offset into [0, totalCycleWidth).
     */
    private getVisualOffset(totalCycleWidth: number): number {
        let offset = this.currentRotation % totalCycleWidth;
        if (offset < 0) offset += totalCycleWidth;
        return offset;
    }

    /**
     * Calculates how many cycle copies are needed to cover the viewport plus margins.
     */
    private getCyclesNeeded(canvasWidth: number, totalCycleWidth: number): number {
        const bufferMargin = canvasWidth; // Extra margin for smooth transitions
        const totalRenderWidth = canvasWidth + 2 * bufferMargin;
        return Math.ceil(totalRenderWidth / totalCycleWidth) + 1;
    }

    /**
     * Renders one complete cycle of the strip at a given horizontal position.
     */
    private renderOneCycle(xOffset: number, centerY: number): void {
        let currentX = xOffset;

        for (const segment of this.segments) {
            const segmentWidth = getSegmentWidth(segment.weight);
            const isHighlighted = segment.lot.id === this.highlightedLotId;
            const fillColor = isHighlighted
                ? brightenColor(segment.lot.color || '#888', HIGHLIGHT_BRIGHTNESS)
                : (segment.lot.color || '#888');

            this.ctx.save();
            if (isHighlighted) {
                this.ctx.shadowColor = HIGHLIGHT_SHADOW_COLOR;
                this.ctx.shadowBlur = HIGHLIGHT_SHADOW_BLUR;
            }

            // Draw segment rectangle
            this.ctx.fillStyle = fillColor;
            this.ctx.fillRect(currentX, centerY - BAND_HALF_HEIGHT, segmentWidth, BAND_HEIGHT);
            this.ctx.restore();

            this.drawSegmentLabel(segment, currentX + segmentWidth / 2, centerY);

            currentX += segmentWidth;
        }
    }

    /**
     * Draws the text label centered in a segment (rotated 90° counterclockwise).
     */
    private drawSegmentLabel(segment: Segment, textX: number, textY: number): void {
        this.ctx.save();
        this.ctx.translate(textX, textY);
        this.ctx.rotate(-Math.PI / 2);

        this.ctx.fillStyle = '#fff';
        this.ctx.font = LABEL_FONT;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Name (truncated if needed)
        const name = segment.lot.name;
        const displayName = name.length > LABEL_MAX_CHARS
            ? name.substring(0, LABEL_TRUNCATED_CHARS) + '..'
            : name;

        this.ctx.fillText(displayName, 0, LABEL_OFFSET_Y); // Offset from rotated origin
        this.ctx.restore();
    }

    /**
     * Draws the center marker for strip view (pointer position).
     */
    private drawCenterMarker(x: number, canvasHeight: number): void {
        this.ctx.save();

        // Vertical dashed line through viewport
        this.ctx.beginPath();
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, canvasHeight);
        this.ctx.strokeStyle = 'gold';
        this.ctx.lineWidth = 3;
        this.ctx.setLineDash([10, 5]);
        this.ctx.stroke();

        // Arrow at top pointing down
        this.ctx.beginPath();
        this.ctx.moveTo(x - 15, 20);
        this.ctx.lineTo(x + 15, 20);
        this.ctx.lineTo(x, 40);
        this.ctx.closePath();
        this.ctx.fillStyle = 'gold';
        this.ctx.fill();

        // Arrow at bottom pointing up
        this.ctx.beginPath();
        this.ctx.moveTo(x - 15, canvasHeight - 40);
        this.ctx.lineTo(x + 15, canvasHeight - 40);
        this.ctx.lineTo(x, canvasHeight - 20);
        this.ctx.closePath();
        this.ctx.fillStyle = 'gold';
        this.ctx.fill();

        this.ctx.restore();
    }

    /**
     * Draws the outer decorative frame around the strip band.
     * Mirrors the wheel's drawOuterRing in style: same padding
     * around the visible band and the same stroke colour/width.
     */
    private drawFrame(canvasWidth: number, centerY: number): void {
        const top = centerY - BAND_HALF_HEIGHT - FRAME_PADDING;
        const height = (BAND_HALF_HEIGHT + FRAME_PADDING) * 2;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(0, top, canvasWidth, height);
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.lineWidth = 4;
        this.ctx.stroke();
        this.ctx.restore();
    }

    /**
     * Resets the renderer state.
     */
    reset(): void {
        super.reset();
        this.totalCycleWidth = 0;
    }
}
