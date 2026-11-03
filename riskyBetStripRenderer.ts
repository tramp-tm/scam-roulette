import type { RiskyBetOutcome } from './riskyBetModel.js';
import { RouletteEngine } from './rouletteEngine.js';

/** Compact, equal-card presentation of an outcome already selected by the domain. */
export class RiskyBetStripRenderer {
    private readonly ctx: CanvasRenderingContext2D;
    private outcomes: readonly RiskyBetOutcome[] = [];
    private width = 0;
    private height = 0;
    private cardWidth = 100;
    private value = 0;
    private destroyed = false;
    private spinning = false;
    private dpr = 1;
    private observer: ResizeObserver | null = null;
    private readonly onResize = (): void => {
        if (this.destroyed || this.spinning) return;
        this.resize();
    };

    constructor(private readonly canvas: HTMLCanvasElement) {
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Risk strip requires a 2D canvas context');
        this.ctx = ctx;
        this.resize();
        if (typeof ResizeObserver !== 'undefined') {
            this.observer = new ResizeObserver(this.onResize);
            this.observer.observe(canvas);
        }
        // Also catches DPR changes and provides the fallback without ResizeObserver.
        window.addEventListener('resize', this.onResize);
    }

    setOutcomes(outcomes: readonly RiskyBetOutcome[]): void {
        if (this.destroyed) return;
        this.outcomes = outcomes.filter(row => row.probability > 0).map(row => ({ ...row }));
        this.reset();
    }

    reset(): void {
        if (this.destroyed) return;
        this.value = 0;
        this.render();
    }

    getAnimationValue(): number { return this.value; }

    setAnimationValue(value: number): void {
        if (this.destroyed) return;
        if (!Number.isFinite(value)) throw new Error('Risk strip animation value must be finite');
        this.value = value;
    }

    computeSpinTarget(outcomeId: string, durationMs: number): number {
        if (this.destroyed) throw new Error('Risk strip is destroyed');
        if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error('Invalid risk spin duration');
        const index = this.outcomes.findIndex(row => row.id === outcomeId);
        if (index < 0) throw new Error('Risk strip outcome not found');
        if (this.width <= 0 || this.height <= 0) throw new Error('Risk strip is not visible');
        return RouletteEngine.computeFinalScrollOffset(index * this.cardWidth, this.cardWidth,
            this.outcomes.length * this.cardWidth, this.value, durationMs, this.width);
    }

    getCursorOutcomeId(): string | null {
        if (!this.outcomes.length || this.width <= 0) return null;
        const index = Math.floor((this.value + this.width / 2) / this.cardWidth);
        return this.outcomes[this.wrapIndex(index)].id;
    }

    render(): void {
        if (this.destroyed || this.width <= 0 || this.height <= 0) return;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);
        ctx.fillStyle = '#161b26';
        ctx.fillRect(0, 0, this.width, this.height);
        if (this.outcomes.length) {
            const first = Math.floor(this.value / this.cardWidth);
            const count = Math.ceil(this.width / this.cardWidth) + 1;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = 'bold 22px sans-serif';
            for (let i = first; i < first + count; i++) {
                const index = this.wrapIndex(i);
                const x = i * this.cardWidth - this.value;
                const row = this.outcomes[index];
                ctx.fillStyle = `hsl(${(index * 137.508) % 360} 48% 30%)`;
                ctx.fillRect(x, 20, this.cardWidth, Math.max(0, this.height - 40));
                ctx.strokeStyle = '#161b26';
                ctx.lineWidth = 3;
                ctx.strokeRect(x, 20, this.cardWidth, Math.max(0, this.height - 40));
                ctx.fillStyle = '#fff';
                ctx.fillText(`x${row.multiplier}`, x + this.cardWidth / 2, this.height / 2, this.cardWidth - 12);
            }
        }
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(this.width / 2, 23);
        ctx.lineTo(this.width / 2 - 8, 7);
        ctx.lineTo(this.width / 2 + 8, 7);
        ctx.closePath();
        ctx.fill();
    }

    setSpinning(spinning: boolean): void {
        if (this.destroyed) return;
        if (!this.spinning) this.resize();
        this.spinning = spinning;
        // Read the latest layout, not a stale ResizeObserver entry. Preserve the
        // final cursor's card and intra-card fraction in the new geometry.
        if (!spinning) this.resize();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.observer?.disconnect();
        this.observer = null;
        window.removeEventListener('resize', this.onResize);
    }

    private resize(): void {
        const { width, height } = this.canvas.getBoundingClientRect();
        if (!(width > 0 && height > 0)) return;
        const dpr = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
            ? window.devicePixelRatio : 1;
        if (width === this.width && height === this.height && dpr === this.dpr) return;
        const cursorPosition = this.width > 0 ? (this.value + this.width / 2) / this.cardWidth : null;
        this.width = width;
        this.height = height;
        this.dpr = dpr;
        this.cardWidth = Math.max(72, Math.min(112, width / 3));
        if (cursorPosition !== null) this.value = cursorPosition * this.cardWidth - width / 2;
        this.canvas.width = Math.max(1, Math.round(width * dpr));
        this.canvas.height = Math.max(1, Math.round(height * dpr));
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.render();
    }

    private wrapIndex(index: number): number {
        return ((index % this.outcomes.length) + this.outcomes.length) % this.outcomes.length;
    }
}
