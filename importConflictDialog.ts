import { ModalDialog } from './modalDialog.js';
import { ImportStrategy, ImportCallback } from './types.js';

/**
 * Visual modal dialog for resolving import conflicts.
 * Shows replace/merge/cancel buttons that stack above the ImportDialog.
 */
export class ImportConflictDialog extends ModalDialog {
    private existingCount: number;
    private resolutionCallback: ImportCallback;
    private resolveBtns: HTMLButtonElement[] = [];

    constructor(existingCount: number, resolutionCallback: ImportCallback) {
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
                this.resolutionCallback({ strategy: 'replace' });
                this.close();
            });
            
            mergeBtn.addEventListener('click', () => {
                this.resolutionCallback({ strategy: 'merge' });
                this.close();
            });
            
            cancelBtn.addEventListener('click', () => {
                this.resolutionCallback({ strategy: 'cancel' });
                this.close();
            });
        }
    }

    /** Override open to show visual modal instead of prompt */
    public override open(): void {
        super.open();
    }
}
