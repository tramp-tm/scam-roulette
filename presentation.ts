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
 * Read pause between the reveal and the spin: the drawn group stays on screen,
 * static, so the user can read which lots are in the mini-roulette.
 */
export const REVEAL_HOLD_DURATION_MS = 1000;

/**
 * Mid-frame of a split outcome transition: the `before` snapshot with every
 * eliminated lot zeroed on both its chance (`xValue`) and its visibility
 * (`presence`). The survivors keep their `before` values — so between the
 * eliminate and the return phases the wheel shows the survivors exactly as they
 * were in the mini-roulette.
 */
export function buildEliminatedMid(
    before: GameViewState,
    eliminatedIds: readonly string[]
): GameViewState {
    const eliminated = new Set(eliminatedIds);
    return {
        ...before,
        participants: before.participants.map(p =>
            eliminated.has(p.lot.id) ? { ...p, xValue: 0, presence: 0 } : p
        )
    };
}

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
 * `yValue` (visual magnitude) and `presence` (visibility) are interpolated
 * INDEPENDENTLY: e.g. HP 100 → 90 with presence 1 → 1, or a death HP 10 → 0
 * with presence 1 → 0. Every axis lerps: `xValue` (chance), `yValue`
 * (magnitude) and `zValue` (opacity), each from `before` to `after`; `presence`
 * (visibility) has its own track. Interpolating `xValue` is what lets the
 * sectors/bands resize smoothly during the outcome rebuild — safe because a
 * spin pushes its snapshot once and never re-pushes it mid-animation, so no
 * roulette partition can drift while the wheel is moving. An axis absent on
 * BOTH sides stays absent (`undefined`); an absent opacity counts as 1.
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
        fromX: number;
        toX: number;
        fromY: number | undefined;
        toY: number | undefined;
        fromZ: number | undefined;
        toZ: number | undefined;
        fromPresence: number;
        toPresence: number;
    }[] = [];

    const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

    const track = (b: RenderableParticipant | undefined, a: RenderableParticipant | undefined): void => {
        const base = (a ?? b)!;
        const target: RenderableParticipant = {
            lot: base.lot,
            active: a ? a.active : (b ? b.active : false),
            xValue: b ? b.xValue : (a ? a.xValue : 0),
            yValue: b ? b.yValue : a?.yValue,
            zValue: b ? b.zValue : a?.zValue,
            presence: b ? b.presence : 0,
            modeData: a?.modeData ?? b?.modeData
        };
        participants.push(target);
        tracks.push({
            target,
            fromX: b ? b.xValue : 0,
            toX: a ? a.xValue : 0,
            fromY: b?.yValue,
            toY: a?.yValue,
            fromZ: b?.zValue,
            toZ: a?.zValue,
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
            tr.target.xValue = lerp(tr.fromX, tr.toX, clamped);
            // An axis absent on BOTH sides stays absent; a one-sided opacity
            // counts as 1 (opaque) and a one-sided magnitude as 0.
            tr.target.yValue = (tr.fromY === undefined && tr.toY === undefined)
                ? undefined
                : lerp(tr.fromY ?? 0, tr.toY ?? 0, clamped);
            tr.target.zValue = (tr.fromZ === undefined && tr.toZ === undefined)
                ? undefined
                : lerp(tr.fromZ ?? 1, tr.toZ ?? 1, clamped);
            tr.target.presence = lerp(tr.fromPresence, tr.toPresence, clamped);
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
