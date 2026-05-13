import { Lot, ModeConfig, VisualizationType } from './types.js';
import { RouletteEngine } from './rouletteEngine.js';

/**
 * Interface for visualization-specific position computation strategies.
 */
export interface IVisualizationStrategy {
    /**
     * Computes the final position (rotation angle or scroll offset) for animation.
     * 
     * @param lots - Active lots in the roulette
     * @param modeConfig - Current game mode configuration
     * @param targetLotId - ID of the winning lot to animate toward
     * @param currentPosition - Current rotation/scroll position
     * @param animationDurationMs - Duration of animation in milliseconds
     * @param canvasWidth - Canvas width (required for strip visualization)
     * @returns Final position value for animation end point
     */
    computeFinalPosition(
        lots: Lot[],
        modeConfig: ModeConfig,
        targetLotId: string,
        currentPosition: number,
        animationDurationMs: number,
        canvasWidth?: number
    ): number;
}

/**
 * Strategy for wheel visualization - computes rotation angle.
 */
export class WheelVisualizationStrategy implements IVisualizationStrategy {
    computeFinalPosition(
        lots: Lot[],
        modeConfig: ModeConfig,
        targetLotId: string,
        currentPosition: number,
        animationDurationMs: number
    ): number {
        return RouletteEngine.computeFinalRotation(
            lots,
            modeConfig,
            targetLotId,
            currentPosition,
            animationDurationMs
        );
    }
}

/**
 * Strategy for strip visualization - computes scroll offset.
 */
export class StripVisualizationStrategy implements IVisualizationStrategy {
    computeFinalPosition(
        lots: Lot[],
        modeConfig: ModeConfig,
        targetLotId: string,
        currentPosition: number,
        animationDurationMs: number,
        canvasWidth: number
    ): number {
        if (canvasWidth === undefined) {
            throw new Error('Canvas width is required for strip visualization');
        }
        
        return RouletteEngine.computeFinalScrollOffset(
            lots,
            modeConfig,
            targetLotId,
            currentPosition,
            animationDurationMs,
            canvasWidth
        );
    }
}

/**
 * Factory function to get the appropriate strategy for a visualization type.
 */
export function getVisualizationStrategy(type: VisualizationType): IVisualizationStrategy {
    switch (type) {
        case 'wheel':
            return new WheelVisualizationStrategy();
        case 'strip':
            return new StripVisualizationStrategy();
        default:
            throw new Error(`Unknown visualization type: ${type}`);
    }
}
