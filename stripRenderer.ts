import type { Segment } from './rouletteEngine.js';
import { RouletteEngine } from './rouletteEngine.js';
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
const GAME_HIGHLIGHT_BRIGHTNESS = 40;
const GAME_HIGHLIGHT_BOOST = 45;
const CURSOR_HIGHLIGHT_BRIGHTNESS = 18;
const HIGHLIGHT_SHADOW_COLOR = 'rgba(255, 215, 0, 0.8)';
const HIGHLIGHT_SHADOW_BLUR = 15;

/**
 * Strip (ribbon) visualization renderer.
 *
 * Spin math (target scroll offset + cursor resolution) is internal to this
 * visualization.
 */
export class StripRenderer extends BaseRenderer {
    /** Cached sum of getSegmentWidth() over one full cycle (drawing geometry). */
    private totalCycleWidth = 0;

    /** Same sum over the stable timing partition (for cursor resolution). */
    private timingCycleWidth = 0;

    protected override onViewStateChanged(): void {
        this.totalCycleWidth = this.segments.reduce(
            (sum, s) => sum + getSegmentWidth(s.weight),
            0
        );
        this.timingCycleWidth = this.timingSegments.reduce(
            (sum, s) => sum + getSegmentWidth(s.weight),
            0
        );
    }

    protected override onReset(): void {
        this.totalCycleWidth = 0;
        this.timingCycleWidth = 0;
    }

    render(): void {
        const { width: canvasWidth, height: canvasHeight } = this.getLogicalSize();
        const centerY = canvasHeight / 2;

        this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        if (this.segments.length === 0 || this.totalCycleWidth === 0) return;

        const visualScrollOffset = this.getVisualOffset();
        const cyclesNeeded = this.getCyclesNeeded(canvasWidth);

        this.ctx.save();
        this.ctx.translate(-visualScrollOffset, 0);
        for (let cycle = -1; cycle <= cyclesNeeded; cycle++) {
            this.renderOneCycle(cycle * this.totalCycleWidth, centerY);
        }
        this.ctx.restore();

        this.drawCenterMarker(canvasWidth / 2, canvasHeight);
        this.drawFrame(canvasWidth, centerY);
    }

    computeSpinTarget(rolledLotId: string, durationMs: number): number {
        return RouletteEngine.computeFinalScrollOffset(
            this.segments,
            rolledLotId,
            this.animationValue,
            durationMs,
            this.getLogicalSize().width
        );
    }

    getCursorLotId(animationValue: number): string | null {
        // Resolve against the STABLE (presence-independent) partition so the
        // cursor does not hop while the drawing geometry animates.
        const segments = this.timingSegments;
        if (segments.length === 0 || this.timingCycleWidth <= 0) return null;

        // Segment i is drawn at [cum - offset, cum - offset + w); the centre
        // marker sits at centerX. It is under the cursor when
        // cum ≤ centerX + offset < cum + w.
        const centerX = this.getLogicalSize().width / 2;
        let local = (animationValue + centerX) % this.timingCycleWidth;
        if (local < 0) local += this.timingCycleWidth;

        let cumulative = 0;
        for (const segment of segments) {
            const width = getSegmentWidth(segment.weight);
            if (local >= cumulative && local < cumulative + width) return segment.lot.id;
            cumulative += width;
        }
        return segments[segments.length - 1].lot.id;
    }

    private getVisualOffset(): number {
        let offset = this.animationValue % this.totalCycleWidth;
        if (offset < 0) offset += this.totalCycleWidth;
        return offset;
    }

    private getCyclesNeeded(canvasWidth: number): number {
        const bufferMargin = canvasWidth;
        const totalRenderWidth = canvasWidth + 2 * bufferMargin;
        return Math.ceil(totalRenderWidth / this.totalCycleWidth) + 1;
    }

    private renderOneCycle(xOffset: number, centerY: number): void {
        let currentX = xOffset;

        for (const segment of this.segments) {
            const segmentWidth = getSegmentWidth(segment.weight);
            const presence = this.presenceOf(segment.lot.id);
            const game = this.isGameHighlighted(segment.lot.id);
            const cursor = this.isCursor(segment.lot.id);

            const baseColor = segment.lot.color || '#888';
            const fillColor = game
                ? brightenColor(baseColor, GAME_HIGHLIGHT_BRIGHTNESS + GAME_HIGHLIGHT_BOOST * this.highlight.pulse)
                : cursor
                    ? brightenColor(baseColor, CURSOR_HIGHLIGHT_BRIGHTNESS)
                    : baseColor;

            this.ctx.save();
            this.ctx.globalAlpha = presence;
            if (game) {
                this.ctx.shadowColor = HIGHLIGHT_SHADOW_COLOR;
                this.ctx.shadowBlur = HIGHLIGHT_SHADOW_BLUR * this.highlight.pulse;
            }

            this.ctx.fillStyle = fillColor;
            this.ctx.fillRect(currentX, centerY - BAND_HALF_HEIGHT, segmentWidth, BAND_HEIGHT);
            this.ctx.restore();

            if (presence > 0.01) {
                this.drawSegmentLabel(segment, currentX + segmentWidth / 2, centerY, presence);
            }

            currentX += segmentWidth;
        }
    }

    private drawSegmentLabel(segment: Segment, textX: number, textY: number, presence: number): void {
        this.ctx.save();
        this.ctx.globalAlpha = presence;
        this.ctx.translate(textX, textY);
        this.ctx.rotate(-Math.PI / 2);

        this.ctx.fillStyle = '#fff';
        this.ctx.font = LABEL_FONT;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        const name = segment.lot.name;
        const displayName = name.length > LABEL_MAX_CHARS
            ? name.substring(0, LABEL_TRUNCATED_CHARS) + '..'
            : name;

        this.ctx.fillText(displayName, 0, LABEL_OFFSET_Y);
        this.ctx.restore();
    }

    private drawCenterMarker(x: number, canvasHeight: number): void {
        this.ctx.save();

        this.ctx.beginPath();
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, canvasHeight);
        this.ctx.strokeStyle = 'gold';
        this.ctx.lineWidth = 3;
        this.ctx.setLineDash([10, 5]);
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.moveTo(x - 15, 20);
        this.ctx.lineTo(x + 15, 20);
        this.ctx.lineTo(x, 40);
        this.ctx.closePath();
        this.ctx.fillStyle = 'gold';
        this.ctx.fill();

        this.ctx.beginPath();
        this.ctx.moveTo(x - 15, canvasHeight - 40);
        this.ctx.lineTo(x + 15, canvasHeight - 40);
        this.ctx.lineTo(x, canvasHeight - 20);
        this.ctx.closePath();
        this.ctx.fillStyle = 'gold';
        this.ctx.fill();

        this.ctx.restore();
    }

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
}
