import { Lot, Segment, ModeConfig } from './types.js';
import { RouletteEngine } from './rouletteEngine.js';
import { IRenderer } from './types.js';
import { brightenColor } from './utils.js';

/**
 * Strip (ribbon) visualization renderer.
 */
export class StripRenderer implements IRenderer {
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
     * Renders the strip visualization with infinite scrolling effect.
     * 
     * Uses modulo arithmetic to map large mathematical offsets to visual offsets,
     * then renders multiple buffer copies for seamless infinite illusion.
     */
    public render(canvasWidth: number, canvasHeight: number): void {
        const centerY = canvasHeight / 2;
        
        // Clear canvas
        this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        
        if (this.segments.length === 0) return;

        // Calculate total width of one complete cycle
        let totalCycleWidth = 0;
        for (const segment of this.segments) {
            const segWidth = Math.max(60, segment.weight * 400);
            totalCycleWidth += segWidth;
        }

        if (totalCycleWidth === 0) return;

        // ========================================
        // INFINITE SCROLLING LOGIC
        // ========================================
        
        // Mathematical offset: The true cumulative scroll position from animation
        // This can be any large number (e.g., 5182.55px after multiple cycles)
        const mathematicalScrollOffset = this.currentRotation;
        
        // Visual offset: Map to [0, totalCycleWidth) using modulo for rendering
        // This keeps the actual translation within one cycle's bounds
        let visualScrollOffset = mathematicalScrollOffset % totalCycleWidth;
        if (visualScrollOffset < 0) {
            visualScrollOffset += totalCycleWidth;
        }

        // ========================================
        // RENDER WITH BUFFER COPIES
        // ========================================
        
        this.ctx.save();
        
        // Translate by visual offset only (not mathematical)
        // Negative because we want left-to-right scrolling effect
        this.ctx.translate(-visualScrollOffset, 0);

        // Calculate how many buffer copies to render for seamless infinite effect
        // We need enough copies to cover viewport + margins on both sides
        const bufferMargin = canvasWidth; // Extra margin for smooth transitions
        const totalRenderWidth = canvasWidth + 2 * bufferMargin;
        const cyclesNeeded = Math.ceil(totalRenderWidth / totalCycleWidth) + 1;

        // Render multiple copies of the strip for infinite illusion
        for (let cycle = -1; cycle <= cyclesNeeded; cycle++) {
            this.renderOneCycle(cycle * totalCycleWidth, centerY);
        }

        // ========================================
        // DRAW CENTER POINTER LINE
        // ========================================
        
        this.ctx.restore();
        
        // Draw center marker at viewport center (independent of scroll)
        this.drawCenterMarker(canvasWidth / 2, centerY, canvasHeight);
    }

    /**
     * Renders one complete cycle of the strip at a given horizontal position.
     */
    private renderOneCycle(xOffset: number, centerY: number): void {
        let currentX = xOffset;
        
        for (const segment of this.segments) {
            const segmentWidth = Math.max(60, segment.weight * 400);
            
            // Determine fill color
            let fillColor = segment.lot.color || '#888';
            
            // Highlight the winning lot if it's this one
            if (segment.lot.id === this.highlightedLotId) {
                fillColor = brightenColor(fillColor, 40);
                
                // Draw highlight glow effect
                this.ctx.save();
                this.ctx.shadowColor = 'rgba(255, 215, 0, 0.8)';
                this.ctx.shadowBlur = 15;
            }
            
            // Draw segment rectangle (doubled height: 80 → 160)
            this.ctx.fillStyle = fillColor;
            this.ctx.fillRect(currentX, centerY - 80, segmentWidth, 160);
            
            if (segment.lot.id === this.highlightedLotId) {
                this.ctx.restore();
            }

            // Draw text label centered in segment (rotated 90° counterclockwise)
            const textX = currentX + segmentWidth / 2;
            const textY = centerY;
            
            this.ctx.save(); // Save context before rotation
            this.ctx.translate(textX, textY);
            this.ctx.rotate(-Math.PI / 2); // Rotate 90° counterclockwise
            
            this.ctx.fillStyle = '#fff';
            this.ctx.font = 'bold 14px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            
            // Name (truncated if needed)
            const displayName = segment.lot.name.length > 15 
                ? segment.lot.name.substring(0, 13) + '..' 
                : segment.lot.name;
            this.ctx.fillText(displayName, 0, -12); // Offset from rotated origin
            
            this.ctx.restore(); // Restore context after rotation

            currentX += segmentWidth;
        }
    }

    /**
     * Draws the center marker for strip view (pointer position).
     */
    private drawCenterMarker(x: number, y: number, canvasHeight: number): void {
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
     * Resets the renderer state.
     */
    reset(): void {
        this.currentRotation = 0;
        this.highlightedLotId = null;
        this.segments = [];
    }
}
