import type { VisualizationType, VisualizationPackage } from './types.js';
import { WheelRenderer } from './wheelRenderer.js';
import { StripRenderer } from './stripRenderer.js';
import { CountingRhymeRenderer } from './countingRhymeRenderer.js';

/**
 * Sole registry of visualization packages.
 *
 * `VISUALIZATION_PACKAGES` (+ `getVisualizationPackage`) is the single
 * authoritative source of truth for "which visualization corresponds to which
 * type". Adding a visualization means adding one package here and nothing
 * else — `App`, `GameSession` and the driver contain no visualization
 * branching.
 *
 * Each package is a factory only: the visualization itself (its renderer)
 * owns its internal spin math, cursor semantics and presentation. There is no
 * shared `computeFinalPosition(targetLotId)` contract, so a visualization
 * with a completely different animation model is free to implement its own.
 */
const WHEEL_PACKAGE: VisualizationPackage = {
    id: 'wheel',
    createRenderer: (canvas) => new WheelRenderer(canvas)
};

const STRIP_PACKAGE: VisualizationPackage = {
    id: 'strip',
    createRenderer: (canvas) => new StripRenderer(canvas)
};

const COUNTING_RHYME_PACKAGE: VisualizationPackage = {
    id: 'counting-rhyme',
    createRenderer: (canvas) => new CountingRhymeRenderer(canvas)
};

/** Registry of all visualization packages - single source of truth. */
export const VISUALIZATION_PACKAGES = {
    wheel: WHEEL_PACKAGE,
    strip: STRIP_PACKAGE,
    'counting-rhyme': COUNTING_RHYME_PACKAGE
} as const;

/** Returns the visualization package for a given type. */
export function getVisualizationPackage(type: VisualizationType): VisualizationPackage {
    return VISUALIZATION_PACKAGES[type];
}
