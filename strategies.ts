import { LotManager } from './lotManager.js';
import { ImportStrategy } from './types.js';
import { generateRandomReadableColor } from './utils.js';

/** Replace strategy - clears existing lots and imports new ones */
export const REPLACE_STRATEGY: ImportStrategy = {
    id: 'replace',
    label: '🔄 Replace',
    description: 'Remove all existing lots and import new ones',
    execute: (parsedLots, lotManager) => {
        console.log('🔄 [REPLACE] Clearing all existing lots');
        lotManager.clearAll();
        
        let added = 0;
        for (const parsedLot of parsedLots) {
            const color = generateRandomReadableColor();
            console.log(`   └─ Adding: ${parsedLot.name} ($${parsedLot.amount})`);
            lotManager.addLot(parsedLot.name, parsedLot.amount, color);
            added++;
        }
        console.log(`✅ [REPLACE] Added ${added} lots`);
    }
};

/** Merge strategy - combines existing and new lots */
export const MERGE_STRATEGY: ImportStrategy = {
    id: 'merge',
    label: '🔗 Merge',
    description: 'Keep existing lots and add new ones',
    execute: (parsedLots, lotManager) => {
        console.log('🔗 [MERGE] Merging with existing lots');
        
        let added = 0;
        let updated = 0;
        
        for (const parsedLot of parsedLots) {
            const matchingLot = lotManager.getAllLots().find(
                l => l.name.toLowerCase() === parsedLot.name.toLowerCase()
            );
            
            if (matchingLot) {
                console.log(`   └─ Updating: ${parsedLot.name} ($${matchingLot.amount} → $${parsedLot.amount})`);
                lotManager.updateLot(matchingLot.id, { amount: parsedLot.amount });
                updated++;
            } else {
                const color = generateRandomReadableColor();
                console.log(`   └─ Adding: ${parsedLot.name} ($${parsedLot.amount})`);
                lotManager.addLot(parsedLot.name, parsedLot.amount, color);
                added++;
            }
        }
        
        console.log(`✅ [MERGE] Added: ${added}, Updated: ${updated}`);
    }
};

/** Available import strategies */
export const IMPORT_STRATEGIES = [REPLACE_STRATEGY, MERGE_STRATEGY];
