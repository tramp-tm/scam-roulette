import { Segment } from './types.js';
import { BaseRenderer } from './baseRenderer.js';
import { brightenColor } from './utils.js';

// Wheel geometry
const WHEEL_MARGIN = 30;

// Segment strokes
const SEGMENT_STROKE = '#fff';
const SEGMENT_STROKE_WIDTH = 2;

// Highlight
const HIGHLIGHT_BRIGHTNESS = 30;

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
 */
export class WheelRenderer extends BaseRenderer {
    constructor(canvas: HTMLCanvasElement) {
        super(canvas);
    }

    /**
     * Main render method - renders wheel visualization.
     */
    render(): void {
        const { width: canvasWidth, height: canvasHeight } = this.getLogicalSize();
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        const radius = Math.min(centerX, centerY) - WHEEL_MARGIN;

        // Clear canvas
        this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        // Save context state
        this.ctx.save();

        // Translate to center and apply rotation
        this.ctx.translate(centerX, centerY);
        this.ctx.rotate(this.currentRotation);

        // Draw wheel segments
        for (const segment of this.segments) {
            const isHighlighted = segment.lot.id === this.highlightedLotId;

            this.ctx.beginPath();
            this.ctx.moveTo(0, 0);
            this.ctx.arc(0, 0, radius, segment.startAngle, segment.endAngle);
            this.ctx.closePath();

            // Fill segment
            this.ctx.fillStyle = isHighlighted
                ? brightenColor(segment.lot.color, HIGHLIGHT_BRIGHTNESS)
                : segment.lot.color;
            this.ctx.fill();

            // Stroke segment
            this.ctx.strokeStyle = SEGMENT_STROKE;
            this.ctx.lineWidth = SEGMENT_STROKE_WIDTH;
            this.ctx.stroke();

            // Draw text label
            if (segment.endAngle - segment.startAngle > LABEL_MIN_ARC) {
                this.drawWheelLabel(segment, radius);
            }
        }

        // Restore context
        this.ctx.restore();

        // Draw pointer (fixed at top)
        this.drawPointer(centerX, centerY);

        // Draw outer ring
        this.drawOuterRing(centerX, centerY, radius);
    }

    /**
     * Draws a label on the wheel segment.
     */
    private drawWheelLabel(segment: Segment, radius: number): void {
        const midAngle = (segment.startAngle + segment.endAngle) / 2;
        const textRadius = radius * LABEL_RADIUS_RATIO;

        this.ctx.save();
        this.ctx.translate(
            Math.cos(midAngle) * textRadius,
            Math.sin(midAngle) * textRadius
        );
        this.ctx.rotate(midAngle); // Text now rotated 90° CCW from original orientation

        this.ctx.fillStyle = '#fff';
        this.ctx.font = LABEL_FONT;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Truncate name if too long
        const displayName = segment.lot.name.length > LABEL_MAX_CHARS
            ? segment.lot.name.substring(0, LABEL_TRUNCATED_CHARS) + '..'
            : segment.lot.name;

        this.ctx.fillText(displayName, 0, 0);
        this.ctx.restore();
    }

    /**
     * Draws the pointer at the top of the wheel.
     */
    private drawPointer(centerX: number, centerY: number): void {
        const radius = Math.min(centerX, centerY) - WHEEL_MARGIN;

        this.ctx.save();

        // Draw pointer triangle (flipped to point DOWN toward wheel)
        this.ctx.beginPath();
        this.ctx.moveTo(centerX - POINTER_HALF_WIDTH, centerY - radius - POINTER_HEIGHT);
        this.ctx.lineTo(centerX + POINTER_HALF_WIDTH, centerY - radius - POINTER_HEIGHT);
        this.ctx.lineTo(centerX, centerY - radius);
        this.ctx.closePath();

        this.ctx.fillStyle = POINTER_COLOR;
        this.ctx.fill();

        // Add glow effect
        this.ctx.shadowColor = POINTER_COLOR;
        this.ctx.shadowBlur = POINTER_SHADOW_BLUR;
        this.ctx.stroke();

        this.ctx.restore();
    }

    /**
     * Draws the outer decorative ring.
     */
    private drawOuterRing(centerX: number, centerY: number, radius: number): void {
        const outerRadius = radius + OUTER_RING_OFFSET;

        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
        this.ctx.strokeStyle = OUTER_RING_STROKE;
        this.ctx.lineWidth = OUTER_RING_WIDTH;
        this.ctx.stroke();

        // Inner ring
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, radius - INNER_RING_OFFSET, 0, Math.PI * 2);
        this.ctx.strokeStyle = INNER_RING_STROKE;
        this.ctx.lineWidth = INNER_RING_WIDTH;
        this.ctx.stroke();
    }
}
