import { ModalDialog } from './modalDialog.js';
import { SeparatorType, ParsedLot } from './types.js';
import { parseCSV } from './csvParser.js';
import { generateRandomReadableColor } from './utils.js';
import { ModalManager } from './modalManager.js';

/** Callback for when user clicks Import button */
export type ImportCallback = (parsedLots: ParsedLot[]) => void;

/**
 * Dialog component for importing lots via CSV.
 * Handles preview, parsing, and triggers import callback.
 */
export class ImportDialog extends ModalDialog {
    private textarea: HTMLTextAreaElement | null = null;
    private separatorSelect: HTMLSelectElement | null = null;
    private previewBtn: HTMLButtonElement | null = null;
    private importBtn: HTMLButtonElement | null = null;
    private statusEl: HTMLElement | null = null;
    private validCountSpan: HTMLElement | null = null;
    private errorCountSpan: HTMLElement | null = null;
    private previewContainer: HTMLElement | null = null;
    private previewList: HTMLUListElement | null = null;

    private parsedResult: { validLots: ParsedLot[]; errorCount: number } | null = null;
    private importCallback: ImportCallback;

    constructor(importCallback: ImportCallback) {
        super();
        this.importCallback = importCallback;
        
        // Set up onClose callback for cleanup when dialog closes
        this.onClose = (data?: unknown) => {
            // Reset parsed result
            this.parsedResult = null;
            
            // Clear textarea and preview
            if (this.textarea) {
                this.textarea.value = '';
            }
            if (this.previewContainer) {
                this.previewContainer.classList.add('hidden');
            }
            if (this.statusEl) {
                this.statusEl.classList.add('hidden');
            }
            if (this.importBtn) {
                this.importBtn.disabled = false;
            }
            
            // Destroy the dialog to clean up DOM nodes and event listeners
            // Only destroy if no other modals are open (we're the last one)
            const manager = ModalManager.getInstance();
            if (!manager.hasOpenModals()) {
                this.destroy();
            }
        };
        
        // Build the dialog UI
        this.renderHeader('Import Lots');
        this.renderTabsAndContent();
        this.setupEventListeners();
    }

    private renderTabsAndContent(): void {
        const html = `
            <!-- Tab Navigation -->
            <div class="tab-navigation">
                <button class="tab-button active" data-tab="csv">CSV Import</button>
                <button class="tab-button" data-tab="link">Link Import</button>
            </div>
            
            <!-- CSV Tab Content -->
            <div id="tab-csv" class="tab-content active">
                <p class="tab-instruction">Paste your lots below (name, amount per line):</p>
                
                <textarea 
                    id="import-textarea" 
                    placeholder="Alice, 100&#10;Bob, 250&#10;Charlie, 75"
                    rows="6"></textarea>
                
                <div class="settings-group">
                    <label for="separator-select">Separator:</label>
                    <select id="separator-select">
                        <option value="comma" selected>Comma (,)</option>
                        <option value="tab">Tab (&#9;)</option>
                    </select>
                </div>
                
                <div class="import-actions">
                    <button id="preview-btn" class="btn-secondary">👁️ Preview</button>
                    <button id="import-btn" class="btn-primary">📥 Import</button>
                </div>
                
                <!-- Status Line -->
                <div id="import-status" class="import-status hidden">
                    <span id="valid-count"></span> valid lots, 
                    <span id="error-count"></span> errors
                </div>
                
                <!-- Preview Container -->
                <div id="preview-container" class="preview-container hidden">
                    <h4>Preview:</h4>
                    <ul id="preview-lots-list"></ul>
                </div>
            </div>
            
            <!-- Link Tab Content (Placeholder) -->
            <div id="tab-link" class="tab-content">
                <p class="placeholder-text">Link import coming soon...</p>
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

            // Cache element references
            this.textarea = container.querySelector('#import-textarea') as HTMLTextAreaElement;
            this.separatorSelect = container.querySelector('#separator-select') as HTMLSelectElement;
            this.previewBtn = container.querySelector('#preview-btn') as HTMLButtonElement;
            this.importBtn = container.querySelector('#import-btn') as HTMLButtonElement;
            this.statusEl = container.querySelector('#import-status');
            this.validCountSpan = container.querySelector('#valid-count');
            this.errorCountSpan = container.querySelector('#error-count');
            this.previewContainer = container.querySelector('#preview-container');
            this.previewList = container.querySelector('#preview-lots-list') as HTMLUListElement;
        }
    }

    private setupEventListeners(): void {
        // Tab switching
        const tabButtons = document.querySelectorAll('.tab-button');
        const csvTabContent = document.getElementById('tab-csv');
        const linkTabContent = document.getElementById('tab-link');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = (button as HTMLElement).dataset.tab;
                if (!targetTab) return;
                
                // Update active tab button styling
                tabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                
                // Show corresponding tab content
                if (csvTabContent && linkTabContent) {
                    if (targetTab === 'csv') {
                        csvTabContent.classList.add('active');
                        linkTabContent.classList.remove('active');
                    } else if (targetTab === 'link') {
                        linkTabContent.classList.add('active');
                        csvTabContent.classList.remove('active');
                    }
                }
            });
        });

        // Preview button - parses CSV and shows preview
        this.previewBtn?.addEventListener('click', () => this.handlePreview());

        // Import button - validates and triggers import callback
        this.importBtn?.addEventListener('click', () => this.handleImport());
    }

    private handlePreview(): void {
        if (!this.textarea || !this.separatorSelect) return;
        
        const csvText = this.textarea.value;
        const separator: SeparatorType = this.separatorSelect.value === 'tab' ? 'tab' : 'comma';
        
        // Parse CSV text
        this.parsedResult = parseCSV(csvText, separator);
        
        // Update status line
        if (this.statusEl && this.validCountSpan && this.errorCountSpan) {
            this.validCountSpan.textContent = `${this.parsedResult.validLots.length}`;
            this.errorCountSpan.textContent = `${this.parsedResult.errorCount}`;
            this.statusEl.classList.remove('hidden');
        }
        
        // Disable Import button if there are errors (per spec requirement)
        if (this.importBtn) {
            this.importBtn.disabled = this.parsedResult.errorCount > 0;
        }
        
        // Render preview if there are valid lots
        if (this.previewContainer && this.previewList) {
            if (this.parsedResult.validLots.length > 0) {
                // Generate random colors for preview lots
                const previewLots = this.parsedResult.validLots.map(lot => ({
                    ...lot,
                    color: generateRandomReadableColor()
                }));
                
                // Render to preview area
                this.renderPreviewList(previewLots);
                
                this.previewContainer.classList.remove('hidden');
            } else {
                this.previewContainer.classList.add('hidden');
            }
        }
    }

    private renderPreviewList(lots: (ParsedLot & { color?: string })[]): void {
        if (!this.previewList) return;
        
        this.previewList.innerHTML = '';
        
        for (const lot of lots) {
            const li = document.createElement('li');
            li.className = 'lot-item';

            // Color indicator
            const colorIndicator = document.createElement('div');
            colorIndicator.className = 'lot-color-indicator';
            colorIndicator.style.backgroundColor = lot.color || '#888';

            // Lot name
            const lotName = document.createElement('span');
            lotName.className = 'lot-name';
            lotName.textContent = lot.name;
            lotName.style.flex = '1';
            lotName.style.overflow = 'hidden';
            lotName.style.textOverflow = 'ellipsis';

            // Amount (read-only)
            const amountInput = document.createElement('input');
            amountInput.type = 'number';
            amountInput.className = 'lot-amount-input';
            amountInput.value = lot.amount.toFixed(2);
            amountInput.disabled = true;

            li.appendChild(colorIndicator);
            li.appendChild(lotName);
            li.appendChild(amountInput);
            this.previewList.appendChild(li);
        }
    }

    private handleImport(): void {
        // Check if preview has been run with valid lots
        if (!this.parsedResult || this.parsedResult.validLots.length === 0) {
            alert('Please click "Preview" first to parse the CSV data.');
            return;
        }

        const validLotCount = this.parsedResult.validLots.length;

        // Check for zero valid lots (edge case: empty input with no errors)
        if (validLotCount === 0) {
            alert('No valid lots to import.');
            return;
        }

        // Check size limit (1000 lots maximum) - use confirm for Cancel option
        if (validLotCount > 1000) {
            const confirmed = confirm(
                `⚠️ SIZE LIMIT EXCEEDED\n\n` +
                `${validLotCount} lots exceeds the maximum limit of 1000.\n\n` +
                `Click OK to reduce and retry, or Cancel to abort.`
            );
            if (!confirmed) {
                return;
            }
            return;
        }

        // Size check passed - trigger import callback with parsed lots
        this.importCallback(this.parsedResult.validLots);
    }

}
