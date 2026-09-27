import { VisualizationType, VisualizationPackage } from './types.js';
import { RouletteEngine } from './rouletteEngine.js';
import { WheelRenderer } from './wheelRenderer.js';
import { StripRenderer } from './stripRenderer.js';
import { CountingRhymeRenderer } from './countingRhymeRenderer.js';

/**
 * Sole registry of visualization packages.
 *
 * `VISUALIZATION_PACKAGES` (+ `getVisualizationPackage`) is the single
 * authoritative source of truth for "which renderer / which final-position
 * logic corresponds to which visualization". The former `rendererFactory.ts`
 * was removed in Stage 5 as redundant — nothing else constructs a renderer.
 */

/**
 * Bundled visualization package for wheel type.
 */
const WHEEL_PACKAGE: VisualizationPackage = {
    id: 'wheel',
    createRenderer: (canvas) => new WheelRenderer(canvas),
    computeFinalPosition: (lots, mode, targetLotId, currentPosition, duration) => 
        RouletteEngine.computeFinalRotation(lots, mode, targetLotId, currentPosition, duration)
};

/**
 * Bundled visualization package for strip type.
 */
const STRIP_PACKAGE: VisualizationPackage = {
    id: 'strip',
    createRenderer: (canvas) => new StripRenderer(canvas),
    computeFinalPosition: (lots, mode, targetLotId, currentPosition, duration, canvasWidth) => 
        RouletteEngine.computeFinalScrollOffset(lots, mode, targetLotId, currentPosition, duration, canvasWidth!)
};

/**
 * Bundled visualization package for counting-rhyme type.
 *
 * Note: computeFinalCountingPosition intentionally takes 5 arguments (no
 * canvasWidth) — its position math lives entirely in cycle space and does
 * not depend on pixel dimensions. The optional 6th parameter is simply not
 * forwarded (§13 / §17).
 */
const COUNTING_RHYME_PACKAGE: VisualizationPackage = {
    id: 'counting-rhyme',
    createRenderer: (canvas) => new CountingRhymeRenderer(canvas),
    computeFinalPosition: (lots, mode, targetLotId, currentPosition, duration) =>
        RouletteEngine.computeFinalCountingPosition(lots, mode, targetLotId, currentPosition, duration)
};

/**
 * Registry of all visualization packages - single source of truth.
 */
export const VISUALIZATION_PACKAGES = {
    wheel: WHEEL_PACKAGE,
    strip: STRIP_PACKAGE,
    'counting-rhyme': COUNTING_RHYME_PACKAGE
} as const;

/**
 * Gets the visualization package for a given type.
 * Single object property access - no switch statement needed!
 */
export function getVisualizationPackage(type: VisualizationType): VisualizationPackage {
    return VISUALIZATION_PACKAGES[type];
}
