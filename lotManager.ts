import { Lot } from './types.js';

/**
 * Manages the collection of lots in the roulette application.
 */
export class LotManager {
    private static readonly MAX_LOTS = 100;
    
    constructor(private lots: Lot[]) {}

    /**
     * Generates a unique ID for new lots.
     */
    private generateId(): string {
        return `lot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Adds a new lot to the collection.
     * @returns The added lot or null if max limit reached
     */
    addLot(name: string, amount: number, color: string): Lot | null {
        if (this.lots.length >= LotManager.MAX_LOTS) {
            return null;
        }

        const lot: Lot = {
            id: this.generateId(),
            name: name.trim(),
            amount: Math.max(0.01, parseFloat(amount.toString())),
            color,
            active: true
        };

        this.lots.push(lot);
        return lot;
    }

    /**
     * Updates an existing lot.
     */
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

    /**
     * Deletes a lot from the collection.
     */
    deleteLot(id: string): boolean {
        const index = this.lots.findIndex(l => l.id === id);
        if (index === -1) return false;

        this.lots.splice(index, 1);
        return true;
    }

    /**
     * Toggles the active state of a lot.
     */
    toggleActive(id: string): boolean {
        const lot = this.lots.find(l => l.id === id);
        if (!lot) return false;

        lot.active = !lot.active;
        return true;
    }

    /**
     * Deactivates a specific lot (used in survival mode).
     */
    deactivateLot(id: string): boolean {
        const lot = this.lots.find(l => l.id === id);
        if (!lot) return false;

        lot.active = false;
        return true;
    }

    /**
     * Gets all active lots.
     */
    getActiveLots(): Lot[] {
        return this.lots.filter(lot => lot.active);
    }

    /**
     * Gets a lot by ID.
     */
    getLotById(id: string): Lot | undefined {
        return this.lots.find(lot => lot.id === id);
    }

    /**
     * Resets all lots to their initial state (all active).
     */
    resetAll(): void {
        this.lots.forEach(lot => {
            lot.active = true;
        });
    }

    /**
     * Clears all lots.
     */
    clearAll(): void {
        this.lots.length = 0;
    }

    /**
     * Gets the total count of lots.
     */
    getTotalCount(): number {
        return this.lots.length;
    }

    /**
     * Gets the count of active lots.
     */
    getActiveCount(): number {
        return this.getActiveLots().length;
    }

    /**
     * Gets all lots (including inactive ones).
     */
    getAllLots(): Lot[] {
        return [...this.lots];
    }
}
