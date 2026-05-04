import { Lot, Mode } from './types';

/**
 * Core roulette engine that handles weighted random selection.
 * 
 * CRITICAL: The result is determined BEFORE animation starts.
 * Animation does NOT affect the result.
 */
export class RouletteEngine {
    /**
     * Calculates the weight for a lot based on the mode.
     * 
     * Normal mode: weight = amount
     * Survival mode: weight = 1 / amount (inverse - lower amounts have higher chance)
     */
    static calculateWeight(lot: Lot, mode: Mode): number {
        if (mode === 'survival') {
            // In survival mode, lots with smaller amounts have higher probability of being eliminated
            return 1 / lot.amount;
        }
        // Normal mode: weight equals amount
        return lot.amount;
    }

    /**
     * Performs weighted random selection using the alias method for O(1) selection.
     * 
     * This implementation uses a simple but correct cumulative distribution approach
     * that guarantees proper probability distribution without bias.
     */
    static selectWeighted(lots: Lot[], mode: Mode): Lot | null {
        if (lots.length === 0) return null;
        
        // Calculate weights for all lots
        const weightedLots = lots.map(lot => ({
            lot,
            weight: this.calculateWeight(lot, mode)
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
        mode: Mode, 
        targetLotId: string
    ): number {
        const weightedLots = lots.map(lot => ({
            lot,
            weight: this.calculateWeight(lot, mode)
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
    static calculateSegments(lots: Lot[], mode: Mode): { lot: Lot; startAngle: number; endAngle: number; weight: number }[] {
        const weightedLots = lots.map(lot => ({
            lot,
            weight: this.calculateWeight(lot, mode)
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
     * - Selects a random landing point within the winning lot's segment (not necessarily center).
     * - Randomizes full rotations proportional to animation duration (e.g., 2–10 spins per second).
     * - Ensures smooth deceleration by computing total delta from current rotation.
     */
    static computeFinalRotation(
        lots: Lot[],
        mode: Mode,
        targetLotId: string,
        currentRotation: number,
        animationDurationMs: number
    ): number {
        const segments = this.calculateSegments(lots, mode);
        
        // Find winning segment
        const segment = segments.find(s => s.lot.id === targetLotId);
        if (!segment) return currentRotation;

        // 1. Pick random point inside the segment (±10% margin from center)
        const segmentSpan = segment.endAngle - segment.startAngle;
        const margin = segmentSpan * 0.1; // allow ±10% deviation from center
        const minOffset = margin;
        const maxOffset = segmentSpan - margin;
        const randomOffset = Math.random() * (maxOffset - minOffset) + minOffset;
        const targetSegmentAngle = segment.startAngle + randomOffset;

        // 2. Normalize current rotation to [0, 2π)
        const normalizedCurrent = ((currentRotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

        // 3. Compute delta to reach targetSegmentAngle from current
        let deltaToTarget = targetSegmentAngle - normalizedCurrent;
        if (deltaToTarget < 0) deltaToTarget += Math.PI * 2;

        // 4. Randomize full spins: 0.2–5 per second of animation
        const minSpinsPerSecond = 0.2;
        const maxSpinsPerSecond = 5;
        const durationSeconds = Math.max(0.5, animationDurationMs / 1000);
        const minFullRotations = Math.floor(minSpinsPerSecond * durationSeconds);
        const maxFullRotations = Math.ceil(maxSpinsPerSecond * durationSeconds);
        const randomFullRotations =
            (Math.floor(Math.random() * (maxFullRotations - minFullRotations + 1)) + minFullRotations) *
            Math.PI * 2;

        // 5. Final rotation = current + full spins + delta to target
        // This ensures we always move forward and don't wrap around incorrectly
        return currentRotation + randomFullRotations + deltaToTarget;
    }

    /**
     * Validates that we have enough active lots to spin.
     */
    static canSpin(activeLots: Lot[]): boolean {
        return activeLots.length >= 1;
    }

    /**
     * Checks if survival mode is complete (only one lot remains).
     */
    static isSurvivalComplete(activeLots: Lot[], totalLots: number): boolean {
        return activeLots.length === 1 && totalLots > 1;
    }
}
