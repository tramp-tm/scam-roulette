import { ModalDialog } from './modalDialog.js';

/** Strategy for handling import conflicts */
export type ImportStrategy = 'replace' | 'merge' | 'cancel';

/** Callback for when user selects a strategy */
export type ConflictResolutionCallback = (strategy: ImportStrategy) => void;

/**
 * Visual modal dialog for resolving import conflicts.
 * Shows replace/merge/cancel buttons that stack above the ImportDialog.
 */
export class ImportConflictDialog extends ModalDialog {
    private existingCount: number;
    private resolutionCallback: ConflictResolutionCallback;
    private resolveBtns: HTMLButtonElement[] = [];

    constructor(existingCount: number, resolutionCallback: ConflictResolutionCallback) {
        super();
        this.existingCount = existingCount;
        this.resolutionCallback = resolutionCallback;
        
        // Build the dialog UI
        this.renderHeader('⚠️ Import Conflict');
        this.renderConflictContent();
    }

    private renderConflictContent(): void {
        const html = `
            <div class="conflict-message">
                <p>You have <strong>${this.existingCount}</strong> existing lot(s).</p>
                <p>How would you like to proceed?</p>
            </div>
            
            <div class="strategy-buttons">
                <button id="btn-replace" class="strategy-btn replace">
                    🔄 Replace
                    <span class="strategy-desc">Remove all existing lots and import new ones</span>
                </button>
                
                <button id="btn-merge" class="strategy-btn merge">
                    🔗 Merge
                    <span class="strategy-desc">Keep existing lots and add new ones</span>
                </button>
                
                <button id="btn-cancel" class="strategy-btn cancel">
                    ❌ Cancel
                    <span class="strategy-desc">Abort import operation</span>
                </button>
            </div>
        `;

        if (this.content) {
            const container = document.createElement('div');
            container.className = 'modal-body';
            container.innerHTML = html;
            
            // Insert after header
            const header = this.content.querySelector('h2');
            if (header && header.nextSibling) {
                this.content.insertBefore(container, header.nextSibling);
            } else {
                this.content.appendChild(container);
            }

            // Cache button references and setup event listeners
            const replaceBtn = container.querySelector('#btn-replace') as HTMLButtonElement;
            const mergeBtn = container.querySelector('#btn-merge') as HTMLButtonElement;
            const cancelBtn = container.querySelector('#btn-cancel') as HTMLButtonElement;
            
            this.resolveBtns = [replaceBtn, mergeBtn, cancelBtn];
            
            replaceBtn.addEventListener('click', () => {
                this.resolutionCallback('replace');
                this.close();
            });
            
            mergeBtn.addEventListener('click', () => {
                this.resolutionCallback('merge');
                this.close();
            });
            
            cancelBtn.addEventListener('click', () => {
                this.resolutionCallback('cancel');
                this.close();
            });
        }
    }

    /** Override open to show visual modal instead of prompt */
    public override open(): void {
        super.open();
    }
}
