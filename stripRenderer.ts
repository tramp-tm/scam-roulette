import type { Lot, RenderableParticipant } from './types.js';
import { RouletteEngine } from './rouletteEngine.js';
import { BaseRenderer } from './baseRenderer.js';
import { brightenColor, getStripBandWidth, normalizeToFractions } from './utils.js';

// Band geometry
const BAND_HEIGHT = 320;

/** Smallest band height, as a fraction of the full band height (axis-2 floor). */
const MIN_BAND_HEIGHT_RATIO = 0.35;
const MIN_BAND_HEIGHT = BAND_HEIGHT * MIN_BAND_HEIGHT_RATIO;

// Outer frame (the container around the full band height)
const FRAME_PADDING = 10;
const FIELD_HEIGHT = BAND_HEIGHT + 2 * FRAME_PADDING;

// Labels — axis-style: rotated, drawn in the strip UNDER the band field (below
// the rectangles, so a short band can never clip them). The name is shortened to
// the length of that strip (frame bottom -> canvas bottom), so a label always
// stays between the frame and the bottom edge of the canvas.
const LABEL_FONT = 'bold 14px Arial';
const LABEL_GAP_Y = 8;       // frame bottom -> the label's near end
const LABEL_MARGIN_Y = 6;    // the label's far end -> canvas bottom
const LABEL_ELLIPSIS = '..';

// Cursor highlight
const CURSOR_HIGHLIGHT_BRIGHTNESS = 18;

// Lot accents — additive outline in the accent colour, inset into the band so
// the hover outline (drawn on the band edge) never covers it. Band width,
// order and geometry are untouched.
const ACCENT_INSET = 2;
const ACCENT_GLOW_BLUR = 16;

// Hover (lots-list interaction) — additive overlay, distinct from the lot accents
const HOVER_COLOR = '#7fd4ff';
const HOVER_STROKE_WIDTH = 3;
const HOVER_GLOW_BLUR = 16;

/** Strip-specific band geometry. Widths/offsets/heights live here — never in
 *  the shared participant/presentation contract. */
interface StripBand {
    lot: Lot;
    startInCycle: number;
    width: number;
    /** Band height in px (MIN_BAND_HEIGHT .. BAND_HEIGHT), from the mode's magnitude. */
    height: number;
}

/**
 * Strip (ribbon) visualization renderer.
 *
 * Two INDEPENDENT axes:
 *  - the band WIDTH comes from the participant's `xValue` (axis 1, the CHANCE —
 *    the value the roll used), normalised through `normalizeToFractions`. So
 *    equal-chance modes draw equal-width bands;
 *  - the band HEIGHT comes from `yValue` (axis 2, the mode's magnitude), scaled
 *    onto `[MIN_BAND_HEIGHT, BAND_HEIGHT]`. An ABSENT magnitude (mode leaves
 *    axis 2 empty) or all-equal magnitudes are the degenerate "maximum" case:
 *    every band is full height.
 *
 * The band FIELD (the frame around the full band height) is centred in the
 * canvas and the bands inside it are ALIGNED TO ITS BOTTOM: they share one
 * baseline and their height grows upwards (the width/height axes themselves are
 * unchanged). Each lot's label is a rotated axis-style caption UNDER the field,
 * so a short band can never clip it; its length is the strip between the frame
 * and the bottom of the canvas, and a longer name is shortened to that.
 *
 * The spin target and the cursor are resolved against this strip-local geometry.
 *
 * Hover (`setHover`, lots-list interaction) draws an additive outline around
 * the hovered lot's band, so it composes with — and never replaces — the lot
 * accents or the cursor (and never alters band width, height or ordering).
 */
export class StripRenderer extends BaseRenderer {
    private bands: StripBand[] = [];
    private totalCycleWidth = 0;

    protected override onViewStateChanged(): void {
        const drawn = this.drawableParticipants();

        // Band width: axis 1 (chance), normalised as before.
        const fractions = normalizeToFractions(drawn.map(p => p.xValue));

        // Band height: axis 2 (magnitude). No magnitude anywhere, or all equal,
        // degenerates to the full band height.
        const maxMagnitude = this.maxMagnitude(drawn);

        let x = 0;
        this.bands = drawn.map((p, i) => {
            const width = getStripBandWidth(fractions[i]);
            const magnitude = Math.max(0, p.yValue ?? maxMagnitude);
            const height = maxMagnitude > 0
                ? MIN_BAND_HEIGHT + (magnitude / maxMagnitude) * (BAND_HEIGHT - MIN_BAND_HEIGHT)
                : BAND_HEIGHT;
            const band: StripBand = { lot: p.lot, startInCycle: x, width, height };
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

        // The field (frame + the full band height) is CENTRED vertically; inside
        // it every band rests on ONE bottom baseline, so heights grow upwards.
        // The labels are captions under the field, like axis labels on a chart.
        const fieldTop = (canvasHeight - FIELD_HEIGHT) / 2;
        const bandBottom = fieldTop + FRAME_PADDING + BAND_HEIGHT;
        const labelTop = fieldTop + FIELD_HEIGHT + LABEL_GAP_Y;
        // How much room the caption has before the bottom edge of the canvas.
        const labelMaxLength = canvasHeight - LABEL_MARGIN_Y - labelTop;

        this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        if (this.bands.length === 0 || this.totalCycleWidth === 0) return;

        const visualScrollOffset = this.getVisualOffset();
        const cyclesNeeded = this.getCyclesNeeded(canvasWidth);

        this.ctx.save();
        this.ctx.translate(-visualScrollOffset, 0);
        for (let cycle = -1; cycle <= cyclesNeeded; cycle++) {
            this.renderOneCycle(cycle * this.totalCycleWidth, bandBottom, labelTop, labelMaxLength);
        }
        this.ctx.restore();

        this.drawCenterMarker(canvasWidth / 2, canvasHeight);
        this.drawFrame(canvasWidth, fieldTop);
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
        // The cursor follows the drawn (chance-based) geometry: the band under
        // the centre marker.
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

    /**
     * Largest magnitude (`yValue`) among the drawn participants, or 0 when none
     * of them carries one (axis 2 absent). A missing magnitude is treated as the
     * maximum, so a lot without axis 2 keeps the full-height (default) band.
     */
    private maxMagnitude(participants: readonly RenderableParticipant[]): number {
        let max = 0;
        for (const p of participants) {
            if (p.yValue !== undefined && p.yValue > max) max = p.yValue;
        }
        return max;
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

    private renderOneCycle(xOffset: number, bandBottom: number, labelTop: number, labelMaxLength: number): void {
        for (const band of this.bands) {
            // Bottom-aligned: the band's top edge sits its own height above the
            // shared baseline.
            const top = bandBottom - band.height;
            // `presence` still gates hover (transient UI channel); the band's
            // own drawing uses `presence × zValue`.
            const presence = this.presenceOf(band.lot.id);
            const opacity = this.opacityOf(band.lot.id);
            const cursor = this.isCursor(band.lot.id);

            const baseColor = band.lot.color || '#888';
            const fillColor = cursor
                ? brightenColor(baseColor, CURSOR_HIGHLIGHT_BRIGHTNESS)
                : baseColor;

            const currentX = xOffset + band.startInCycle;

            this.ctx.save();
            this.ctx.globalAlpha = opacity;
            this.ctx.fillStyle = fillColor;
            this.ctx.fillRect(currentX, top, band.width, band.height);
            this.ctx.restore();

            // Lot accent: an additive outline in the accent colour, inset so the
            // hover outline (on the band edge) never covers it. No geometry change.
            const accent = this.accentVisual(band.lot.id);
            if (accent && accent.alpha > 0) {
                this.ctx.save();
                this.ctx.globalAlpha = opacity * accent.alpha;
                this.ctx.strokeStyle = accent.color;
                this.ctx.lineWidth = accent.strokeWidth;
                this.ctx.shadowColor = accent.color;
                this.ctx.shadowBlur = ACCENT_GLOW_BLUR;
                this.ctx.strokeRect(
                    currentX + ACCENT_INSET,
                    top + ACCENT_INSET,
                    band.width - 2 * ACCENT_INSET,
                    band.height - 2 * ACCENT_INSET
                );
                this.ctx.restore();
            }

            // Hover is an additive outline over the band; it composes with the
            // accent outline rather than replacing it.
            if (this.isHovered(band.lot.id)) {
                this.ctx.save();
                this.ctx.globalAlpha = presence;
                this.ctx.strokeStyle = HOVER_COLOR;
                this.ctx.lineWidth = HOVER_STROKE_WIDTH;
                this.ctx.shadowColor = HOVER_COLOR;
                this.ctx.shadowBlur = HOVER_GLOW_BLUR;
                this.ctx.strokeRect(currentX, top, band.width, band.height);
                this.ctx.restore();
            }

            if (presence > 0.01) {
                this.drawBandLabel(band, currentX + band.width / 2, labelTop, labelMaxLength, opacity);
            }
        }
    }

    /**
     * Axis-style caption for a lot: vertical (rotated like chart axis labels, so
     * long names still fit narrow bands), anchored just under the frame and
     * running DOWN `labelTop -> canvas bottom`. `textAlign: 'right'` puts the end
     * of the name at the anchor (nearest the frame) and `textBaseline: 'middle'`
     * keeps it centred on the band's own centre line.
     */
    private drawBandLabel(band: StripBand, textX: number, textY: number, maxLength: number, alpha: number): void {
        this.ctx.save();
        this.ctx.globalAlpha = alpha;
        this.ctx.translate(textX, textY);
        this.ctx.rotate(-Math.PI / 2);

        this.ctx.fillStyle = '#fff';
        this.ctx.font = LABEL_FONT;
        this.ctx.textAlign = 'right';
        this.ctx.textBaseline = 'middle';

        this.ctx.fillText(this.fitLabel(band, maxLength), 0, 0);
        this.ctx.restore();
    }

    /**
     * The lot name shortened to the room the caption has (`LABEL_ELLIPSIS` marks
     * the cut). Real text metrics are used, so it adapts both to the name and to
     * the available strip; an empty string means even the ellipsis does not fit.
     */
    private fitLabel(band: StripBand, maxLength: number): string {
        if (maxLength <= 0) return '';

        const name = band.lot.name;
        if (this.ctx.measureText(name).width <= maxLength) return name;
        if (this.ctx.measureText(LABEL_ELLIPSIS).width > maxLength) return '';

        let cut = name;
        while (cut.length > 0 && this.ctx.measureText(cut + LABEL_ELLIPSIS).width > maxLength) {
            cut = cut.slice(0, -1);
        }
        return cut + LABEL_ELLIPSIS;
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

    private drawFrame(canvasWidth: number, fieldTop: number): void {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(0, fieldTop, canvasWidth, FIELD_HEIGHT);
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.lineWidth = 4;
        this.ctx.stroke();
        this.ctx.restore();
    }
}
