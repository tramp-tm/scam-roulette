import type {
    AccentKind,
    AccentTarget,
    GameViewState,
    LotAccent,
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
 * Default accents for a turn's outcome: winners → `good`, eliminated → `bad`,
 * applied INDEPENDENTLY — a closing turn that both crowns a winner and drops a
 * loser shows both. Should a lot ever appear in both lists, `good` wins (the
 * winners are applied last).
 */
export function defaultAccentsForOutcome(outcome: TurnOutcome): Map<string, LotAccent> {
    const accents = new Map<string, LotAccent>();
    for (const id of outcome.eliminated) accents.set(id, { kind: 'bad' });
    for (const id of outcome.winners) accents.set(id, { kind: 'good' });
    return accents;
}

/**
 * Merges the mode-owned accents (`modeData.accent`) over the outcome defaults.
 * A mode accent for the same lot wins (at most one accent per lot); the mode
 * may also accent lots the outcome never mentioned.
 */
export function composeAccents(
    base: ReadonlyMap<string, LotAccent>,
    view: GameViewState
): Map<string, LotAccent> {
    const composed = new Map<string, LotAccent>(base);
    for (const p of view.participants) {
        const accent = p.modeData?.accent;
        if (accent) composed.set(p.lot.id, accent);
    }
    return composed;
}

/**
 * Flattens the composed accents into the lotId → kind map a single surface
 * consumes, dropping the accents that do not target it. An accent without
 * `targets` applies to both surfaces.
 */
export function accentsFor(
    composed: ReadonlyMap<string, LotAccent>,
    target: AccentTarget
): Map<string, AccentKind> {
    const result = new Map<string, AccentKind>();
    for (const [lotId, accent] of composed) {
        if (!accent.targets || accent.targets.includes(target)) {
            result.set(lotId, accent.kind);
        }
    }
    return result;
}
