import type { Lot } from './types.js';
import { RouletteEngine } from './rouletteEngine.js';
import { BaseRenderer } from './baseRenderer.js';
import { brightenColor, normalizeToFractions } from './utils.js';

// Wheel geometry
const WHEEL_MARGIN = 30;
const TAU = Math.PI * 2;

// Sector strokes
const SECTOR_STROKE = '#fff';
const SECTOR_STROKE_WIDTH = 2;

// Cursor highlight
const CURSOR_HIGHLIGHT_BRIGHTNESS = 14;

// Lot accents — additive overlay drawn on top of every sector (like hover):
// a translucent glow fill plus a crisp outline in the accent colour. Geometry
// (angles/radius) is untouched.
const ACCENT_FILL_ALPHA = 0.22;
const ACCENT_GLOW_BLUR = 18;
const ACCENT_FILL_GLOW_BLUR = 26;

// Hover (lots-list interaction) — additive overlay drawn on top of the sectors,
// distinct from the lot accents
const HOVER_COLOR = '#7fd4ff';
const HOVER_FILL_COLOR = 'rgba(127, 212, 255, 0.25)';
const HOVER_STROKE_WIDTH = 4;
const HOVER_GLOW_BLUR = 18;
const HOVER_FILL_GLOW_BLUR = 26;

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

/** Wheel-specific sector geometry. Angles live here — never in the shared
 *  participant/presentation contract. */
interface WheelSector {
    lot: Lot;
    startAngle: number;
    endAngle: number;
}

/**
 * Wheel visualization renderer.
 *
 * Sector angular size comes from the participant's `visualValue` (scaled by
 * `presence`), NOT from `selectionWeight`. The spin target and the cursor are
 * resolved against this wheel-local geometry.
 *
 * Hover (`setHover`, lots-list interaction) draws a translucent glow fill plus
 * a crisp outline over the hovered sector, on top of every other sector, so
 * neighbouring borders cannot cover any of its edges. Lot accents are drawn the
 * same way: additive overlays that never replace hover or the cursor.
 */
export class WheelRenderer extends BaseRenderer {
    private sectors: WheelSector[] = [];

    protected override onViewStateChanged(): void {
        const parts = this.drawableParticipants().map(p => ({
            lot: p.lot,
            value: p.visualValue * p.presence
        }));
        const fractions = normalizeToFractions(parts.map(p => p.value));

        let cumulative = 0;
        this.sectors = parts.map((p, i) => {
            const startAngle = cumulative * TAU;
            cumulative += fractions[i];
            const endAngle = cumulative * TAU;
            return { lot: p.lot, startAngle, endAngle };
        });
    }

    protected override onReset(): void {
        this.sectors = [];
    }

    render(): void {
        const { width: canvasWidth, height: canvasHeight } = this.getLogicalSize();
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        const radius = Math.min(centerX, centerY) - WHEEL_MARGIN;

        this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        this.ctx.save();
        this.ctx.translate(centerX, centerY);
        this.ctx.rotate(this.animationValue);

        for (const sector of this.sectors) {
            const presence = this.presenceOf(sector.lot.id);
            const cursor = this.isCursor(sector.lot.id);

            this.ctx.beginPath();
            this.ctx.moveTo(0, 0);
            this.ctx.arc(0, 0, radius, sector.startAngle, sector.endAngle);
            this.ctx.closePath();

            this.ctx.globalAlpha = presence;
            this.ctx.fillStyle = cursor
                ? brightenColor(sector.lot.color, CURSOR_HIGHLIGHT_BRIGHTNESS)
                : sector.lot.color;
            this.ctx.fill();

            this.ctx.strokeStyle = SECTOR_STROKE;
            this.ctx.lineWidth = SECTOR_STROKE_WIDTH;
            this.ctx.stroke();
            this.ctx.globalAlpha = 1;

            if (sector.endAngle - sector.startAngle > LABEL_MIN_ARC) {
                this.drawWheelLabel(sector, radius, presence);
            }
        }

        // Lot accents: overlay on top of every sector (as hover below), so a
        // neighbouring sector's border or label cannot cover them. Only a fill
        // tint + outline are added — the sector geometry is never touched.
        for (const sector of this.sectors) {
            const accent = this.accentVisual(sector.lot.id);
            if (!accent || accent.alpha <= 0) continue;
            const alpha = this.presenceOf(sector.lot.id) * accent.alpha;

            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.moveTo(0, 0);
            this.ctx.arc(0, 0, radius, sector.startAngle, sector.endAngle);
            this.ctx.closePath();
            this.ctx.globalAlpha = alpha * ACCENT_FILL_ALPHA;
            this.ctx.fillStyle = accent.color;
            this.ctx.shadowColor = accent.color;
            this.ctx.shadowBlur = ACCENT_FILL_GLOW_BLUR;
            this.ctx.fill();

            this.ctx.globalAlpha = alpha;
            this.ctx.strokeStyle = accent.color;
            this.ctx.lineWidth = accent.strokeWidth;
            this.ctx.shadowBlur = ACCENT_GLOW_BLUR;
            this.ctx.stroke();
            this.ctx.restore();
        }

        // Hover is drawn last, on top of every sector, so a neighbouring
        // sector's border cannot cover any of its edges: a translucent glow
        // fill plus a crisp outline over the full sector (both radii + arc).
        const hovered = this.sectors.find(s => this.isHovered(s.lot.id));
        if (hovered) {
            // Translucent glow fill.
            this.ctx.beginPath();
            this.ctx.moveTo(0, 0);
            this.ctx.arc(0, 0, radius, hovered.startAngle, hovered.endAngle);
            this.ctx.closePath();
            this.ctx.save();
            this.ctx.fillStyle = HOVER_FILL_COLOR;
            this.ctx.shadowColor = HOVER_COLOR;
            this.ctx.shadowBlur = HOVER_FILL_GLOW_BLUR;
            this.ctx.fill();
            this.ctx.restore();

            // Crisp outline over the whole sector.
            this.ctx.beginPath();
            this.ctx.moveTo(0, 0);
            this.ctx.arc(0, 0, radius, hovered.startAngle, hovered.endAngle);
            this.ctx.closePath();
            this.ctx.save();
            this.ctx.strokeStyle = HOVER_COLOR;
            this.ctx.lineWidth = HOVER_STROKE_WIDTH;
            this.ctx.shadowColor = HOVER_COLOR;
            this.ctx.shadowBlur = HOVER_GLOW_BLUR;
            this.ctx.stroke();
            this.ctx.restore();
        }

        this.ctx.restore();

        this.drawPointer(centerX, centerY);
        this.drawOuterRing(centerX, centerY, radius);
    }

    computeSpinTarget(rolledLotId: string, durationMs: number): number {
        const sector = this.sectors.find(s => s.lot.id === rolledLotId);
        if (!sector) return this.animationValue;
        return RouletteEngine.computeFinalRotation(
            sector.startAngle,
            sector.endAngle,
            this.animationValue,
            durationMs
        );
    }

    getCursorLotId(animationValue: number): string | null {
        // The cursor follows the drawn (visualValue-based) geometry: the sector
        // whose drawn arc sits under the top pointer.
        if (this.sectors.length === 0) return null;

        // A sector at angle θ appears at θ + R. It sits under the top pointer
        // (−π/2) when θ ≡ −π/2 − R (mod 2π).
        let local = (-Math.PI / 2 - animationValue) % TAU;
        if (local < 0) local += TAU;

        for (const sector of this.sectors) {
            if (local >= sector.startAngle && local < sector.endAngle) return sector.lot.id;
        }
        return this.sectors[this.sectors.length - 1].lot.id;
    }

    private drawWheelLabel(sector: WheelSector, radius: number, presence: number): void {
        const midAngle = (sector.startAngle + sector.endAngle) / 2;
        const textRadius = radius * LABEL_RADIUS_RATIO;

        this.ctx.save();
        this.ctx.globalAlpha = presence;
        this.ctx.translate(Math.cos(midAngle) * textRadius, Math.sin(midAngle) * textRadius);
        this.ctx.rotate(midAngle);

        this.ctx.fillStyle = '#fff';
        this.ctx.font = LABEL_FONT;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        const displayName = sector.lot.name.length > LABEL_MAX_CHARS
            ? sector.lot.name.substring(0, LABEL_TRUNCATED_CHARS) + '..'
            : sector.lot.name;

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
