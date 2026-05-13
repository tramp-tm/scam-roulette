import { Lot, Segment, VisualizationType, ModeConfig } from './types.js';
import { RouletteEngine } from './rouletteEngine.js';

/**
 * Handles all canvas rendering for the roulette visualization.
 */
export class Renderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    
    // Rendering state
    private segments: Segment[] = [];
    private currentRotation: number = 0;
    private highlightedLotId: string | null = null;
    private visualizationType: VisualizationType = 'wheel';

    // Wheel configuration
    private wheelRadius: number = 200;
    private centerX: number = 300;
    private centerY: number = 250;
    
    // Strip configuration
    private stripHeight: number = 150;
    private stripY: number = 175;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        
        // Set up canvas for high DPI displays
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
        
        // Update center positions based on actual canvas size
        this.centerX = rect.width / 2;
        this.centerY = rect.height / 2;
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
     * Sets the visualization type.
     */
    setVisualizationType(type: VisualizationType): void {
        this.visualizationType = type;
    }

    /**
     * Main render method - called every frame.
     */
    render(): void {
        const rect = this.canvas.getBoundingClientRect();
        
        // Clear canvas
        this.ctx.clearRect(0, 0, rect.width, rect.height);

        if (this.visualizationType === 'wheel') {
            this.renderWheel(rect.width, rect.height);
        } else {
            this.renderStrip(rect.width, rect.height);
        }
    }

    /**
     * Renders the wheel visualization.
     */
    private renderWheel(canvasWidth: number, canvasHeight: number): void {
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        const radius = Math.min(centerX, centerY) - 30;

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
            this.ctx.fillStyle = isHighlighted ? this.brightenColor(segment.lot.color, 30) : segment.lot.color;
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
        this.ctx.rotate(midAngle + Math.PI / 2);
        
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
        
        // Draw pointer triangle
        this.ctx.beginPath();
        this.ctx.moveTo(centerX - 15, centerY - radius - 20);
        this.ctx.lineTo(centerX + 15, centerY - radius - 20);
        this.ctx.lineTo(centerX, centerY - radius - 40);
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
     * Renders the horizontal strip visualization.
     */
    private renderStrip(canvasWidth: number, canvasHeight: number): void {
        const centerY = canvasHeight / 2;
        const segmentWidth = 100; // Base width for each segment
        
        this.ctx.save();

        // Apply horizontal scroll (currentRotation is already in pixels for strip mode)
        const scrollOffset = this.currentRotation;
        
        // Create clipping region for the strip view
        this.ctx.beginPath();
        this.ctx.rect(0, centerY - 75, canvasWidth, 150);
        this.ctx.clip();

        // Draw all segments in a horizontal line
        let currentX = scrollOffset;
        
        for (const segment of this.segments) {
            const isHighlighted = segment.lot.id === this.highlightedLotId;
            
            // Calculate segment width based on weight (with minimum)
            const segmentWidthPx = Math.max(60, segment.weight * 400);
            
            // Draw segment background
            this.ctx.fillStyle = isHighlighted ? this.brightenColor(segment.lot.color, 30) : segment.lot.color;
            this.ctx.fillRect(currentX, centerY - 75, segmentWidthPx + 2, 150);

            // Draw border
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(currentX, centerY - 75, segmentWidthPx + 2, 150);

            // Draw label
            const centerX = currentX + segmentWidthPx / 2;
            
            this.ctx.fillStyle = '#fff';
            this.ctx.font = 'bold 14px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            
            // Name
            const displayName = segment.lot.name.length > 15 
                ? segment.lot.name.substring(0, 13) + '..' 
                : segment.lot.name;
            this.ctx.fillText(displayName, centerX, centerY - 20);

            currentX += segmentWidthPx;
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
