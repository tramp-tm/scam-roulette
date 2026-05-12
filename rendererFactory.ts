import { VisualizationType, IRenderer } from './types.js';
import { WheelRenderer } from './wheelRenderer.js';
import { StripRenderer } from './stripRenderer.js';

/**
 * Factory for creating appropriate renderer based on visualization type.
 */
export function createRenderer(visualization: VisualizationType, canvas: HTMLCanvasElement): IRenderer {
    switch (visualization) {
        case 'wheel':
            return new WheelRenderer(canvas);
        case 'strip':
            return new StripRenderer(canvas);
        default:
            throw new Error(`Unknown visualization type: ${visualization}`);
    }
}
