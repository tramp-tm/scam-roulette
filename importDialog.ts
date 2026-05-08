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
    private currentSeparator: SeparatorType = 'comma';  // Default separator

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
                <!-- Header row with instruction and separator switch -->
                <div class="tab-header-row">
                    <p class="tab-instruction">Paste your lots below (name, amount per line):</p>
                    <div class="separator-switch">
                        <button id="sep-comma" class="sep-btn active" data-separator="comma">Comma (,)</button>
                        <span class="sep-divider">↹</span>
                        <button id="sep-tab" class="sep-btn" data-separator="tab">Tab</button>
                    </div>
                </div>
                
                <textarea 
                    id="import-textarea" 
                    placeholder="Alice, 100&#10;Bob, 250&#10;Charlie, 75"
                    rows="6"></textarea>
                
                <!-- Status Line (always visible) -->
                <div id="import-status" class="import-status">
                    <span id="valid-count">0</span> valid lots, 
                    <span id="error-count">0</span> errors
                </div>
                
                <div class="import-actions">
                    <button id="preview-btn" class="btn-secondary">👁️ Preview</button>
                    <button id="import-btn" class="btn-primary">📥 Import</button>
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

        // Separator switch buttons
        const sepCommaBtn = document.getElementById('sep-comma') as HTMLButtonElement;
        const sepTabBtn = document.getElementById('sep-tab') as HTMLButtonElement;
        
        if (sepCommaBtn) {
            sepCommaBtn.addEventListener('click', () => {
                this.currentSeparator = 'comma';
                sepCommaBtn.classList.add('active');
                sepTabBtn?.classList.remove('active');
                // Auto-update parsed result when separator changes
                this.autoUpdateParsedResult();
            });
        }
        
        if (sepTabBtn) {
            sepTabBtn.addEventListener('click', () => {
                this.currentSeparator = 'tab';
                sepTabBtn.classList.add('active');
                sepCommaBtn?.classList.remove('active');
                // Auto-update parsed result when separator changes
                this.autoUpdateParsedResult();
            });
        }

        // Textarea input - auto-update parsed result on fly
        this.textarea?.addEventListener('input', () => {
            this.autoUpdateParsedResult();
        });

        // Preview button - shows/hides preview container, fills if empty
        this.previewBtn?.addEventListener('click', () => this.handlePreview());

        // Import button - validates and triggers import callback
        this.importBtn?.addEventListener('click', () => this.handleImport());
    }

    /** Auto-updates parsed result on textarea input (called from event listener) */
    private autoUpdateParsedResult(): void {
        if (!this.textarea) return;
        
        const csvText = this.textarea.value;
        
        // Parse CSV text with current separator
        this.parsedResult = parseCSV(csvText, this.currentSeparator);
        
        // Update status line (always visible now)
        if (this.statusEl && this.validCountSpan && this.errorCountSpan) {
            this.validCountSpan.textContent = `${this.parsedResult.validLots.length}`;
            this.errorCountSpan.textContent = `${this.parsedResult.errorCount}`;
        }
        
        // Disable Import button if there are errors (per spec requirement)
        if (this.importBtn) {
            this.importBtn.disabled = this.parsedResult.errorCount > 0;
        }
        
        // Update preview container ONLY if it's already visible
        if (this.previewContainer && !this.previewContainer.classList.contains('hidden')) {
            if (this.parsedResult.validLots.length > 0) {
                // Generate random colors for preview lots
                const previewLots = this.parsedResult.validLots.map(lot => ({
                    ...lot,
                    color: generateRandomReadableColor()
                }));
                
                // Render to preview area
                this.renderPreviewList(previewLots);
            } else {
                // Clear preview if no valid lots
                if (this.previewList) {
                    this.previewList.innerHTML = '';
                }
            }
        }
    }

    /** Preview button handler - shows/hides preview container, fills if empty */
    private handlePreview(): void {
        if (!this.textarea || !this.previewContainer || !this.previewList) return;
        
        // If preview is hidden and we have valid lots, show it and fill it
        const validLotCount = this.parsedResult?.validLots.length ?? 0;
        if (this.previewContainer.classList.contains('hidden') && validLotCount > 0) {
            // Generate random colors for preview lots
            const previewLots = this.parsedResult.validLots.map(lot => ({
                ...lot,
                color: generateRandomReadableColor()
            }));
            
            // Render to preview area
            this.renderPreviewList(previewLots);
            
            // Show preview container
            this.previewContainer.classList.remove('hidden');
        } else if (validLotCount === 0) {
            // Hide preview if no valid lots
            this.previewContainer.classList.add('hidden');
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
        const parsedResult = this.parsedResult;
        if (!parsedResult) {
            alert('Please click "Preview" first to parse the CSV data.');
            return;
        }
        if (parsedResult.validLots.length === 0) {
            alert('No valid lots to import.');
            return;
        }

        const validLotCount = parsedResult.validLots.length;

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
