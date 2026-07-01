import { ModalManager } from './modalManager.js';

import { ModalDialog } from './modalDialog.js';
import { t } from './i18n.js';

import { SeparatorType, ParsedLot, ImportCallback } from './types.js';
import { parseCSV } from './csvParser.js';
import { generateRandomReadableColor } from './utils.js';
import { ModalManager } from './modalManager.js';

/**
 * Dialog component for importing lots via CSV.
 * Handles preview, parsing, and triggers import callback.
 */
export class ImportDialog extends ModalDialog {
    private textarea: HTMLTextAreaElement | null = null;
    private previewBtn: HTMLButtonElement | null = null;
    private importBtn: HTMLButtonElement | null = null;
    private statusEl: HTMLElement | null = null;
    private validCountSpan: HTMLElement | null = null;
    private errorCountSpan: HTMLElement | null = null;
    private previewContainer: HTMLElement | null = null;
    private previewList: HTMLUListElement | null = null;

    // Link tab elements
    private linkUrlInput: HTMLInputElement | null = null;
    private fetchBtn: HTMLButtonElement | null = null;
    private linkTextarea: HTMLTextAreaElement | null = null;
    private linkStatusEl: HTMLElement | null = null;

    private parsedResult: { validLots: ParsedLot[]; errorCount: number } | null = null;
    private importCallback: ImportCallback;
    private currentSeparator: SeparatorType = 'comma';  // Default separator

    constructor(importCallback: ImportCallback) {

        super();





        // Set up onClose callback for cleanup when dialog closes








    /** Handles fetching CSV from URL */
    private handleFetchFromUrl(): void {
        if (!this.linkUrlInput || !this.fetchBtn || !this.linkTextarea) return;

        const url = this.linkUrlInput.value.trim();

        // Validate URL
        try {
            new URL(url);
        } catch (e) {
            if (this.linkStatusEl) {
                this.linkStatusEl.textContent = t('importDialog.invalidUrl');
                this.linkStatusEl.style.color = '#ff6b6b';
            }
            return;
        }

        // Show loading state
        const originalBtnText = this.fetchBtn.textContent;
        this.fetchBtn.disabled = true;
        this.fetchBtn.textContent = t('importDialog.fetching');

        if (this.linkStatusEl) {
            this.linkStatusEl.textContent = t('importDialog.loading');
            this.linkStatusEl.style.color = '#f39c12';
        }

        try {
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const text = await response.text();
            this.linkTextarea.value = text;

            // Auto-parse the fetched content
            this.autoUpdateLinkParsedResult();

            if (this.linkStatusEl) {
                this.linkStatusEl.textContent = t('importDialog.fetchSuccess');
                this.linkStatusEl.style.color = '#27ae60';
            }
        } catch (error: unknown) {
            let errorMessage = t('importDialog.fetchError');

            // Check for CORS error
            if (error instanceof TypeError && error.message.includes('fetch')) {
                errorMessage = t('importDialog.corsError');
            } else if (error instanceof Error) {
                errorMessage = `${t('importDialog.fetchError')}: ${error.message}`;
            }

            if (this.linkStatusEl) {
                this.linkStatusEl.textContent = errorMessage;
                this.linkStatusEl.style.color = '#ff6b6b';
            }
        } finally {
            // Restore button state

        
        // Set up onClose callback for cleanup when dialog closes
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

            // Clear Link tab state
            if (this.linkUrlInput) {
                this.linkUrlInput.value = '';
            }
            if (this.linkTextarea) {
                this.linkTextarea.value = '';
            }
            if (this.linkStatusEl) {
                this.linkStatusEl.textContent = '';
            }

            
            // Always destroy the dialog to clean up DOM nodes and event listeners
            // This prevents stale state issues when reopening the import dialog
            this.destroy();
        };

        


        // Build the dialog UI
        this.renderHeader('Import Lots');
        this.renderTabsAndContent();

        // Cache Link tab element references after renderTabsAndContent creates them
        this.linkUrlInput = document.getElementById('link-url-input') as HTMLInputElement | null;
        this.fetchBtn = document.getElementById('fetch-btn') as HTMLButtonElement | null;
        this.linkTextarea = document.getElementById('link-textarea') as HTMLTextAreaElement | null;
        this.linkStatusEl = document.getElementById('link-status');

        this.setupEventListeners();
    }

    private renderTabsAndContent(): void {
        const html = `
            <!-- Tab Navigation -->
            <!-- Tab Navigation -->
            <div class="tab-navigation">
                <button class="tab-button active" data-tab="csv">${t('importDialog.tabCsv')}</button>
                <button class="tab-button" data-tab="link">${t('importDialog.tabLink')}</button>
            </div>
            

            <!-- CSV Tab Content (with translation keys) -->
            <div id="tab-csv" class="tab-content active">
                <!-- Header row with instruction and separator switch -->
                <div class="tab-header-row">
                    <p class="tab-instruction">${t('importDialog.instruction')}</p>
                    <div class="switch">
                        <button id="sep-comma" class="switch-btn active" data-separator="comma">${t('importDialog.separatorComma')}</button>
                        <button id="sep-tab" class="switch-btn" data-separator="tab">${t('importDialog.separatorTab')}</button>
                    </div>
                </div>

                
                <textarea 
                    id="import-textarea" 
                    data-i18n-placeholder="importDialog.placeholder"
                    placeholder="${t('importDialog.placeholder')}"
                    rows="6"></textarea>

                
                <!-- Status Line (always visible) -->
                <div id="import-status" class="import-status">
                    <span id="valid-count">${t('importDialog.validLots')}</span>, 
                    <span id="error-count">${t('importDialog.errors')}</span>
                </div>
                

                <div class="import-actions">
                    <button id="preview-btn" class="btn-secondary">${t('importDialog.previewBtn')}</button>
                    <button id="import-btn" class="btn-primary">${t('importDialog.importBtn')}</button>
                </div>
                

                <!-- Preview Container (with translation key) -->
                <div id="preview-container" class="preview-container hidden">
                    <h4>${t('importDialog.previewTitle')}:</h4>
                    <ul id="preview-lots-list"></ul>
                </div>
            </div>
            
            <!-- Link Tab Content (Placeholder) -->
            <div id="tab-link" class="tab-content">
                <!-- Header row with instruction -->
                <div class="tab-header-row">
                    <p class="tab-instruction">${t('importDialog.linkInstruction')}</p>
                </div>

                <!-- URL input and fetch button -->
                <div class="link-input-container">
                    <input 
                        type="url" 
                        id="link-url-input" 
                        data-i18n-placeholder="importDialog.linkUrlPlaceholder"
                        placeholder="${t('importDialog.linkUrlPlaceholder')}"
                        class="link-url-input">
                    <button id="fetch-btn" class="btn-secondary">${t('importDialog.fetchBtn')}</button>
                </div>

                <!-- Status line for link tab -->
                <div id="link-status" class="link-status"></div>

                <!-- Textarea to display fetched content (read-only) -->
                <textarea 
                    id="link-textarea" 
                    data-i18n-placeholder="importDialog.linkTextareaPlaceholder"
                    placeholder="${t('importDialog.linkTextareaPlaceholder')}"
                    rows="6"
                    readonly></textarea>
            </div>
        `;

    private async handleFetchFromUrl(): Promise<void> {
        if (!this.linkUrlInput || !this.fetchBtn || !this.linkTextarea) return;

        const url = this.linkUrlInput.value.trim();

        // Validate URL
        try {
            new URL(url);
        } catch (e) {
            if (this.linkStatusEl) {
                this.linkStatusEl.textContent = t('importDialog.invalidUrl');
                this.linkStatusEl.style.color = '#ff6b6b';
            }
            return;
        }

        // Show loading state
        const originalBtnText = this.fetchBtn.textContent;
        this.fetchBtn.disabled = true;
        this.fetchBtn.textContent = t('importDialog.fetching');

        if (this.linkStatusEl) {
            this.linkStatusEl.textContent = t('importDialog.loading');
            this.linkStatusEl.style.color = '#f39c12';
        }

        try {
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const text = await response.text();
            this.linkTextarea.value = text;

            // Auto-parse the fetched content
            this.autoUpdateLinkParsedResult();

            if (this.linkStatusEl) {
                this.linkStatusEl.textContent = t('importDialog.fetchSuccess');
                this.linkStatusEl.style.color = '#27ae60';
            }
        } catch (error: unknown) {
            let errorMessage = t('importDialog.fetchError');

            // Check for CORS error
            if (error instanceof TypeError && error.message.includes('fetch')) {
                errorMessage = t('importDialog.corsError');
            } else if (error instanceof Error) {
                errorMessage = `${t('importDialog.fetchError')}: ${error.message}`;
            }

            if (this.linkStatusEl) {
                this.linkStatusEl.textContent = errorMessage;
                this.linkStatusEl.style.color = '#ff6b6b';
            }
        } finally {
            // Restore button state
            this.fetchBtn.disabled = false;
            this.fetchBtn.textContent = originalBtnText;
        }
    }

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

        // Add event listener for fetch button
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
                // Auto-update parsed result when content changes
        this.autoUpdateParsedResult();
            });
        }
        
        if (sepTabBtn) {
            sepTabBtn.addEventListener('click', () => {
                this.currentSeparator = 'tab';
                sepTabBtn.classList.add('active');
                sepCommaBtn?.classList.remove('active');
                // Auto-update parsed result when separator changes
                // Auto-update parsed result when content changes
        this.autoUpdateParsedResult();
            });
        }

        // Textarea input - auto-update parsed result on fly
        this.textarea?.addEventListener('input', () => {
            // Auto-update parsed result when content changes
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
        const parsedResult = parseCSV(csvText, this.currentSeparator);
        this.parsedResult = parsedResult;
        
        // Update status line (always visible now) - show count + type
        if (this.statusEl && this.validCountSpan && this.errorCountSpan) {
            this.validCountSpan.textContent = `${parsedResult.validLots.length} ${t('importDialog.validLots')}`;
            this.errorCountSpan.textContent = `${parsedResult.errorCount} ${t('importDialog.errors')}`;
        }
        
        // Disable Import button if there are errors (per spec requirement)
        if (this.importBtn) {
            this.importBtn.disabled = parsedResult.errorCount > 0;
        }
        
        // Update preview container ONLY if it's already visible
        if (this.previewContainer && !this.previewContainer.classList.contains('hidden')) {
            if (parsedResult.validLots.length > 0) {
                // Generate random colors for preview lots
                const previewLots = parsedResult.validLots.map(lot => ({
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
        
        // Extract parsed result for type narrowing
        const parsedResult = this.parsedResult;
        const validLotCount = parsedResult?.validLots.length ?? 0;
        
        // If preview is hidden and we have valid lots, show it and fill it
        if (this.previewContainer.classList.contains('hidden') && validLotCount > 0) {
            // Generate random colors for preview lots
            const previewLots = parsedResult!.validLots.map(lot => ({
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
        if (!parsedResult || parsedResult.validLots.length === 0) {
            alert(t('importDialog.clickPreviewFirst'));
            return;
        }
        if (parsedResult.validLots.length === 0) {
            alert(t('importDialog.noValidLots'));
            return;
        }

        // Size check passed - trigger import callback directly with ParsedLot[]
        this.importCallback(parsedResult.validLots);
    }

}
