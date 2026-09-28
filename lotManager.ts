import type { Lot } from './types.js';
import { t } from './i18n.js';

/**
 * Error information returned when addLot fails.
 */
export interface AddLotError {
    success: false;
    reason: 'max_lots_reached' | 'invalid_name' | 'invalid_amount';
    message: string;
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
                reason: 'invalid_name',
                message: t('error.invalidName')
            };
        }

        // Validate amount - must be positive number
        if (isNaN(amount) || amount <= 0) {
            return {
                success: false,
                reason: 'invalid_amount',
                message: t('error.invalidAmount')
            };
        }

        // Check max lots limit
        if (this.lots.length >= LotManager.MAX_LOTS) {
            return {
                success: false,
                reason: 'max_lots_reached',
                message: t('error.maxLotsReached', { max: LotManager.MAX_LOTS })
            };
        }

        // All validations passed - create the lot
        const lot: Lot = {
            id: LotManager.generateId(),
            name: trimmedName,
            amount: Math.max(0.01, parseFloat(amount.toString())),
            color
        };

        this.lots.push(lot);
        
        return { success: true, lot };
    }

    updateLot(id: string, updates: Partial<Pick<Lot, 'name' | 'amount' | 'color'>>): boolean {
        const lot = this.lots.find(l => l.id === id);
        if (!lot) return false;

        if (updates.name !== undefined) {
            lot.name = updates.name.trim();
        }
        if (updates.amount !== undefined) {
            lot.amount = Math.max(0.01, parseFloat(updates.amount.toString()));
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

    getLotById(id: string): Lot | undefined {
        return this.lots.find(lot => lot.id === id);
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
