import type { Lot } from './types.js';
import { RouletteEngine } from './rouletteEngine.js';
import { BaseRenderer } from './baseRenderer.js';
import { brightenColor, getStripBandWidth, normalizeToFractions } from './utils.js';

// Band geometry
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

// Hover (lots-list interaction) — additive overlay, distinct from the gold game highlight
const HOVER_COLOR = '#7fd4ff';
const HOVER_STROKE_WIDTH = 3;
const HOVER_GLOW_BLUR = 16;

/** Strip-specific band geometry. Widths/offsets live here — never in the
 *  shared participant/presentation contract. */
interface StripBand {
    lot: Lot;
    startInCycle: number;
    width: number;
}

/**
 * Strip (ribbon) visualization renderer.
 *
 * Band width comes from the participant's `visualValue` (scaled by `presence`),
 * NOT from `selectionWeight`. The spin target and the cursor are resolved
 * against this strip-local geometry.
 *
 * Hover (`setHover`, lots-list interaction) draws an additive outline around
 * the hovered lot's band, so it composes with — and never replaces — the game
 * highlight (and never alters band width or ordering).
 */
export class StripRenderer extends BaseRenderer {
    private bands: StripBand[] = [];
    private totalCycleWidth = 0;

    protected override onViewStateChanged(): void {
        const parts = this.drawableParticipants().map(p => ({
            lot: p.lot,
            value: p.visualValue * p.presence
        }));
        const fractions = normalizeToFractions(parts.map(p => p.value));

        let x = 0;
        this.bands = parts.map((p, i) => {
            const width = getStripBandWidth(fractions[i]);
            const band: StripBand = { lot: p.lot, startInCycle: x, width };
            x += width;
            return band;
        });
        this.totalCycleWidth = x;
    }

    protected override onReset(): void {
        this.bands = [];
        this.totalCycleWidth = 0;
    }

    render(): void {
        const { width: canvasWidth, height: canvasHeight } = this.getLogicalSize();
        const centerY = canvasHeight / 2;

        this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        if (this.bands.length === 0 || this.totalCycleWidth === 0) return;

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
        const band = this.bands.find(b => b.lot.id === rolledLotId);
        if (!band) return this.animationValue;
        return RouletteEngine.computeFinalScrollOffset(
            band.startInCycle,
            band.width,
            this.totalCycleWidth,
            this.animationValue,
            durationMs,
            this.getLogicalSize().width
        );
    }

    getCursorLotId(animationValue: number): string | null {
        // The cursor follows the drawn (visualValue-based) geometry: the band
        // under the centre marker.
        if (this.bands.length === 0 || this.totalCycleWidth <= 0) return null;

        const centerX = this.getLogicalSize().width / 2;
        let local = (animationValue + centerX) % this.totalCycleWidth;
        if (local < 0) local += this.totalCycleWidth;

        for (const band of this.bands) {
            if (local >= band.startInCycle && local < band.startInCycle + band.width) {
                return band.lot.id;
            }
        }
        return this.bands[this.bands.length - 1].lot.id;
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
        for (const band of this.bands) {
            const presence = this.presenceOf(band.lot.id);
            const game = this.isGameHighlighted(band.lot.id);
            const cursor = this.isCursor(band.lot.id);

            const baseColor = band.lot.color || '#888';
            const fillColor = game
                ? brightenColor(baseColor, GAME_HIGHLIGHT_BRIGHTNESS + GAME_HIGHLIGHT_BOOST * this.highlight.pulse)
                : cursor
                    ? brightenColor(baseColor, CURSOR_HIGHLIGHT_BRIGHTNESS)
                    : baseColor;

            const currentX = xOffset + band.startInCycle;

            this.ctx.save();
            this.ctx.globalAlpha = presence;
            if (game) {
                this.ctx.shadowColor = HIGHLIGHT_SHADOW_COLOR;
                this.ctx.shadowBlur = HIGHLIGHT_SHADOW_BLUR * this.highlight.pulse;
            }

            this.ctx.fillStyle = fillColor;
            this.ctx.fillRect(currentX, centerY - BAND_HALF_HEIGHT, band.width, BAND_HEIGHT);
            this.ctx.restore();

            // Hover is an additive outline over the band; it composes with the
            // game fill/glow rather than replacing it.
            if (this.isHovered(band.lot.id)) {
                this.ctx.save();
                this.ctx.globalAlpha = presence;
                this.ctx.strokeStyle = HOVER_COLOR;
                this.ctx.lineWidth = HOVER_STROKE_WIDTH;
                this.ctx.shadowColor = HOVER_COLOR;
                this.ctx.shadowBlur = HOVER_GLOW_BLUR;
                this.ctx.strokeRect(currentX, centerY - BAND_HALF_HEIGHT, band.width, BAND_HEIGHT);
                this.ctx.restore();
            }

            if (presence > 0.01) {
                this.drawBandLabel(band, currentX + band.width / 2, centerY, presence);
            }
        }
    }

    private drawBandLabel(band: StripBand, textX: number, textY: number, presence: number): void {
        this.ctx.save();
        this.ctx.globalAlpha = presence;
        this.ctx.translate(textX, textY);
        this.ctx.rotate(-Math.PI / 2);

        this.ctx.fillStyle = '#fff';
        this.ctx.font = LABEL_FONT;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        const name = band.lot.name;
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
