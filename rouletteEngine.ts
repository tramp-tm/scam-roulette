import { Lot, ModeConfig, getModeConfig } from './types';

/**
 * Core roulette engine that handles weighted random selection.
 * 
 * CRITICAL: The result is determined BEFORE animation starts.
 * Animation does NOT affect the result.
 */
export class RouletteEngine {
    /**
     * Performs weighted random selection using cumulative distribution approach.
     * Uses mode-specific weight calculation from ModeConfig.
     */
    static selectWeighted(lots: Lot[], modeConfig: ModeConfig): Lot | null {
        if (lots.length === 0) return null;
        
        // Calculate weights for all lots using mode's calculateWeight function
        const weightedLots = lots.map(lot => ({
            lot,
            weight: modeConfig.calculateWeight(lot, lots)
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
     * Calculates the angle/position for a specific lot in the visualization.
     * Returns the center angle of the segment for proper alignment.
     */
    static getSegmentCenterAngle(
        lots: Lot[], 
        modeConfig: ModeConfig, 
        targetLotId: string
    ): number {
        const weightedLots = lots.map(lot => ({
            lot,
            weight: modeConfig.calculateWeight(lot, lots)
        }));

        const totalWeight = weightedLots.reduce((sum, item) => sum + item.weight, 0);
        
        if (totalWeight <= 0) return 0;

        let cumulativeWeight = 0;
        
        for (const { lot, weight } of weightedLots) {
            const normalizedWeight = weight / totalWeight;
            const segmentStart = cumulativeWeight * Math.PI * 2;
            const segmentEnd = (cumulativeWeight + normalizedWeight) * Math.PI * 2;
            
            if (lot.id === targetLotId) {
                // Return center of the segment
                return (segmentStart + segmentEnd) / 2;
            }
            
            cumulativeWeight += normalizedWeight;
        }

        return 0;
    }

    /**
     * Calculates all segments for rendering.
     */
    static calculateSegments(lots: Lot[], modeConfig: ModeConfig): { lot: Lot; startAngle: number; endAngle: number; weight: number }[] {
        const weightedLots = lots.map(lot => ({
            lot,
            weight: modeConfig.calculateWeight(lot, lots)
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
        modeConfig: ModeConfig,
        targetLotId: string,
        currentRotation: number,
        animationDurationMs: number
    ): number {
        const segments = this.calculateSegments(lots, modeConfig);
        
        // Find winning segment
        const segment = segments.find(s => s.lot.id === targetLotId);
        if (!segment) return currentRotation;

        // POINTER POSITION: Fixed at TOP of wheel = angle -π/2 (or equivalently 3π/2)
        const pointerAngle = -Math.PI / 2;
        
        // 1. Pick random point inside the segment for landing position
        const segmentSpan = segment.endAngle - segment.startAngle;
        const margin = Math.min(segmentSpan * 0.15, 0.3); // ±15% margin or max ~17° from edges
        const minOffset = margin;
        const maxOffset = segmentSpan - margin;
        const randomOffset = Math.random() * (maxOffset - minOffset) + minOffset;
        
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
}
