import { AnimationController } from './animation.js';
import { getVisualizationPackage } from './visualizationStrategy.js';
import type { EasingFunction, GameMode, IRenderer, Lot, VisualizationType } from './types.js';

/**
 * VisualizationDriver
 * -------------------
 * Owns the visualization pipeline (renderer + animation controller + canvas +
 * current visualization type) and is the sole boundary through which `App`
 * drives anything visualization-related.
 *
 * What this class owns:
 *   - the canvas reference it was constructed with;
 *   - the current `IRenderer`;
 *   - the current `VisualizationType` (used for the package registry lookup);
 *   - the `AnimationController`.
 *
 * What this class deliberately does NOT own:
 *   - active lots / mode / game rules / participation — those are GameSession's;
 *   - the highlight state — that stays in `App` (`highlightedLotId`);
 *   - the user settings — `App` passes animation duration and easing per call.
 *
 * Every call into the visualization package registry (`getVisualizationPackage`),
 * into `IRenderer`, and into `AnimationController` lives here. `App` sees
 * only the five public methods below.
 */
export class VisualizationDriver {
    private readonly canvas: HTMLCanvasElement;
    private visualizationType: VisualizationType;
    private renderer: IRenderer;
    private readonly animationController: AnimationController;

    /**
     * @param canvas                The canvas the renderer draws into.
     * @param initialVisualization  The visualization type selected at startup.
     *
     * The constructor builds the initial renderer via the registry and creates
     * the animation controller. It does NOT draw — matching the pre-refactor
     * behaviour where the canvas stays blank until the first user action.
     */
    constructor(canvas: HTMLCanvasElement, initialVisualization: VisualizationType) {
        this.canvas = canvas;
        this.visualizationType = initialVisualization;
        this.renderer = getVisualizationPackage(initialVisualization).createRenderer(canvas);
        this.animationController = new AnimationController();
    }

    /**
     * Replaces the renderer for a new visualization type and draws the current
     * data. Used by the `visualizationSelect` change handler.
     */
    setVisualization(type: VisualizationType, lots: Lot[], mode: GameMode): void {
        this.visualizationType = type;
        this.renderer = getVisualizationPackage(type).createRenderer(this.canvas);
        this.renderer.updateSegments(lots, mode);
        this.renderer.render();
    }

    /**
     * Recomputes segments for the given data and redraws. Used after any
     * state change that alters the active lot set or the current mode.
     */
    refresh(lots: Lot[], mode: GameMode): void {
        this.renderer.updateSegments(lots, mode);
        this.renderer.render();
    }

    /**
     * Redraws the current frame without recomputing segments. Used by the
     * theme-change handler.
     */
    render(): void {
        this.renderer.render();
    }

    /**
     * Runs one spin animation to the given target lot.
     *
     * Encapsulates everything `App.spin()` used to compute inline:
     *   - the renderer's current rotation;
     *   - the canvas width for the visualization's position math;
     *   - the registry lookup for the current visualization package;
     *   - the `computeFinalPosition` call;
     *   - the `AnimationController.configure`/`start` sequence;
     *   - the per-frame `setRotation` + `render` update contract.
     */
    spinTo(params: {
        lots: Lot[];
        mode: GameMode;
        targetLotId: string;
        durationMs: number;
        easing: EasingFunction;
        onComplete: () => void;
    }): void {
        const currentRotation = this.renderer.getCurrentRotation();
        const canvasWidth = this.canvas.getBoundingClientRect().width;

        const vizPackage = getVisualizationPackage(this.visualizationType);
        const endValue = vizPackage.computeFinalPosition(
            params.lots,
            params.mode,
            params.targetLotId,
            currentRotation,
            params.durationMs,
            canvasWidth
        );

        this.animationController.configure({
            startValue: currentRotation,
            endValue,
            duration: params.durationMs,
            easing: params.easing,
            onUpdate: (value) => {
                this.renderer.setRotation(value);
                this.renderer.render();
            },
            onComplete: params.onComplete
        });

        this.animationController.start();
    }

    /**
     * Stops any running animation, resets the renderer state, re-seeds segments
     * for the current data and redraws. Used by `App.reset()`.
     *
     * Ordering note: this method is called from `App.reset()` after
     * `gameSession.reset()`. Both invalidation mechanisms remain in force —
     * the animation controller's RAF handle is cancelled here, and the
     * session's pending spin was already nulled by `gameSession.reset()` — so
     * a stray `onComplete` cannot replay a stale spin.
     */
    reset(lots: Lot[], mode: GameMode): void {
        this.animationController.stop();
        this.renderer.reset();
        this.renderer.updateSegments(lots, mode);
        this.renderer.render();
    }
}
