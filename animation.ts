/**
 * Animation utilities including easing functions.
 */

/**
 * Easing function type
 */
export type EasingFunction = (t: number) => number;

/**
 * Collection of easing functions for smooth animation.
 */
export const EasingFunctions = {
    /**
     * Linear - constant speed
     */
    linear: (t: number): number => t,

    /**
     * Ease Out Cubic - starts fast, slows down at end
     * Perfect for roulette deceleration effect
     */
    easeOutCubic: (t: number): number => 1 - Math.pow(1 - t, 3),

    /**
     * Ease Out Quart - more pronounced slowdown
     */
    easeOutQuart: (t: number): number => 1 - Math.pow(1 - t, 4),

    /**
     * Ease Out Quint - even more dramatic slowdown
     */
    easeOutQuint: (t: number): number => 1 - Math.pow(1 - t, 5),

    /**
     * Ease Out Expo - exponential deceleration
     */
    easeOutExpo: (t: number): number => 
        t === 1 ? 1 : 1 - Math.pow(2, -10 * t),

    /**
     * Custom roulette easing - smooth deceleration starting from halfway through
     * Provides a natural wheel slowdown effect with extended tail
     */
    rouletteEaseOut: (t: number): number => {
        // Use quintic ease out for dramatic, gradual slowdown
        // This starts slowing down earlier and more smoothly than cubic
        return 1 - Math.pow(1 - t, 5);
    }
};

/**
 * Default easing function for roulette animation
 */
export const DEFAULT_EASING: EasingFunction = EasingFunctions.easeOutCubic;

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
    
    private onUpdate?: (value: number, progress: number) => void;
    private onComplete?: () => void;

    /**
     * Configures the animation.
     */
    configure(options: {
        startValue: number;
        endValue: number;
        duration: number;
        easing?: EasingFunction;
        onUpdate?: (value: number, progress: number) => void;
        onComplete?: () => void;
    }): this {
        this.startValue = options.startValue;
        this.endValue = options.endValue;
        this.duration = options.duration;
        this.easing = options.easing ?? DEFAULT_EASING;
        this.onUpdate = options.onUpdate;
        this.onComplete = options.onComplete;
        
        return this;
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
     * Animation loop using requestAnimationFrame with delta time.
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
            this.onUpdate(currentValue, progress);
        }

        // Check if animation is complete
        if (progress < 1) {
            this.animationFrameId = requestAnimationFrame((time) => this.animate(time));
        } else {
            // Animation complete - ensure final value is set
            if (this.onUpdate) {
                this.onUpdate(this.endValue, 1);
            }
            
            // Clear animation state so isAnimating() returns false
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

    /**
     * Checks if animation is currently running.
     */
    isAnimating(): boolean {
        return this.startTime !== null && this.animationFrameId !== null;
    }

    /**
     * Gets the current progress (0-1).
     */
    getProgress(): number {
        if (this.startTime === null) return 0;
        
        const elapsed = performance.now() - this.startTime;
        return Math.min(elapsed / this.duration, 1);
    }

    /**
     * Gets the current animated value.
     */
    getCurrentValue(): number {
        if (this.startTime === null) return this.startValue;
        
        const progress = this.getProgress();
        const easedProgress = this.easing(progress);
        return this.startValue + (this.endValue - this.startValue) * easedProgress;
    }
}

/**
 * Creates a simple animation controller with default settings.
 */
export function createAnimationController(): AnimationController {
    return new AnimationController();
}
