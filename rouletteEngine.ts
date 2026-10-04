import type { Lot, WeightedLot } from './types.js';
import { getRandomPositionInRange, getSegmentWidth } from './utils.js';

/**
 * Segment of a roulette-style visualization, produced by `calculateSegments()`.
 * `weight` is normalized (0–1); angles are in radians and total 2π across
 * the full segment set.
 */
export interface Segment {
    lot: Lot;
    startAngle: number;
    endAngle: number;
    weight: number;
}

/**
 * Core roulette engine: weighted random selection plus the geometry used by
 * the roulette-style visualizations (wheel / strip / counting-rhyme).
 *
 * The engine is mode-agnostic: it receives pre-computed weights
 * (`WeightedLot[]`) and never references a GameMode, elimination, winner or
 * completion. Roulette-specific animation math is an internal detail of the
 * visualizations that call into these helpers.
 *
 * CRITICAL: the result is determined BEFORE animation starts; animation
 * never affects the outcome.
 */
export class RouletteEngine {
    /**
     * Weighted random selection over pre-computed weights using the
     * cumulative-distribution approach. Returns the chosen entry, or null
     * when there are no entries or the total weight is not positive.
     */
    static rollWeighted(entries: readonly WeightedLot[]): WeightedLot | null {
        if (entries.length === 0) return null;

        const totalWeight = entries.reduce((sum, item) => sum + item.weight, 0);
        if (!(totalWeight > 0)) return null;

        let randomValue = Math.random() * totalWeight;
        for (const entry of entries) {
            if (randomValue < entry.weight) return entry;
            randomValue -= entry.weight;
        }

        // Fallback (floating-point rounding at the very top of the range).
        return entries[entries.length - 1];
    }

    /** True when there is at least one participant to spin. */
    static canSpin(activeCount: number): boolean {
        return activeCount >= 1;
    }

    /**
     * Normalizes weights so they sum to 1 and lays them out over the angles
     * [0, 2π). Entries with a non-positive weight are dropped so a
     * zero-weight participant contributes no sector. Used by every
     * roulette-style renderer and by the animation math below — a single
     * source of geometry.
     */
    static calculateSegments(entries: readonly WeightedLot[]): Segment[] {
        const totalWeight = entries.reduce((sum, item) => sum + item.weight, 0);
        if (!(totalWeight > 0)) return [];

        const segments: Segment[] = [];
        let cumulativeWeight = 0;

        for (const entry of entries) {
            if (!(entry.weight > 0)) continue;

            const normalizedWeight = entry.weight / totalWeight;
            const segmentStart = cumulativeWeight * Math.PI * 2;
            const segmentEnd = (cumulativeWeight + normalizedWeight) * Math.PI * 2;

            segments.push({
                lot: entry.lot,
                startAngle: segmentStart,
                endAngle: segmentEnd,
                weight: normalizedWeight
            });

            cumulativeWeight += normalizedWeight;
        }

        return segments;
    }

    /**
     * Computes the final rotation angle for the wheel.
     *
     * The pointer is fixed at the TOP of the wheel (angle = -π/2). When the
     * wheel rotates by R, a segment at angle θ moves to θ + R. A random point
     * inside the target segment (with an edge margin) is chosen as the landing
     * position, so the pointer never lands exactly on a boundary; then full
     * rotations are added so the wheel always turns forward.
     */
    static computeFinalRotation(
        segments: readonly Segment[],
        targetLotId: string,
        currentRotation: number,
        animationDurationMs: number
    ): number {
        const segment = segments.find(s => s.lot.id === targetLotId);
        if (!segment) return currentRotation;

        const pointerAngle = -Math.PI / 2;

        // 1. Pick a random point inside the segment for the landing position.
        const segmentSpan = segment.endAngle - segment.startAngle;
        const randomOffset = getRandomPositionInRange(segmentSpan, 0.02, 0.04);
        const targetSegmentAngle = segment.startAngle + randomOffset;

        // 2. Base rotation to bring the target under the pointer.
        let baseRotation = pointerAngle - targetSegmentAngle;

        // 3. Forward-only full rotations, scaled by duration.
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
     * Computes the final scroll offset for the strip. The strip renders lots
     * in an infinite repeating cycle; this returns the horizontal offset that
     * brings a random point inside the winning lot under the centre pointer,
     * always scrolling forward, plus extra cycles scaled by duration.
     */
    static computeFinalScrollOffset(
        segments: readonly Segment[],
        targetLotId: string,
        currentOffset: number,
        animationDurationMs: number,
        canvasWidth: number
    ): number {
        let totalCycleWidth = 0;
        for (const segment of segments) {
            totalCycleWidth += getSegmentWidth(segment.weight);
        }
        if (totalCycleWidth === 0) return currentOffset;

        let cumulativeWidth = 0;
        for (const segment of segments) {
            const segmentWidth = getSegmentWidth(segment.weight);

            if (segment.lot.id === targetLotId) {
                const randomOffset = getRandomPositionInRange(segmentWidth, 0.02, 3);
                const targetPositionInCycle = cumulativeWidth + randomOffset;

                const centerX = canvasWidth / 2;
                let baseOffset = targetPositionInCycle - centerX;

                while (baseOffset <= currentOffset) {
                    baseOffset += totalCycleWidth;
                }

                const minCyclesPerSecond = 2;
                const maxCyclesPerSecond = 5;
                const durationSeconds = Math.max(0.5, animationDurationMs / 1000);
                const minFullCycles = Math.floor(minCyclesPerSecond * durationSeconds);
                const maxFullCycles = Math.ceil(maxCyclesPerSecond * durationSeconds);

                const extraCycles =
                    Math.floor(Math.random() * (maxFullCycles - minFullCycles + 1)) + minFullCycles;
                baseOffset += extraCycles * totalCycleWidth;

                return baseOffset;
            }

            cumulativeWidth += segmentWidth;
        }

        return currentOffset;
    }

    /**
     * Computes the final counting position for the counting-rhyme
     * visualization.
     *
     * `currentPosition` and the return value are measured in *cycles*: one
     * cycle spans [0, 1) partitioned by the normalized prefix sums, so one
     * traversal shows each circle for exactly w_i of a cycle. The returned
     * value satisfies `endValue ≡ targetMid (mod 1)`, guaranteeing the last
     * animated frame highlights the rolled lot. Forward motion only; extra
     * cycles scale with duration. No canvasWidth — the circle layout is the
     * renderer's responsibility and cycle-space math is pixel-independent.
     */
    static computeFinalCountingPosition(
        segments: readonly Segment[],
        targetLotId: string,
        currentPosition: number,
        animationDurationMs: number
    ): number {
        if (segments.length === 0) return currentPosition;

        const prefix: number[] = [0];
        for (const s of segments) {
            prefix.push(prefix[prefix.length - 1] + s.weight);
        }

        const targetIdx = segments.findIndex(s => s.lot.id === targetLotId);
        if (targetIdx === -1) return currentPosition;

        const targetWeight = segments[targetIdx].weight;
        const targetMid = prefix[targetIdx] + targetWeight / 2;

        let endValue = targetMid;
        while (endValue <= currentPosition) {
            endValue += 1;
        }

        const durationSeconds = Math.max(0.5, animationDurationMs / 1000);
        const extraCycles = Math.max(2, Math.round(durationSeconds * 2));
        endValue += extraCycles;

        return endValue;
    }
}
