import { VisualizationType, IRenderer } from './types.js';
import { getVisualizationPackage } from './visualizationStrategy.js';

/**
 * Factory for creating appropriate renderer based on visualization type.
 * Now delegates to bundled visualization packages - no switch statement needed!
 */
export function createRenderer(visualization: VisualizationType, canvas: HTMLCanvasElement): IRenderer {
    const pkg = getVisualizationPackage(visualization);
    return pkg.createRenderer(canvas) as IRenderer;
}
