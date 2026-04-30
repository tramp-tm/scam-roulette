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
     * Calculates the final rotation angle for animation.
     * 
     * For wheel: Rotates so winning segment ends at pointer (top = -PI/2)
     * For strip: Scrolls so winning item centers on screen
     */
    static calculateFinalAngle(
        lots: Lot[], 
        mode: Mode, 
        targetLotId: string,
        numSpins: number,
        visualization: 'wheel' | 'strip'
    ): number {
        const segments = this.calculateSegments(lots, mode);
        
        // Find the target segment
        let targetSegmentStart = 0;
        let targetSegmentEnd = 0;
        
        for (const segment of segments) {
            if (segment.lot.id === targetLotId) {
                targetSegmentStart = segment.startAngle;
                targetSegmentEnd = segment.endAngle;
                break;
            }
        }

        const segmentCenter = (targetSegmentStart + targetSegmentEnd) / 2;

        if (visualization === 'wheel') {
            // For wheel: pointer is at top (-PI/2 or 3*PI/2)
            // We need to rotate so the segment center aligns with -PI/2
            const pointerAngle = -Math.PI / 2;
            
            // Calculate rotation needed (negative because we rotate the wheel, not the pointer)
            let rotation = pointerAngle - segmentCenter;
            
            // Add full spins for visual effect
            rotation -= numSpins * Math.PI * 2;
            
            return rotation;
        } else {
            // For strip: center of screen is the target
            // Calculate position to scroll (negative for leftward scroll)
            const segmentWidth = segments.length > 0 ? Math.PI * 2 : 1;
            let scrollPosition = -segmentCenter * 100; // Scale factor for visual effect
            
            // Add extra distance for animation
            scrollPosition -= numSpins * 500;
            
            return scrollPosition;
        }
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
