import type { Lot } from './types.js';

/**
 * Error information returned when addLot fails.
 *
 * Machine-readable only: `reason` is a stable code, and the PRESENTATION layer
 * (`App`) maps it to a localized message. The domain deliberately does not
 * depend on i18n — the dependency points domain ← presentation, not the other way.
 */
export interface AddLotError {
    success: false;
    reason: 'max_lots_reached' | 'invalid_name' | 'invalid_amount';
}

/**
 * Success result from addLot.
 */
export interface AddLotResult {
    success: true;
    lot: Lot;
}

/**
 * Manages the collection of lots in the roulette application.
 *
 * Owns the *global* lot collection only. It knows nothing about game modes,
 * winners, rules, or which lots participate in the current game — that is
 * the responsibility of `GameSession` (see gameSession.ts).
 */
export class LotManager {
    public static readonly MAX_LOTS = 3000;
    
    constructor(private lots: Lot[]) {}

    /**
     * Final amount policy shared by creation and updates: finite values only,
     * rounded UP to decimal cents, with a minimum of 0.01.
     * Decimal digits avoid raising exact cents such as 0.07 through binary noise.
     * Returns null when the amount cannot be stored.
     */
    static normalizeAmount(amount: number): number | null {
        if (!Number.isFinite(amount)) return null;
        const bounded = Math.max(0.01, amount);
        const [coefficient, exponent = '0'] = bounded.toString().split('e');
        const fractionDigits = coefficient.split('.')[1]?.length ?? 0;
        const shift = Number(exponent) - fractionDigits + 2;
        if (shift >= 0) return bounded;

        const digits = BigInt(coefficient.replace('.', ''));
        const divisor = 10n ** BigInt(-shift);
        const cents = (digits + divisor - 1n) / divisor;
        return Number(`${cents}e-2`);
    }

    private static generateId(): string {
        return `lot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Adds a new lot to the collection.
     * @returns The added lot on success, or error information on failure
     */
    addLot(name: string, amount: number, color: string): AddLotResult | AddLotError {
        // Validate name - must be non-empty after trimming
        const trimmedName = name.trim();
        if (!trimmedName) {
            return {
                success: false,
                reason: 'invalid_name'
            };
        }

        // Creation requires a positive amount; updates may clamp a lost stake to MIN.
        const normalizedAmount = LotManager.normalizeAmount(amount);
        if (normalizedAmount === null || amount <= 0) {
            return {
                success: false,
                reason: 'invalid_amount'
            };
        }

        // Check max lots limit
        if (this.lots.length >= LotManager.MAX_LOTS) {
            return {
                success: false,
                reason: 'max_lots_reached'
            };
        }

        // All validations passed - create the lot
        const lot: Lot = {
            id: LotManager.generateId(),
            name: trimmedName,
            amount: normalizedAmount,
            color
        };

        this.lots.push(lot);
        
        return { success: true, lot };
    }

    updateLot(id: string, updates: Partial<Pick<Lot, 'name' | 'amount' | 'color'>>): boolean {
        const lot = this.lots.find(l => l.id === id);
        if (!lot) return false;

        const amount = updates.amount === undefined
            ? undefined
            : LotManager.normalizeAmount(updates.amount);
        if (amount === null) return false;

        if (updates.name !== undefined) {
            lot.name = updates.name.trim();
        }
        if (amount !== undefined) {
            lot.amount = amount;
        }
        if (updates.color !== undefined) {
            lot.color = updates.color;
        }

        return true;
    }

    deleteLot(id: string): boolean {
        const index = this.lots.findIndex(l => l.id === id);
        if (index === -1) return false;

        this.lots.splice(index, 1);
        return true;
    }

    clearAll(): void {
        this.lots.length = 0;
    }

    getTotalCount(): number {
        return this.lots.length;
    }

    getAllLots(): Lot[] {
        return [...this.lots];
    }
}
