import { Lot, Segment, ModeConfig } from './types.js';
import { RouletteEngine } from './rouletteEngine.js';
import { IRenderer } from './types.js';
import { brightenColor } from './utils.js';

/**
 * Wheel visualization renderer.
 */
export class WheelRenderer implements IRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    
    // Rendering state
    private segments: Segment[] = [];
    private currentRotation: number = 0;
    private highlightedLotId: string | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.setupHighDPI();
    }

    /**
     * Sets up canvas for high DPI displays.
     */
    private setupHighDPI(): void {
        const dpr = window.devicePixelRatio || 1;
        let rect: DOMRect & { toJSON?: () => any } = this.canvas.getBoundingClientRect();
        
        // Use fallback dimensions if the canvas isn't visible yet
        if (rect.width === 0 || rect.height === 0) {
            rect = { 
                width: 600, 
                height: 500, 
                x: 0, 
                y: 0, 
                top: 0, 
                left: 0, 
                bottom: 0, 
                right: 0,
                toJSON: () => ({})
            } as DOMRect & { toJSON?: () => any };
        }
        
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        
        this.ctx.scale(dpr, dpr);
    }

    /**
     * Updates the segments to render.
     */
    updateSegments(lots: Lot[], modeConfig: ModeConfig): void {
        this.segments = RouletteEngine.calculateSegments(lots, modeConfig);
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
     * Main render method - renders wheel visualization.
     */
    render(canvasWidth: number, canvasHeight: number): void {
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        const radius = Math.min(centerX, centerY) - 30;

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
            this.ctx.fillStyle = isHighlighted ? brightenColor(segment.lot.color, 30) : segment.lot.color;
            this.ctx.fill();

            // Stroke segment
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();

            // Draw text label
            if (segment.endAngle - segment.startAngle > 0.1) {
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
        const textRadius = radius * 0.7;
        
        this.ctx.save();
        this.ctx.translate(
            Math.cos(midAngle) * textRadius,
            Math.sin(midAngle) * textRadius
        );
        this.ctx.rotate(midAngle); // Text now rotated 90° CCW from original orientation
        
        this.ctx.fillStyle = '#fff';
        this.ctx.font = 'bold 14px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        // Truncate name if too long
        const displayName = segment.lot.name.length > 12 
            ? segment.lot.name.substring(0, 10) + '..' 
            : segment.lot.name;
            
        this.ctx.fillText(displayName, 0, 0);
        this.ctx.restore();
    }

    /**
     * Draws the pointer at the top of the wheel.
     */
    private drawPointer(centerX: number, centerY: number): void {
        const radius = Math.min(centerX, centerY) - 30;
        
        this.ctx.save();
        
        // Draw pointer triangle (flipped to point DOWN toward wheel)
        this.ctx.beginPath();
        this.ctx.moveTo(centerX - 15, centerY - radius - 20);
        this.ctx.lineTo(centerX + 15, centerY - radius - 20);
        this.ctx.lineTo(centerX, centerY - radius);
        this.ctx.closePath();
        
        this.ctx.fillStyle = '#fff';
        this.ctx.fill();
        
        // Add glow effect
        this.ctx.shadowColor = 'gold';
        this.ctx.shadowBlur = 15;
        this.ctx.stroke();
        
        this.ctx.restore();
    }

    /**
     * Draws the outer decorative ring.
     */
    private drawOuterRing(centerX: number, centerY: number, radius: number): void {
        const outerRadius = radius + 10;
        
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.lineWidth = 4;
        this.ctx.stroke();

        // Inner ring
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, radius - 5, 0, Math.PI * 2);
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
    }

    /**
     * Resets the renderer state.
     */
    reset(): void {
        this.currentRotation = 0;
        this.highlightedLotId = null;
        this.segments = [];
    }
}
