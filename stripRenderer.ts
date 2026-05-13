import { Lot, Segment, ModeConfig } from './types.js';
import { RouletteEngine } from './rouletteEngine.js';
import { IRenderer } from './types.js';
import { debugLog } from './utils.js';

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
     * Main render method - renders infinite strip visualization.
     */
    render(canvasWidth: number, canvasHeight: number): void {
        const centerY = canvasHeight / 2;
        
        // Clear canvas
        this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        // Calculate total width of one complete cycle
        let totalCycleWidth = 0;
        for (const segment of this.segments) {
            totalCycleWidth += Math.max(60, segment.weight * 400);
        }

        if (totalCycleWidth === 0) return;

        // Calculate how many cycles we need to fill screen + buffer on both sides
        const visibleWidth = canvasWidth;
        const bufferSize = totalCycleWidth; // Extra buffer for smooth scrolling
        const requiredWidth = visibleWidth + bufferSize * 2;
        const numCycles = Math.ceil(requiredWidth / totalCycleWidth) + 1;

        this.ctx.save();

        // Apply horizontal scroll (currentRotation is already in pixels for strip mode)
        const scrollOffset = this.currentRotation;
        
        // DEBUG LOG: Render frame info for strip mode
        debugLog('STRIP.render', `Render frame - Scroll offset: ${scrollOffset.toFixed(2)}px, Num cycles rendered: ${numCycles}`);
        
        // Create clipping region for the strip view
        this.ctx.beginPath();
        this.ctx.rect(0, centerY - 75, canvasWidth, 150);
        this.ctx.clip();

        // Render multiple cycles (infinite loop effect)
        for (let cycle = 0; cycle < numCycles; cycle++) {
            let currentXInCycle = 0;
            
            for (const segment of this.segments) {
                const isHighlighted = segment.lot.id === this.highlightedLotId;
                
                // Calculate segment width based on weight (with minimum)
                const segmentWidthPx = Math.max(60, segment.weight * 400);
                
                // Absolute x position for this segment in this cycle
                const absoluteX = scrollOffset + (cycle * totalCycleWidth) + currentXInCycle;
                
                // DEBUG LOG: Check if highlighted lot is near center pointer
                if (isHighlighted && Math.abs(absoluteX - canvasWidth / 2) < 50) {
                    debugLog('STRIP.render', `✓ HIGHLIGHTED LOT "${segment.lot.name}" IS NEAR CENTER POINTER!`);
                    debugLog('STRIP.render', `  Lot center X: ${absoluteX + segmentWidthPx/2}px, Canvas center: ${canvasWidth/2}px, Offset: ${(absoluteX + segmentWidthPx/2 - canvasWidth/2).toFixed(1)}px`);
                }
                
                // Draw segment background
                this.ctx.fillStyle = isHighlighted ? this.brightenColor(segment.lot.color, 30) : segment.lot.color;
                this.ctx.fillRect(absoluteX, centerY - 75, segmentWidthPx + 2, 150);

                // Draw border
                this.ctx.strokeStyle = '#fff';
                this.ctx.lineWidth = 2;
                this.ctx.strokeRect(absoluteX, centerY - 75, segmentWidthPx + 2, 150);

                // Draw label
                const centerX = absoluteX + segmentWidthPx / 2;
                
                this.ctx.fillStyle = '#fff';
                this.ctx.font = 'bold 14px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                
                // Name
                const displayName = segment.lot.name.length > 15 
                    ? segment.lot.name.substring(0, 13) + '..' 
                    : segment.lot.name;
                this.ctx.fillText(displayName, centerX, centerY - 20);
                
                // Amount
                this.ctx.font = '12px Arial';
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                this.ctx.fillText(`$${segment.lot.amount.toFixed(2)}`, centerX, centerY + 20);

                currentXInCycle += segmentWidthPx;
            }
        }

        // Draw center pointer line
        this.ctx.restore();
        
        // Center marker (pointer position)
        this.drawCenterMarker(canvasWidth / 2, centerY);
    }

    /**
     * Draws the center marker for strip view.
     */
    private drawCenterMarker(x: number, y: number): void {
        this.ctx.save();
        
        // Vertical line
        this.ctx.beginPath();
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, window.innerHeight);
        this.ctx.strokeStyle = 'gold';
        this.ctx.lineWidth = 3;
        this.ctx.setLineDash([10, 5]);
        this.ctx.stroke();

        // Arrow at top
        this.ctx.beginPath();
        this.ctx.moveTo(x - 15, 20);
        this.ctx.lineTo(x + 15, 20);
        this.ctx.lineTo(x, 40);
        this.ctx.closePath();
        this.ctx.fillStyle = 'gold';
        this.ctx.fill();

        // Arrow at bottom
        this.ctx.beginPath();
        this.ctx.moveTo(x - 15, window.innerHeight - 40);
        this.ctx.lineTo(x + 15, window.innerHeight - 40);
        this.ctx.lineTo(x, window.innerHeight - 20);
        this.ctx.closePath();
        this.ctx.fillStyle = 'gold';
        this.ctx.fill();

        this.ctx.restore();
    }

    /**
     * Brightens a color by the specified percentage.
     */
    private brightenColor(color: string, percent: number): string {
        // Convert hex to RGB
        let r = 0, g = 0, b = 0;
        
        if (color.length === 4) {
            r = parseInt('0x' + color[1] + color[1]);
            g = parseInt('0x' + color[2] + color[2]);
            b = parseInt('0x' + color[3] + color[3]);
        } else if (color.length === 7) {
            r = parseInt('0x' + color[1] + color[2]);
            g = parseInt('0x' + color[3] + color[4]);
            b = parseInt('0x' + color[5] + color[6]);
        }

        // Brighten
        r = Math.min(255, r + percent);
        g = Math.min(255, g + percent);
        b = Math.min(255, b + percent);

        return `rgb(${r}, ${g}, ${b})`;
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
