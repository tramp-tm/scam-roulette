import { AnimationController } from './animation.js';
import type { EasingFunction } from './animation.js';
import { getVisualizationPackage } from './visualizationStrategy.js';
import { buildEliminatedMid, createViewInterpolator } from './presentation.js';
import type {
    AccentState,
    GameViewState,
    IRenderer,
    VisualizationTransition,
    VisualizationTuning,
    VisualizationType
} from './types.js';

/** Parameters for a main spin animation. */
export interface SpinParams {
    view: GameViewState;
    accents: AccentState;
    targetLotId: string;
    durationMs: number;
    easing: EasingFunction;
    onComplete: () => void;
}

/**
 * Parameters for a pre-spin "reveal" transition: the resting view morphs into the
 * prepared view (e.g. the tournament wheel collapsing from the pool to the
 * mini-roulette) before the spin runs. There is no `pulse` ramp here — the
 * outcome accents do not exist yet — so `accents` is applied unchanged.
 */
export interface RevealParams {
    from: GameViewState;
    to: GameViewState;
    accents: AccentState;
    durationMs: number;
    easing: EasingFunction;
    onComplete: () => void;
}

/** Parameters for the static "read the group" pause between reveal and spin. */
export interface HoldParams {
    durationMs: number;
    onComplete: () => void;
}

/** Parameters for a post-spin outcome transition animation. */
export interface OutcomeParams {
    transition: VisualizationTransition;
    accents: AccentState;
    durationMs: number;
    easing: EasingFunction;
    onComplete?: () => void;
}

/**
 * True when two snapshots carry the same per-participant axes (id, chance,
 * magnitude, opacity, visibility) in the same order. Used to detect an outcome
 * phase that would change nothing, so it can be skipped instead of freezing the
 * canvas for the whole transition duration.
 */
function sameView(a: GameViewState, b: GameViewState): boolean {
    if (a.participants.length !== b.participants.length) return false;
    for (let i = 0; i < a.participants.length; i++) {
        const p = a.participants[i];
        const q = b.participants[i];
        if (p.lot.id !== q.lot.id || p.xValue !== q.xValue || p.yValue !== q.yValue
            || p.zValue !== q.zValue || p.presence !== q.presence) return false;
    }
    return true;
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
 *   - run the pre-spin reveal transition by interpolating the presentation
 *     snapshot from the resting view to the prepared view;
 *   - hold that prepared frame for a while (read pause) before the spin;
 *   - run the post-spin outcome transition by interpolating the presentation
 *     snapshot from `before` to `after`;
 *   - reset.
 *   - expose the visualization's cursor read-only for the UI.
 *
 * What this class deliberately does NOT own:
 *   - active lots / mode / game rules / participation — those are GameSession's;
 *   - accent decisions — those are `App`'s (outcome defaults ⊕ mode accents);
 *   - the user settings — `App` passes duration / easing per call.
 */
export class VisualizationDriver {
    private readonly canvas: HTMLCanvasElement;
    private visualizationType: VisualizationType;
    private renderer: IRenderer;
    private readonly animationController: AnimationController;

    /**
     * Tuning currently applied to the renderer. Mirrored here so a renderer swap
     * (`setVisualization`) can re-apply it to the freshly created renderer.
     */
    private tuning: VisualizationTuning = { realChances: false, realMagnitudes: false };

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
    setVisualization(type: VisualizationType, view: GameViewState, accents: AccentState): void {
        this.animationController.stop();
        this.visualizationType = type;
        this.renderer = getVisualizationPackage(type).createRenderer(this.canvas);
        // A fresh renderer starts untuned: re-apply before the first
        // `setViewState`, which is what rebuilds the geometry.
        this.renderer.setTuning(this.tuning);
        this.renderer.setViewState(view, accents);
        // Re-apply the hover highlight so a visualization swap cannot drop it
        // (identity is the stable lot id, so this can never hit an unrelated lot).
        this.renderer.setHover(this.hoveredLotId);
        this.renderer.render();
    }

    /**
     * Applies the "real chances" / "real magnitudes" tuning to the current
     * renderer. Geometry is rebuilt on the next `setViewState` (the caller
     * refreshes), and the value is remembered for later renderer swaps.
     */
    setTuning(tuning: VisualizationTuning): void {
        this.tuning = tuning;
        this.renderer.setTuning(tuning);
    }

    /** Shows a presentation snapshot and redraws. */
    refresh(view: GameViewState, accents: AccentState): void {
        this.renderer.setViewState(view, accents);
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
     * never replaces — the lot accents, and works in every visualization.
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
     * and asks the renderer to draw. Accent state is set once, before the
     * spin, and is unchanged during it.
     */
    spinTo(params: SpinParams): void {
        this.animationController.stop();

        this.renderer.setViewState(params.view, params.accents);

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
     * goes to 0 and the rest grow), ramping the accent emphasis in via `pulse`.
     * The final frame adopts the stable `after` snapshot.
     *
     * The interpolator is built once and reused across frames, so no
     * ViewState structures are reallocated per frame.
     */
    /**
     * Plays the pre-spin reveal: interpolates the presentation snapshot from the
     * resting view to the prepared view, then hands control back to the caller
     * (which starts the spin). Same mechanism as `animateOutcome` — every frame
     * re-pushes an interpolated snapshot, so each renderer rebuilds its own
     * geometry — but with the accents applied unchanged (there are no outcome
     * accents yet) and a stable `to` as the final frame.
     */
    reveal(params: RevealParams): void {
        this.animationController.stop();

        const interpolate = createViewInterpolator(params.from, params.to);

        this.animationController.configure({
            startValue: 0,
            endValue: 1,
            duration: params.durationMs,
            easing: params.easing,
            onUpdate: (easedProgress) => {
                this.renderer.setViewState(interpolate(easedProgress), params.accents);
                this.renderer.render();
            },
            onComplete: () => {
                this.renderer.setViewState(params.to, params.accents);
                this.renderer.render();
                params.onComplete();
            }
        });

        this.animationController.start();
    }

    /**
     * Holds the current frame for `durationMs` without touching the renderer — a
     * no-op scalar run, so it is owned by the controller and cancelled by
     * `stop()` / `reset()` like any other animation. A plain `setTimeout` would
     * survive a reset and start a spin on a discarded session.
     */
    hold(params: HoldParams): void {
        this.animationController.stop();
        this.animationController.configure({
            startValue: 0,
            endValue: 1,
            duration: params.durationMs,
            onUpdate: () => {},
            onComplete: () => params.onComplete()
        });
        this.animationController.start();
    }

    /**
     * Plays the post-spin outcome as up to TWO sequential phases, so an
     * elimination is read before the wheel reopens:
     *
     *  1. eliminate — every eliminated lot collapses (`presence` 1 → 0,
     *     `xValue` → 0) while the accent `pulse` ramps in; the survivors stay
     *     exactly as they were in the prepared view;
     *  2. return    — the survivors (and any zero-chance lot) grow back to the
     *     stable `after` view; the accents are already at full pulse.
     *
     * The second phase is skipped when it would change nothing (the mid frame
     * already equals `after`, e.g. Survival, where the survivors' weights are
     * unchanged), so an ordinary mode keeps its previous single-phase total
     * duration. Both phases use the caller's `durationMs` / `easing`.
     */
    animateOutcome(params: OutcomeParams): void {
        this.animationController.stop();

        const { before, after, outcome } = params.transition;
        const mid = buildEliminatedMid(before, outcome.eliminated);
        const eliminate = createViewInterpolator(before, mid);

        this.animationController.configure({
            startValue: 0,
            endValue: 1,
            duration: params.durationMs,
            easing: params.easing,
            onUpdate: (easedProgress) => {
                this.renderer.setViewState(
                    eliminate(easedProgress),
                    { accents: params.accents.accents, pulse: easedProgress }
                );
                this.renderer.render();
            },
            onComplete: () => {
                if (sameView(mid, after)) {
                    this.renderer.setViewState(after, params.accents);
                    this.renderer.render();
                    params.onComplete?.();
                    return;
                }

                const back = createViewInterpolator(mid, after);
                this.animationController.configure({
                    startValue: 0,
                    endValue: 1,
                    duration: params.durationMs,
                    easing: params.easing,
                    onUpdate: (easedProgress) => {
                        this.renderer.setViewState(back(easedProgress), params.accents);
                        this.renderer.render();
                    },
                    onComplete: () => {
                        this.renderer.setViewState(after, params.accents);
                        this.renderer.render();
                        params.onComplete?.();
                    }
                });
                this.animationController.start();
            }
        });

        this.animationController.start();
    }

    /**
     * Stops any running animation, resets the renderer and shows the given
     * snapshot. Used by `App.reset()`.
     */
    reset(view: GameViewState, accents: AccentState): void {
        this.animationController.stop();
        this.hoveredLotId = null;
        this.renderer.reset();
        this.renderer.setViewState(view, accents);
        this.renderer.render();
    }

    /** Lot currently under the visualization's cursor, or null. */
    getCursorLotId(): string | null {
        return this.renderer.getCursorLotId(this.renderer.getAnimationValue());
    }
}
