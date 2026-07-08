import { t } from './i18n.js';
import { ModalDialog } from './modalDialog.js';
import { ImportStrategy } from './types.js';
import { IMPORT_STRATEGIES } from './importStrategies.js';

/**
 * Visual modal dialog for resolving import conflicts.
 * Shows replace/merge/cancel buttons that stack above the ImportDialog.
 */
export class ImportConflictDialog extends ModalDialog {
    private existingCount: number;
    private resolutionCallback: (strategy: ImportStrategy | null) => void;

    constructor(existingCount: number, resolutionCallback: (strategy: ImportStrategy | null) => void) {
        super();
        this.existingCount = existingCount;
        this.resolutionCallback = resolutionCallback;
        
        // Build the dialog UI
        this.renderHeader(t('importConflict.title'));
        this.renderConflictContent();
    }

    private renderConflictContent(): void {
        const strategyButtonsHtml = IMPORT_STRATEGIES.map(strategy => `
            <button id="btn-${strategy.id}" class="strategy-btn ${strategy.id}">
                <span data-i18n="importStrategy.${strategy.id}.label">${strategy.label}</span>
                <span class="strategy-desc" data-i18n="importStrategy.${strategy.id}.description">${strategy.description}</span>
            </button>
        `).join('');

        const html = `
            <div class="conflict-message">
                <p data-i18n="importConflict.existingLotsMessage" data-i18n-vars='{"count": ${this.existingCount}}'></p>
                <p data-i18n="importConflict.proceedQuestion"></p>
            </div>
            
            <div class="strategy-buttons">
                ${strategyButtonsHtml}
                
                <button id="btn-cancel" class="strategy-btn cancel">
                    <span data-i18n="button.cancel"></span>
                    <span class="strategy-desc" data-i18n="importConflict.cancelDescription"></span>
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

            // Setup event listeners for each strategy button
            IMPORT_STRATEGIES.forEach(strategy => {
                const btn = container.querySelector(`#btn-${strategy.id}`) as HTMLButtonElement;
                if (btn) {
                    btn.addEventListener('click', () => {
                        this.resolutionCallback(strategy);
                        this.close();
                    });
                }
            });
            
            // Cancel button - passes null (no strategy = no execution)
            const cancelBtn = container.querySelector('#btn-cancel') as HTMLButtonElement;
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    this.resolutionCallback(null);
                    this.close();
                });
            }
        }
    }

    /** Override open to show visual modal instead of prompt */
    public override open(): void {
        super.open();
    }
}
