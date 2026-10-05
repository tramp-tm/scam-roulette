import type {
    GameMode,
    GameModeState,
    GameParticipantState,
    Lot,
    MessageDescriptor,
    Mode,
    ModePresentationData,
    ParticipantModeState,
    TurnOutcome
} from './types.js';
import { t } from './i18n.js';

/**
 * Crown Defense — tuning parameters (this mode's rules).
 *
 * Kept in a single place so the initial-HP formula and the damage are not
 * duplicated across the algorithm. No user-facing configuration exists yet,
 * so they are plain constants — but they are the *only* definition of these
 * values.
 */

/** HP of the participant with the largest `amount` at game start. */
const INITIAL_HP_SCALE = 100;

/** Fixed damage applied to every active participant except the rolled one. */
const DAMAGE_PER_SPIN = 10;

/**
 * Initial HP for a lot: normalized against the session's largest `amount`.
 * `amount === maxAmount` → `INITIAL_HP_SCALE`; half the max → half of it.
 * Always positive for a positive `amount`; never divides by zero.
 */
function initialHp(amount: number, maxAmount: number): number {
    const reference = maxAmount > 0 ? maxAmount : 1;
    return (amount / reference) * INITIAL_HP_SCALE;
}

/** Damage dealt by one spin. Single source of the damage value. */
function damagePerSpin(): number {
    return DAMAGE_PER_SPIN;
}

/**
 * Game-level state for a Crown Defense session: the HP normalization
 * reference. It is fixed when the game is created, so the initial HP of every
 * participant of one game is normalized against the same maximum.
 */
interface CrownDefenseGameState {
    maxAmount: number;
}

/**
 * Per-participant state: the participant's current HP.
 *
 * `hp` is `null` until first materialized: the initial HP is derived
 * deterministically from the lot's `amount` and the game's `maxAmount`
 * (see `effectiveHp`), so it is available immediately and cannot be shared
 * between sessions. `processRoll` materializes it. HP lives here (per session)
 * — never on the shared mode instance and never on the global `Lot`.
 */
interface CrownDefenseParticipantState {
    hp: number | null;
}

function asGameState(state: GameModeState): CrownDefenseGameState {
    return state as CrownDefenseGameState;
}

function asParticipantState(participant: GameParticipantState): CrownDefenseParticipantState {
    return participant.modeState as CrownDefenseParticipantState;
}

/** Current HP of a participant, deriving the initial value on first read. */
function effectiveHp(
    lot: Lot,
    participant: GameParticipantState,
    state: CrownDefenseGameState
): number {
    const ps = asParticipantState(participant);
    if (typeof ps.hp === 'number') return ps.hp;
    return initialHp(lot.amount, state.maxAmount);
}

/**
 * Deterministic winner for the (defensive) no-survivors case: the participant
 * with the highest HP after damage; ties broken by participant order.
 */
function highestHpAfterDamage(
    participants: readonly GameParticipantState[],
    hpAfter: ReadonlyMap<string, number>
): string {
    let bestId = participants[0].lotId;
    let bestHp = -Infinity;
    for (const p of participants) {
        const hp = hpAfter.get(p.lotId) ?? 0;
        if (hp > bestHp) {
            bestHp = hp;
            bestId = p.lotId;
        }
    }
    return bestId;
}

/**
 * Crown Defense.
 *
 * Rules (one spin):
 *  - every active participant has an equal chance to be rolled
 *    (`selectionWeight = 1` — HP is NOT used for selection);
 *  - the rolled participant takes NO damage;
 *  - every other active participant takes a fixed damage; HP is clamped at 0;
 *  - participants at 0 HP are eliminated;
 *  - if one participant remains, it wins; if more than one remains, the game
 *    continues; no survivors is handled defensively (highest HP wins).
 *
 * Presentation:
 *  - `visualValue = current HP` — the visualization draws HP as size;
 *  - `modeData.ext = "♥ HP"` — the lots list's optional extra column.
 *
 * The mode is stateless/shared: all data lives in the passed state objects,
 * so two sessions never share HP.
 */
export class CrownDefenseMode implements GameMode {
    readonly id: Mode = 'crown-defense';

    get name(): string { return t('mode.crown-defense.name'); }
    get description(): string { return t('mode.crown-defense.description'); }

    createGameState(lots: readonly Lot[]): GameModeState {
        let maxAmount = 0;
        for (const lot of lots) {
            if (lot.amount > maxAmount) maxAmount = lot.amount;
        }
        const state: CrownDefenseGameState = { maxAmount };
        return state;
    }

    createParticipantState(_lot: Lot): ParticipantModeState {
        const participant: CrownDefenseParticipantState = { hp: null };
        return participant;
    }

    onParticipantsChanged(state: GameModeState): GameModeState {
        // maxAmount is the game-start reference and stays fixed; a participant
        // added before the first spin derives its HP from the current amount.
        return state;
    }

    calculateSelectionWeight(): number {
        // Equal probability for every active participant, regardless of HP.
        return 1;
    }

    getParticipantVisualValue(
        lot: Lot,
        participant: GameParticipantState,
        state: GameModeState
    ): number {
        return effectiveHp(lot, participant, asGameState(state));
    }

    processRoll(
        rolledLot: Lot,
        _rolled: GameParticipantState,
        participants: readonly GameParticipantState[],
        lots: readonly Lot[],
        state: GameModeState
    ): { state: GameModeState; participants: GameParticipantState[]; outcome: TurnOutcome } {
        const gs = asGameState(state);
        const lotById = new Map(lots.map(l => [l.id, l]));
        const damage = damagePerSpin();

        // 1. HP before this turn's damage, for every participant. Computed up
        //    front so no participant's damage depends on another's outcome.
        const hpBefore = new Map<string, number>();
        for (const p of participants) {
            const lot = lotById.get(p.lotId);
            hpBefore.set(p.lotId, lot ? effectiveHp(lot, p, gs) : 0);
        }

        // 2. Apply fixed damage to every ACTIVE participant except the rolled
        //    one; clamp at 0.
        const hpAfter = new Map<string, number>();
        for (const p of participants) {
            const before = hpBefore.get(p.lotId) ?? 0;
            if (p.active && p.lotId !== rolledLot.id) {
                hpAfter.set(p.lotId, Math.max(0, before - damage));
            } else {
                hpAfter.set(p.lotId, before);
            }
        }

        // 3. Eliminated = active participants whose HP reached 0.
        const eliminated: string[] = [];
        for (const p of participants) {
            if (p.active && (hpAfter.get(p.lotId) ?? 0) <= 0) eliminated.push(p.lotId);
        }
        const eliminatedSet = new Set(eliminated);

        // 4. New participant records: HP materialized, eliminations applied.
        const nextParticipants: GameParticipantState[] = participants.map(p => {
            const next: CrownDefenseParticipantState = { hp: hpAfter.get(p.lotId) ?? 0 };
            return {
                lotId: p.lotId,
                active: p.active && !eliminatedSet.has(p.lotId),
                modeState: next
            };
        });

        // 5. Participants whose HP actually changed (the rolled one did not).
        const changed = participants
            .filter(p => p.active && (hpAfter.get(p.lotId) ?? 0) !== (hpBefore.get(p.lotId) ?? 0))
            .map(p => p.lotId);

        // 6. Winner / completion.
        const remaining = nextParticipants.filter(p => p.active);
        let winners: string[] = [];
        let finished: boolean;

        if (remaining.length === 1) {
            finished = true;
            winners = [remaining[0].lotId];
        } else if (remaining.length > 1) {
            finished = false;
        } else {
            // Defensive: no survivors. The rolled participant is never damaged,
            // so in practice at least it survives; this branch keeps the rules
            // total and deterministic if that ever changes.
            finished = true;
            winners = [highestHpAfterDamage(participants, hpAfter)];
        }

        const winnerLot = winners.length > 0 ? lotById.get(winners[0]) : undefined;

        const result: MessageDescriptor = {
            key: 'mode.crown-defense.result',
            params: { name: rolledLot.name, damage }
        };

        const outcome: TurnOutcome = {
            rolledLotId: rolledLot.id,
            winners,
            eliminated,
            changed,
            finished,
            result
        };
        if (finished && winnerLot) {
            outcome.message = {
                key: 'mode.crown-defense.completionMessage',
                params: { name: winnerLot.name }
            };
        }

        const nextState: CrownDefenseGameState = { maxAmount: gs.maxAmount };
        return { state: nextState, participants: nextParticipants, outcome };
    }

    getPresentationData(
        participants: readonly GameParticipantState[],
        lots: readonly Lot[],
        state: GameModeState
    ): ReadonlyMap<string, ModePresentationData> {
        const gs = asGameState(state);
        const byId = new Map(lots.map(l => [l.id, l]));
        const label: MessageDescriptor = { key: 'mode.crown-defense.extLabel' };
        const result = new Map<string, ModePresentationData>();
        for (const p of participants) {
            const lot = byId.get(p.lotId);
            // Inactive lots are "not participating" — never stale HP.
            const value = p.active && lot
                ? `♥ ${Math.round(effectiveHp(lot, p, gs))}`
                : '—';
            result.set(p.lotId, { ext: { label, value } });
        }
        return result;
    }
}
