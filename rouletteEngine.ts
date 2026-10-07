import type { SelectionCandidate } from './types.js';
import { getRandomPositionInRange } from './utils.js';

/**
 * Roulette mechanics: weighted selection plus the spin-target math for
 * roulette-style animations.
 *
 * The engine is fully mode- and geometry-agnostic:
 *  - selection uses ONLY each candidate's `selectionWeight` (a probability);
 *  - the spin-target helpers receive the geometry facts (angles / widths /
 *    a cycle fraction) that a renderer computed from *its own* presentation
 *    geometry. The engine never derives a visual size from any weight, and
 *    knows nothing about `yValue`, `zValue`, `modeData`, HP, `Normal`, `Survival`
 *    or any concrete GameMode.
 *
 * CRITICAL: the result is determined BEFORE animation starts; animation never
 * affects the outcome.
 */
export class RouletteEngine {
    /**
     * Weighted random selection over pre-computed selection weights using the
     * cumulative-distribution approach. Returns the chosen candidate, or null
     * when there are no candidates or the total weight is not positive.
     */
    static rollWeighted(
        candidates: readonly SelectionCandidate[]
    ): SelectionCandidate | null {
        if (candidates.length === 0) return null;

        const totalWeight = candidates.reduce((sum, c) => sum + c.selectionWeight, 0);
        if (!(totalWeight > 0)) return null;

        let randomValue = Math.random() * totalWeight;
        for (const candidate of candidates) {
            if (randomValue < candidate.selectionWeight) return candidate;
            randomValue -= candidate.selectionWeight;
        }

        // Fallback (floating-point rounding at the very top of the range).
        return candidates[candidates.length - 1];
    }

    /** True when there is at least one participant to spin. */
    static canSpin(activeCount: number): boolean {
        return activeCount >= 1;
    }

    /**
     * Final rotation angle for the wheel.
     *
     * The pointer is fixed at the TOP of the wheel (angle = -π/2). When the
     * wheel rotates by R, a sector at angle θ moves to θ + R. A random point
     * inside the target sector [startAngle, endAngle] (with an edge margin) is
     * chosen as the landing position, then full rotations are added so the
     * wheel always turns forward.
     */
    static computeFinalRotation(
        targetStartAngle: number,
        targetEndAngle: number,
        currentRotation: number,
        animationDurationMs: number
    ): number {
        const pointerAngle = -Math.PI / 2;

        const span = targetEndAngle - targetStartAngle;
        const randomOffset = getRandomPositionInRange(span, 0.02, 0.04);
        const targetAngle = targetStartAngle + randomOffset;

        let baseRotation = pointerAngle - targetAngle;

        const minSpinsPerSecond = 2;
        const maxSpinsPerSecond = 5;
        const durationSeconds = Math.max(0.5, animationDurationMs / 1000);
        const minFullRotations = Math.floor(minSpinsPerSecond * durationSeconds);
        const maxFullRotations = Math.ceil(maxSpinsPerSecond * durationSeconds);

        let totalRotation = baseRotation;
        while (totalRotation <= currentRotation) {
            totalRotation += Math.PI * 2;
        }

        const extraRotations =
            Math.floor(Math.random() * (maxFullRotations - minFullRotations + 1)) + minFullRotations;
        totalRotation += extraRotations * Math.PI * 2;

        return totalRotation;
    }

    /**
     * Final scroll offset for the strip. `targetStartInCycle` / `targetSpan`
     * are pixel positions within one cycle supplied by the renderer;
     * `cycleWidth` is the full cycle width. Returns an offset that lands a
     * random point inside the target band under the centre pointer, always
     * scrolling forward, plus extra cycles scaled by duration.
     */
    static computeFinalScrollOffset(
        targetStartInCycle: number,
        targetSpan: number,
        cycleWidth: number,
        currentOffset: number,
        animationDurationMs: number,
        canvasWidth: number
    ): number {
        if (cycleWidth === 0) return currentOffset;

        const randomOffset = getRandomPositionInRange(targetSpan, 0.02, 3);
        const targetPositionInCycle = targetStartInCycle + randomOffset;

        const centerX = canvasWidth / 2;
        let baseOffset = targetPositionInCycle - centerX;

        while (baseOffset <= currentOffset) {
            baseOffset += cycleWidth;
        }

        const minCyclesPerSecond = 2;
        const maxCyclesPerSecond = 5;
        const durationSeconds = Math.max(0.5, animationDurationMs / 1000);
        const minFullCycles = Math.floor(minCyclesPerSecond * durationSeconds);
        const maxFullCycles = Math.ceil(maxCyclesPerSecond * durationSeconds);

        const extraCycles =
            Math.floor(Math.random() * (maxFullCycles - minFullCycles + 1)) + minFullCycles;
        baseOffset += extraCycles * cycleWidth;

        return baseOffset;
    }

    /**
     * Final counting position for the counting-rhyme visualization.
     *
     * `currentPosition` and the return value are measured in *cycles*.
     * `targetMidFraction` is the target's midpoint in cycle space (fraction of
     * one traversal), supplied by the renderer from its own partition. The
     * returned value satisfies `endValue ≡ targetMidFraction (mod 1)`, so the
     * last animated frame highlights the target. Forward motion only; extra
     * cycles scale with duration.
     */
    static computeFinalCountingPosition(
        targetMidFraction: number,
        currentPosition: number,
        animationDurationMs: number
    ): number {
        let endValue = targetMidFraction;
        while (endValue <= currentPosition) {
            endValue += 1;
        }

        const durationSeconds = Math.max(0.5, animationDurationMs / 1000);
        const extraCycles = Math.max(2, Math.round(durationSeconds * 2));
        endValue += extraCycles;

        return endValue;
    }
}
