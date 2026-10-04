import type { Segment } from './rouletteEngine.js';
import { RouletteEngine } from './rouletteEngine.js';
import { BaseRenderer } from './baseRenderer.js';
import { brightenColor } from './utils.js';

// Wheel geometry
const WHEEL_MARGIN = 30;

// Segment strokes
const SEGMENT_STROKE = '#fff';
const SEGMENT_STROKE_WIDTH = 2;

// Highlight
const GAME_HIGHLIGHT_BRIGHTNESS = 30;
const GAME_HIGHLIGHT_BOOST = 45;
const CURSOR_HIGHLIGHT_BRIGHTNESS = 14;

// Labels
const LABEL_FONT = 'bold 14px Arial';
const LABEL_RADIUS_RATIO = 0.7;
const LABEL_MIN_ARC = 0.1;
const LABEL_MAX_CHARS = 12;
const LABEL_TRUNCATED_CHARS = 10;

// Pointer
const POINTER_HALF_WIDTH = 15;
const POINTER_HEIGHT = 20;
const POINTER_COLOR = 'gold';
const POINTER_SHADOW_BLUR = 15;

// Outer ring
const OUTER_RING_OFFSET = 10;
const INNER_RING_OFFSET = 5;
const OUTER_RING_STROKE = 'rgba(255, 255, 255, 0.3)';
const INNER_RING_STROKE = 'rgba(255, 255, 255, 0.1)';
const OUTER_RING_WIDTH = 4;
const INNER_RING_WIDTH = 2;

/**
 * Wheel visualization renderer.
 *
 * Spin math (target rotation + cursor resolution) is internal to this
 * visualization; the contract only exposes a target scalar and a cursor
 * query.
 */
export class WheelRenderer extends BaseRenderer {
    render(): void {
        const { width: canvasWidth, height: canvasHeight } = this.getLogicalSize();
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        const radius = Math.min(centerX, centerY) - WHEEL_MARGIN;

        this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        this.ctx.save();
        this.ctx.translate(centerX, centerY);
        this.ctx.rotate(this.animationValue);

        for (const segment of this.segments) {
            const presence = this.presenceOf(segment.lot.id);
            const game = this.isGameHighlighted(segment.lot.id);
            const cursor = this.isCursor(segment.lot.id);

            this.ctx.beginPath();
            this.ctx.moveTo(0, 0);
            this.ctx.arc(0, 0, radius, segment.startAngle, segment.endAngle);
            this.ctx.closePath();

            this.ctx.globalAlpha = presence;
            this.ctx.fillStyle = game
                ? brightenColor(segment.lot.color, GAME_HIGHLIGHT_BRIGHTNESS + GAME_HIGHLIGHT_BOOST * this.highlight.pulse)
                : cursor
                    ? brightenColor(segment.lot.color, CURSOR_HIGHLIGHT_BRIGHTNESS)
                    : segment.lot.color;
            this.ctx.fill();

            this.ctx.strokeStyle = SEGMENT_STROKE;
            this.ctx.lineWidth = SEGMENT_STROKE_WIDTH;
            this.ctx.stroke();
            this.ctx.globalAlpha = 1;

            if (segment.endAngle - segment.startAngle > LABEL_MIN_ARC) {
                this.drawWheelLabel(segment, radius, presence);
            }
        }

        this.ctx.restore();

        this.drawPointer(centerX, centerY);
        this.drawOuterRing(centerX, centerY, radius);
    }

    computeSpinTarget(rolledLotId: string, durationMs: number): number {
        return RouletteEngine.computeFinalRotation(
            this.segments,
            rolledLotId,
            this.animationValue,
            durationMs
        );
    }

    getCursorLotId(animationValue: number): string | null {
        // Resolve against the STABLE (presence-independent) partition so the
        // cursor does not hop while the drawing geometry animates.
        const segments = this.timingSegments;
        if (segments.length === 0) return null;

        // A segment at angle θ appears at θ + R. It sits under the top pointer
        // (−π/2) when θ ≡ −π/2 − R (mod 2π).
        const twoPi = Math.PI * 2;
        let local = (-Math.PI / 2 - animationValue) % twoPi;
        if (local < 0) local += twoPi;

        for (const segment of segments) {
            if (local >= segment.startAngle && local < segment.endAngle) return segment.lot.id;
        }
        return segments[segments.length - 1].lot.id;
    }

    private drawWheelLabel(segment: Segment, radius: number, presence: number): void {
        const midAngle = (segment.startAngle + segment.endAngle) / 2;
        const textRadius = radius * LABEL_RADIUS_RATIO;

        this.ctx.save();
        this.ctx.globalAlpha = presence;
        this.ctx.translate(Math.cos(midAngle) * textRadius, Math.sin(midAngle) * textRadius);
        this.ctx.rotate(midAngle);

        this.ctx.fillStyle = '#fff';
        this.ctx.font = LABEL_FONT;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        const displayName = segment.lot.name.length > LABEL_MAX_CHARS
            ? segment.lot.name.substring(0, LABEL_TRUNCATED_CHARS) + '..'
            : segment.lot.name;

        this.ctx.fillText(displayName, 0, 0);
        this.ctx.restore();
    }

    private drawPointer(centerX: number, centerY: number): void {
        const radius = Math.min(centerX, centerY) - WHEEL_MARGIN;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.moveTo(centerX - POINTER_HALF_WIDTH, centerY - radius - POINTER_HEIGHT);
        this.ctx.lineTo(centerX + POINTER_HALF_WIDTH, centerY - radius - POINTER_HEIGHT);
        this.ctx.lineTo(centerX, centerY - radius);
        this.ctx.closePath();

        this.ctx.fillStyle = POINTER_COLOR;
        this.ctx.fill();

        this.ctx.shadowColor = POINTER_COLOR;
        this.ctx.shadowBlur = POINTER_SHADOW_BLUR;
        this.ctx.stroke();
        this.ctx.restore();
    }

    private drawOuterRing(centerX: number, centerY: number, radius: number): void {
        const outerRadius = radius + OUTER_RING_OFFSET;

        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
        this.ctx.strokeStyle = OUTER_RING_STROKE;
        this.ctx.lineWidth = OUTER_RING_WIDTH;
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, radius - INNER_RING_OFFSET, 0, Math.PI * 2);
        this.ctx.strokeStyle = INNER_RING_STROKE;
        this.ctx.lineWidth = INNER_RING_WIDTH;
        this.ctx.stroke();
    }
}
