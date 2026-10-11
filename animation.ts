/**
 * Animation utilities including easing functions.
 */

/**
 * A pure scalar-to-scalar function that reshapes the animation's time
 * axis. Convention: domain [0, 1] → [0, 1], with E(0) = 0 and E(1) = 1.
 */
export type EasingFunction = (t: number) => number;

/**
 * An entry of `EasingFunctions`: the curve itself plus a name used as the
 * i18n key base for its label and description (`easing.<name>.name` /
 * `easing.<name>.description`).
 */
export interface EasingFunctionDefinition {
    fn: EasingFunction;
    /** i18n key base — see locales/en.json / locales/ru.json. */
    name: string;
}

/**
 * Collection of easing functions for smooth animation.
 * Each entry carries the curve (`fn`) and its i18n `name`.
 */
export const EasingFunctions: Record<string, EasingFunctionDefinition> = {
    linear: {
        name: 'linear',
        fn: (t: number): number => t
    },

    easeOutCubic: {
        name: 'easeOutCubic',
        fn: (t: number): number => 1 - Math.pow(1 - t, 3)
    },

    easeOutQuart: {
        name: 'easeOutQuart',
        fn: (t: number): number => 1 - Math.pow(1 - t, 4)
    },

    easeOutQuint: {
        name: 'easeOutQuint',
        fn: (t: number): number => 1 - Math.pow(1 - t, 5)
    },

    easeOutExpo: {
        name: 'easeOutExpo',
        fn: (t: number): number => t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
    },

    /**
     * Custom roulette easing — deliberately distinct from easeOutQuint.
     * A blend of cubic and quintic ease-out: gentler in the first half,
     * long dramatic tail at the end.
     */
    easeInOutCubic: {
        name: 'easeInOutCubic',
        fn: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
    },

    rouletteEaseOut: {
        name: 'rouletteEaseOut',
        fn: (t: number): number => {
            const cubic = 1 - Math.pow(1 - t, 3);
            const quintic = 1 - Math.pow(1 - t, 5);
            return cubic * (1 - t) + quintic * t;
        }
    }
};

/**
 * Default easing function for roulette animation
 */
export const DEFAULT_EASING: EasingFunction = EasingFunctions.rouletteEaseOut.fn;

/**
 * Easing of the view MORPH transitions (reveal / eliminate / return).
 *
 * Deliberately NOT the user's spin easing: a spin curve is a strong ease-out
 * (fast unwind, gentle settle), which front-loads a SIZE change — under it a lot
 * whose share collapses to zero loses ~3/4 of its sector in the first frames and
 * the rest of the transition is spent on the last quarter. A symmetric curve
 * spreads the change over the whole transition.
 */
export const TRANSITION_EASING: EasingFunction = EasingFunctions.easeInOutCubic.fn;

/**
 * Animation controller class that manages time-based animations.
 */
export class AnimationController {
    private animationFrameId: number | null = null;
    private startTime: number | null = null;
    private startValue: number = 0;
    private endValue: number = 0;
    private duration: number = 1000;
    private easing: EasingFunction = DEFAULT_EASING;

    private onUpdate?: (value: number) => void;
    private onComplete?: () => void;

    /**
     * Configures the animation.
     */
    configure(options: {
        startValue: number;
        endValue: number;
        duration: number;
        easing?: EasingFunction;
        onUpdate?: (value: number) => void;
        onComplete?: () => void;
    }): void {
        this.startValue = options.startValue;
        this.endValue = options.endValue;
        this.duration = options.duration;
        this.easing = options.easing ?? DEFAULT_EASING;
        this.onUpdate = options.onUpdate;
        this.onComplete = options.onComplete;
    }

    /**
     * Starts the animation.
     */
    start(): void {
        this.stop(); // Ensure any previous animation is stopped
        
        this.startTime = performance.now();
        this.animate(this.startTime);
    }

    /**
     * Animation loop using requestAnimationFrame with absolute elapsed time.
     */
    private animate(currentTime: number): void {
        if (this.startTime === null) return;

        const elapsed = currentTime - this.startTime;
        const progress = Math.min(elapsed / this.duration, 1);
        
        // Apply easing function
        const easedProgress = this.easing(progress);
        
        // Calculate current value using linear interpolation
        const currentValue = this.startValue + 
            (this.endValue - this.startValue) * easedProgress;

        // Call update callback
        if (this.onUpdate) {
            this.onUpdate(currentValue);
        }

        // Check if animation is complete
        if (progress < 1) {
            this.animationFrameId = requestAnimationFrame((time) => this.animate(time));
        } else {
            // Animation complete - ensure final value is set
            if (this.onUpdate) {
                this.onUpdate(this.endValue);
            }
            
            // Clear the animation state.
            this.animationFrameId = null;
            this.startTime = null;
            
            if (this.onComplete) {
                this.onComplete();
            }
        }
    }

    /**
     * Stops the animation.
     */
    stop(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.startTime = null;
    }

}
