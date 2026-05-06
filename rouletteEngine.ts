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

        // DEBUG: Log wheel state before spin
        console.group('🎡 Wheel State Before Spin');
        console.log(`Current rotation: ${currentRotation.toFixed(6)} rad (${(currentRotation * 180 / Math.PI).toFixed(2)}°)`);
        console.log(`Target lot: "${segment.lot.name}" (amount: $${segment.lot.amount})`);
        console.log(`Segment angles: start=${segment.startAngle.toFixed(4)} rad, end=${segment.endAngle.toFixed(4)} rad`);
        console.log(`Segment span: ${(segment.endAngle - segment.startAngle).toFixed(4)} rad (${((segment.endAngle - segment.startAngle) * 180 / Math.PI).toFixed(2)}°)`);
        
        // Log all segments for debugging
        console.table(segments.map((s, i) => ({
            index: i,
            name: s.lot.name,
            amount: s.lot.amount,
            startAngle: s.startAngle.toFixed(4),
            endAngle: s.endAngle.toFixed(4),
            spanDeg: ((s.endAngle - s.startAngle) * 180 / Math.PI).toFixed(2),
            isTarget: s.lot.id === targetLotId ? '✓' : ''
        })));
        console.groupEnd();

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

        // DEBUG: Log computed rotation details
        console.group('🔄 Rotation Calculation');
        console.log(`Pointer angle (top): ${pointerAngle.toFixed(4)} rad (${(pointerAngle * 180 / Math.PI).toFixed(2)}°)`);
        console.log(`Target segment angle: ${targetSegmentAngle.toFixed(6)} rad (${(targetSegmentAngle * 180 / Math.PI).toFixed(2)}°)`);
        console.log(`Base rotation (pointer - target): ${baseRotation.toFixed(6)} rad`);
        console.log(`Extra rotations added: ${extraRotations}`);
        console.log(`Total final rotation: ${totalRotation.toFixed(6)} rad (${(totalRotation * 180 / Math.PI).toFixed(2)}°)`);
        
        // Verify alignment
        const normalizedFinal = totalRotation % (Math.PI * 2);
        const angleUnderPointer = (targetSegmentAngle + totalRotation) % (Math.PI * 2);
        console.log(`\n📐 VERIFICATION:`);
        console.log(`  targetSegmentAngle + finalRotation = ${(angleUnderPointer).toFixed(6)} rad`);
        console.log(`  Expected (pointer at top): ${pointerAngle.toFixed(6)} rad or ${(pointerAngle + Math.PI * 2).toFixed(6)} rad`);
        const diff = Math.abs(((angleUnderPointer - pointerAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
        console.log(`  Difference from pointer: ${diff.toFixed(6)} rad (${(diff * 180 / Math.PI).toFixed(4)}°)`);
        console.groupEnd();

        return totalRotation;
    }

    /**
     * Validates that we have enough active lots to spin.
     */
    static canSpin(activeLots: Lot[]): boolean {
        return activeLots.length >= 1;
    }
}
