import { Lot, ModeConfig, VisualizationType, VisualizationPackage } from './types.js';
import { RouletteEngine } from './rouletteEngine.js';
import { WheelRenderer } from './wheelRenderer.js';
import { StripRenderer } from './stripRenderer.js';

/**
 * Bundled visualization package for wheel type.
 */
const WHEEL_PACKAGE: VisualizationPackage = {
    id: 'wheel',
    createRenderer: (canvas) => new WheelRenderer(canvas),
    computeFinalPosition: (lots, modeConfig, targetLotId, currentPosition, duration) => 
        RouletteEngine.computeFinalRotation(lots, modeConfig, targetLotId, currentPosition, duration)
};

/**
 * Bundled visualization package for strip type.
 */
const STRIP_PACKAGE: VisualizationPackage = {
    id: 'strip',
    createRenderer: (canvas) => new StripRenderer(canvas),
    computeFinalPosition: (lots, modeConfig, targetLotId, currentPosition, duration, canvasWidth) => 
        RouletteEngine.computeFinalScrollOffset(lots, modeConfig, targetLotId, currentPosition, duration, canvasWidth!)
};

/**
 * Registry of all visualization packages - single source of truth.
 */
export const VISUALIZATION_PACKAGES = {
    wheel: WHEEL_PACKAGE,
    strip: STRIP_PACKAGE
} as const;

/**
 * Gets the visualization package for a given type.
 * Single object property access - no switch statement needed!
 */
export function getVisualizationPackage(type: VisualizationType): VisualizationPackage {
    return VISUALIZATION_PACKAGES[type];
}
