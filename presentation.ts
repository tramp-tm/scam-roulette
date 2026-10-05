import type {
    GameViewState,
    HighlightState,
    RenderableParticipant,
    TurnOutcome
} from './types.js';

/** Duration of the post-spin outcome transition, in ms. */
export const OUTCOME_TRANSITION_DURATION_MS = 600;

/**
 * Builds a reusable interpolator between two presentation snapshots.
 *
 * Unlike a naive per-frame linear interpolation (which would rebuild the
 * merged participant list and its id lookups every frame), this computes
 * the merged participant list, the id lookups and the static interpolation
 * inputs ONCE; each call only mutates the interpolated fields of the
 * participants it owns. That keeps the per-frame cost of an outcome transition
 * O(n) field writes with no allocation.
 *
 * `visualValue` (visual magnitude) and `presence` (visibility) are interpolated
 * INDEPENDENTLY: e.g. HP 100 → 90 with presence 1 → 1, or a death HP 10 → 0
 * with presence 1 → 0. `selectionWeight` is NOT interpolated (it may only jump
 * with the stable `after` snapshot) so an outcome never reshapes the roulette
 * probabilities mid-transition.
 *
 * The returned participants array is owned by the interpolator; callers must
 * not mutate the `before`/`after` snapshots it was created from.
 */
export function createViewInterpolator(
    before: GameViewState,
    after: GameViewState
): (t: number) => GameViewState {
    const beforeById = new Map(before.participants.map(p => [p.lot.id, p]));
    const afterIds = new Set(after.participants.map(p => p.lot.id));

    const participants: RenderableParticipant[] = [];
    const tracks: {
        target: RenderableParticipant;
        fromVisualValue: number;
        toVisualValue: number;
        fromPresence: number;
        toPresence: number;
    }[] = [];

    const track = (b: RenderableParticipant | undefined, a: RenderableParticipant | undefined): void => {
        const base = (a ?? b)!;
        const target: RenderableParticipant = {
            lot: base.lot,
            active: a ? a.active : (b ? b.active : false),
            selectionWeight: a ? a.selectionWeight : (b ? b.selectionWeight : 0),
            visualValue: b ? b.visualValue : 0,
            presence: b ? b.presence : 0,
            modeData: a?.modeData ?? b?.modeData
        };
        participants.push(target);
        tracks.push({
            target,
            fromVisualValue: b ? b.visualValue : 0,
            toVisualValue: a ? a.visualValue : 0,
            fromPresence: b ? b.presence : 0,
            toPresence: a ? a.presence : 0
        });
    };

    // Iterate `after` first so the final frame (t = 1) matches it exactly.
    for (const a of after.participants) track(beforeById.get(a.lot.id), a);
    for (const b of before.participants) {
        if (!afterIds.has(b.lot.id)) track(b, undefined);
    }

    return (t: number): GameViewState => {
        const clamped = Math.max(0, Math.min(1, t));
        for (const tr of tracks) {
            tr.target.visualValue =
                tr.fromVisualValue + (tr.toVisualValue - tr.fromVisualValue) * clamped;
            tr.target.presence =
                tr.fromPresence + (tr.toPresence - tr.fromPresence) * clamped;
        }
        return { modeId: after.modeId, participants };
    };
}

/**
 * Game highlight for a completed turn:
 *  - if the game finished → the winners;
 *  - otherwise → the eliminated participants (the rolled lot, in Survival).
 */
export function gameHighlightForOutcome(outcome: TurnOutcome): Set<string> {
    if (outcome.finished) return new Set(outcome.winners);
    return new Set(outcome.eliminated);
}

/**
 * Convenience factory for a highlight state. `pulse` scales the game
 * highlight emphasis during an outcome transition (default 1 = stable).
 */
export function makeHighlight(game: ReadonlySet<string>, pulse: number = 1): HighlightState {
    return { game, pulse };
}
