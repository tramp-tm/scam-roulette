import type { Lot, GameMode } from './types.js';
import { getRandomPositionInRange, getSegmentWidth } from './utils.js';

/**
 * Core roulette engine that handles weighted random selection.
 * 
 * CRITICAL: The result is determined BEFORE animation starts.
 * Animation does NOT affect the result.
 */
export class RouletteEngine {
    /**
     * Performs weighted random selection using cumulative distribution approach.
     * Uses mode-specific weight calculation from GameMode.
     */
    static roll(lots: Lot[], mode: GameMode): Lot | null {
        if (lots.length === 0) return null;
        
        // Calculate weights for all lots using mode's calculateWeight function
        const weightedLots = lots.map(lot => ({
            lot,
            weight: mode.calculateWeight(lot, lots)
        }));

        // Calculate total weight
        const totalWeight = weightedLots.reduce((sum, item) => sum + item.weight, 0);

        if (totalWeight <= 0) return null;

        // Generate random number in range [0, totalWeight)
        let randomValue = Math.random() * totalWeight;

        // Find the selected lot using cumulative distribution
        for (const { lot, weight } of weightedLots) {
            if (randomValue < weight) {
                return lot;
            }
            randomValue -= weight;
        }

        // Fallback (should never reach here with correct math)
        return weightedLots[weightedLots.length - 1].lot;
    }

    /**
     * Calculates all segments for rendering.
     */
    static calculateSegments(lots: Lot[], mode: GameMode): { lot: Lot; startAngle: number; endAngle: number; weight: number }[] {
        const weightedLots = lots.map(lot => ({
            lot,
            weight: mode.calculateWeight(lot, lots)
        }));

        const totalWeight = weightedLots.reduce((sum, item) => sum + item.weight, 0);
        
        if (totalWeight <= 0) return [];

        const segments: { lot: Lot; startAngle: number; endAngle: number; weight: number }[] = [];
        let cumulativeWeight = 0;

        for (const { lot, weight } of weightedLots) {
            const normalizedWeight = weight / totalWeight;
            const segmentStart = cumulativeWeight * Math.PI * 2;
            const segmentEnd = (cumulativeWeight + normalizedWeight) * Math.PI * 2;

            segments.push({
                lot,
                startAngle: segmentStart,
                endAngle: segmentEnd,
                weight: normalizedWeight
            });

            cumulativeWeight += normalizedWeight;
        }

        return segments;
    }

    /**
     * Computes the final rotation angle for animation.
     *
     * CRITICAL: The pointer is fixed at the TOP of the wheel (angle = -π/2).
     * When the wheel rotates by R, a segment at angle θ moves to θ + R.
     * For the pointer to point to a segment center: segmentCenter + finalRotation ≡ -π/2 (mod 2π)
     * Therefore: finalRotation = -π/2 - segmentCenter + fullRotations
     */
    static computeFinalRotation(
        lots: Lot[],
        mode: GameMode,
        targetLotId: string,
        currentRotation: number,
        animationDurationMs: number
    ): number {
        const segments = this.calculateSegments(lots, mode);
        
        // Find winning segment
        const segment = segments.find(s => s.lot.id === targetLotId);
        if (!segment) return currentRotation;

        // POINTER POSITION: Fixed at TOP of wheel = angle -π/2 (or equivalently 3π/2)
        const pointerAngle = -Math.PI / 2;
        
        // 1. Pick random point inside the segment for landing position
        const segmentSpan = segment.endAngle - segment.startAngle;
        const randomOffset = getRandomPositionInRange(segmentSpan, 0.02, 0.04);
        
        // Target angle within the winning segment
        const targetSegmentAngle = segment.startAngle + randomOffset;
        
        // 2. Calculate base rotation needed to bring target under pointer
        // Formula: finalRotation ≡ pointerAngle - targetSegmentAngle (mod 2π)
        let baseRotation = pointerAngle - targetSegmentAngle;
        
        // 3. Add full rotations to ensure smooth forward spin from current position
        const minSpinsPerSecond = 2;
        const maxSpinsPerSecond = 5;
        const durationSeconds = Math.max(0.5, animationDurationMs / 1000);
        const minFullRotations = Math.floor(minSpinsPerSecond * durationSeconds);
        const maxFullRotations = Math.ceil(maxSpinsPerSecond * durationSeconds);
        
        // Find the smallest number of full rotations that puts us ahead of current rotation
        let totalRotation = baseRotation;
        while (totalRotation <= currentRotation) {
            totalRotation += Math.PI * 2;
        }
        
        // Add extra random full rotations for visual effect
        const extraRotations = 
            Math.floor(Math.random() * (maxFullRotations - minFullRotations + 1)) + minFullRotations;
        totalRotation += extraRotations * Math.PI * 2;

        return totalRotation;
    }

    /**
     * Validates that we have enough active lots to spin.
     */
    static canSpin(activeLots: Lot[]): boolean {
        return activeLots.length >= 1;
    }

    /**
     * Computes the final scroll offset for strip visualization.
     * 
     * The strip renders lots in an infinite repeating cycle. This method calculates
     * the horizontal scroll position that brings the winning lot under the center pointer.
     */
    static computeFinalScrollOffset(
        lots: Lot[],
        mode: GameMode,
        targetLotId: string,
        currentOffset: number,
        animationDurationMs: number,
        canvasWidth: number
    ): number {
        const segments = this.calculateSegments(lots, mode);
        
        // Calculate total width of one complete cycle
        let totalCycleWidth = 0;
        for (const segment of segments) {
            totalCycleWidth += getSegmentWidth(segment.weight);
        }

        if (totalCycleWidth === 0) return currentOffset;

        // Find target lot's position within one cycle
        let cumulativeWidth = 0;
        
        for (const segment of segments) {
            const segmentWidth = getSegmentWidth(segment.weight);
            
            if (segment.lot.id === targetLotId) {
                // Pick random point within this lot's width (with margin from edges)
                const randomOffset = getRandomPositionInRange(segmentWidth, 0.02, 3);
                
                // Target position within the cycle where this lot should land under center pointer
                const targetPositionInCycle = cumulativeWidth + randomOffset;
                
                // Calculate base scroll offset to bring target under center pointer
                const centerX = canvasWidth / 2;
                let baseOffset = targetPositionInCycle - centerX;
                
                // Add full cycles to ensure smooth forward scroll from current position
                while (baseOffset <= currentOffset) {
                    baseOffset += totalCycleWidth;
                }
                
                // Add extra cycles based on duration for visual effect
                const minCyclesPerSecond = 2;
                const maxCyclesPerSecond = 5;
                const durationSeconds = Math.max(0.5, animationDurationMs / 1000);
                const minFullCycles = Math.floor(minCyclesPerSecond * durationSeconds);
                const maxFullCycles = Math.ceil(maxCyclesPerSecond * durationSeconds);
                
                // Add random extra cycles for visual variety
                const extraCycles = 
                    Math.floor(Math.random() * (maxFullCycles - minFullCycles + 1)) + minFullCycles;
                baseOffset += extraCycles * totalCycleWidth;

                return baseOffset;
            }
            
            cumulativeWidth += segmentWidth;
        }

        // Fallback if target not found
        return currentOffset;
    }

    /**
     * Computes the final counting position for the counting-rhyme visualization.
     *
     * Model:
     *   - `currentPosition` and the return value are measured in *cycles*.
     *   - One cycle spans the unit interval [0, 1) partitioned by the
     *     normalized Segment.weight prefix sums. Therefore one full traversal
     *     shows each circle for exactly w_i of a cycle.
     *   - The engine returns a value `endValue` such that
     *         endValue ≡ targetMid (mod 1),  targetMid = P_i + w_i / 2,
     *     which guarantees the last animated frame — the one produced by
     *     AnimationController's `onUpdate(endValue, 1)` *before* `onComplete()` —
     *     highlights the rolled lot (see animation.ts).
     *   - Forward motion only. Extra full cycles are added so the animation is
     *     visible for very short durations and does not grow unboundedly for
     *     long ones.
     *
     * Note: no canvasWidth parameter — the circle layout is the renderer's
     * responsibility, and the sequence position math in cycle space does not
     * depend on pixel dimensions.
     */
    static computeFinalCountingPosition(
        lots: Lot[],
        mode: GameMode,
        targetLotId: string,
        currentPosition: number,
        animationDurationMs: number
    ): number {
        const segments = this.calculateSegments(lots, mode);
        if (segments.length === 0) return currentPosition;

        // Prefix sums of normalized weights.
        const prefix: number[] = [0];
        for (const s of segments) {
            prefix.push(prefix[prefix.length - 1] + s.weight);
        }

        const targetIdx = segments.findIndex(s => s.lot.id === targetLotId);
        if (targetIdx === -1) return currentPosition;

        const targetWeight = segments[targetIdx].weight;
        const targetMid = prefix[targetIdx] + targetWeight / 2;

        // Forward motion only. The smallest reachable position with the right
        // fractional value that is strictly greater than the current one.
        let endValue = targetMid;
        while (endValue <= currentPosition) {
            endValue += 1;
        }

        // Scale the extra traversal count with the configured duration so
        // behaviour stays manageable across the 1 s – 60 s+ range. The
        // constant is in cycles per second and independent of lot count.
        const durationSeconds = Math.max(0.5, animationDurationMs / 1000);
        const extraCycles = Math.max(2, Math.round(durationSeconds * 2));
        endValue += extraCycles;

        return endValue;
    }
}
