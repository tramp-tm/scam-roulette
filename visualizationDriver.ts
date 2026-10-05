import { AnimationController } from './animation.js';
import type { EasingFunction } from './animation.js';
import { getVisualizationPackage } from './visualizationStrategy.js';
import { createViewInterpolator, makeHighlight } from './presentation.js';
import type {
    GameViewState,
    HighlightState,
    IRenderer,
    VisualizationTransition,
    VisualizationType
} from './types.js';

/** Parameters for a main spin animation. */
export interface SpinParams {
    view: GameViewState;
    highlight: HighlightState;
    targetLotId: string;
    durationMs: number;
    easing: EasingFunction;
    onComplete: () => void;
}

/** Parameters for a post-spin outcome transition animation. */
export interface OutcomeParams {
    transition: VisualizationTransition;
    highlight: HighlightState;
    durationMs: number;
    easing: EasingFunction;
    onComplete?: () => void;
}

/**
 * VisualizationDriver
 * -------------------
 * Owns the visualization pipeline (renderer + animation controller + canvas +
 * current visualization type) and is the sole boundary through which `App`
 * drives anything visualization-related.
 *
 * It owns the visualization lifecycle:
 *   - create the renderer via the registry;
 *   - show a presentation snapshot (`refresh` / `setVisualization`);
 *   - run the main spin animation (target computed internally by the
 *     visualization; the driver only advances the scalar);
 *   - run the post-spin outcome transition by interpolating the presentation
 *     snapshot from `before` to `after`;
 *   - reset.
 *   - expose the visualization's cursor read-only for the UI.
 *
 * What this class deliberately does NOT own:
 *   - active lots / mode / game rules / participation — those are GameSession's;
 *   - game highlight decision — that is `App`'s (derived from the outcome);
 *   - the user settings — `App` passes duration / easing per call.
 */
export class VisualizationDriver {
    private readonly canvas: HTMLCanvasElement;
    private visualizationType: VisualizationType;
    private renderer: IRenderer;
    private readonly animationController: AnimationController;

    /**
     * Last hover id set through `setHover`, mirrored so it can be re-applied
     * when the renderer is swapped. Never reaches game state.
     */
    private hoveredLotId: string | null = null;

    /**
     * @param canvas                The canvas the renderer draws into.
     * @param initialVisualization  The visualization type selected at startup.
     *
     * The constructor builds the initial renderer via the registry and creates
     * the animation controller. It does NOT draw.
     */
    constructor(canvas: HTMLCanvasElement, initialVisualization: VisualizationType) {
        this.canvas = canvas;
        this.visualizationType = initialVisualization;
        this.renderer = getVisualizationPackage(initialVisualization).createRenderer(canvas);
        this.animationController = new AnimationController();
    }

    get visualization(): VisualizationType {
        return this.visualizationType;
    }

    /**
     * Replaces the renderer for a new visualization type and shows the current
     * presentation snapshot. Used by the `visualizationSelect` change handler.
     */
    setVisualization(type: VisualizationType, view: GameViewState, highlight: HighlightState): void {
        this.animationController.stop();
        this.visualizationType = type;
        this.renderer = getVisualizationPackage(type).createRenderer(this.canvas);
        this.renderer.setViewState(view, highlight);
        // Re-apply the hover highlight so a visualization swap cannot drop it
        // (identity is the stable lot id, so this can never hit an unrelated lot).
        this.renderer.setHover(this.hoveredLotId);
        this.renderer.render();
    }

    /** Shows a presentation snapshot and redraws. */
    refresh(view: GameViewState, highlight: HighlightState): void {
        this.renderer.setViewState(view, highlight);
        this.renderer.render();
    }

    /** Redraws the current frame without changing state (theme change). */
    render(): void {
        this.renderer.render();
    }

    /**
     * Sets the transient hover highlight (a stable lot id, or `null` to clear).
     * Purely presentational: it only re-renders the current frame and never
     * touches the view state, animation or game state. It composes with — and
     * never replaces — the game highlight, and works in every visualization.
     */
    setHover(lotId: string | null): void {
        if (this.hoveredLotId === lotId) return;
        this.hoveredLotId = lotId;
        this.renderer.setHover(lotId);
        this.renderer.render();
    }

    /**
     * Runs one spin animation to the given target lot. The target scalar is
     * computed by the visualization itself (roulette math is internal) and the
     * cursor is resolved internally too — the driver only advances the scalar
     * and asks the renderer to draw. Highlight state is set once, before the
     * spin, and is unchanged during it.
     */
    spinTo(params: SpinParams): void {
        this.animationController.stop();

        this.renderer.setViewState(params.view, params.highlight);

        const startValue = this.renderer.getAnimationValue();
        const endValue = this.renderer.computeSpinTarget(params.targetLotId, params.durationMs);

        this.animationController.configure({
            startValue,
            endValue,
            duration: params.durationMs,
            easing: params.easing,
            onUpdate: (value) => {
                this.renderer.setAnimationValue(value);
                this.renderer.render();
            },
            onComplete: params.onComplete
        });

        this.animationController.start();
    }

    /**
     * Runs the post-spin outcome transition: interpolates the presentation
     * snapshot from `before` to `after` (eliminated participants' presence
     * goes to 0 and the rest grow), ramping the game highlight emphasis in via
     * `pulse`. The final frame adopts the stable `after` snapshot.
     *
     * The interpolator is built once and reused across frames, so no
     * ViewState structures are reallocated per frame.
     */
    animateOutcome(params: OutcomeParams): void {
        this.animationController.stop();

        const interpolate = createViewInterpolator(params.transition.before, params.transition.after);

        this.animationController.configure({
            startValue: 0,
            endValue: 1,
            duration: params.durationMs,
            easing: params.easing,
            onUpdate: (easedProgress) => {
                this.renderer.setViewState(
                    interpolate(easedProgress),
                    makeHighlight(params.highlight.game, easedProgress)
                );
                this.renderer.render();
            },
            onComplete: () => {
                this.renderer.setViewState(params.transition.after, params.highlight);
                this.renderer.render();
                params.onComplete?.();
            }
        });

        this.animationController.start();
    }

    /**
     * Stops any running animation, resets the renderer and shows the given
     * snapshot. Used by `App.reset()`.
     */
    reset(view: GameViewState, highlight: HighlightState): void {
        this.animationController.stop();
        this.hoveredLotId = null;
        this.renderer.reset();
        this.renderer.setViewState(view, highlight);
        this.renderer.render();
    }

    /** Lot currently under the visualization's cursor, or null. */
    getCursorLotId(): string | null {
        return this.renderer.getCursorLotId(this.renderer.getAnimationValue());
    }
}
