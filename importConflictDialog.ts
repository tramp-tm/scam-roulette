import { ModalDialog } from './modalDialog.js';

/** Strategy for handling import conflicts */
export type ImportStrategy = 'replace' | 'merge' | 'cancel';

/** Callback for when user selects a strategy */
export type ConflictResolutionCallback = (strategy: ImportStrategy) => void;

/**
 * Simple dialog for resolving import conflicts.
 * Shows replace/merge/cancel options using browser prompt.
 */
export class ImportConflictDialog extends ModalDialog {
    private existingCount: number;
    private resolutionCallback: ConflictResolutionCallback;

    constructor(existingCount: number, resolutionCallback: ConflictResolutionCallback) {
        super();
        this.existingCount = existingCount;
        this.resolutionCallback = resolutionCallback;
        
        // This dialog uses browser prompt for simplicity
        // The base ModalDialog structure is created but we use prompt instead
    }

    /** Shows the conflict resolution prompt */
    public show(): void {
        const choice = prompt(
            `⚠️ CONFLICT DETECTED\n\nYou have ${this.existingCount} existing lot(s).\nHow would you like to proceed?\n\n` +
            `[1] Replace - Remove all existing lots and import new ones\n` +
            `[2] Merge - Keep existing lots and add new ones\n` +
            `[0] Cancel - Abort import operation`,
            '2'  // Default to merge
        );
        
        if (choice === null) {
            // User clicked Cancel/Close on prompt
            this.resolutionCallback('cancel');
            return;
        }
        
        const trimmedChoice = choice.trim().toLowerCase();
        
        if (trimmedChoice === '1' || trimmedChoice === 'replace') {
            this.resolutionCallback('replace');
        } else if (trimmedChoice === '2' || trimmedChoice === 'merge') {
            this.resolutionCallback('merge');
        } else {
            // Invalid choice - treat as cancel
            alert('Invalid selection. Import cancelled.');
            this.resolutionCallback('cancel');
        }
    }

    /** Override open to show prompt instead */
    public override open(): void {
        this.show();
    }
}
