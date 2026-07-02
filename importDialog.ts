import { ModalDialog } from './modalDialog.js';
import { t, translateDOM } from './i18n.js';

import { SeparatorType, ParsedLot, ImportCallback } from './types.js';
import { parseCSV } from './csvParser.js';
import { generateRandomReadableColor } from './utils.js';
import { ModalManager } from './modalManager.js';

// Import the new component classes
import { CsvTabContent } from './csvTabContent.js';
import { LinkTabContent } from './linkTabContent.js';

/**
 * Dialog component for importing lots via CSV.
 * Handles preview, parsing, and triggers import callback.
 */
export class ImportDialog extends ModalDialog {
    private csvTabContent: CsvTabContent | null = null;
    private linkTabContent: LinkTabContent | null = null;
    private parsedResult: { validLots: ParsedLot[]; errorCount: number } | null = null;
    private importCallback: ImportCallback;
    private parsedLots: ParsedLot[] = [];
    private errorCount: number = 0;

    constructor(importCallback: ImportCallback) {
        super();
        
        this.importCallback = importCallback;
        
        // Set up onClose callback for cleanup when dialog closes
        this.onClose = (data?: unknown) => {
            // Reset parsed result
            this.parsedResult = null;
            
            // Always destroy the dialog to clean up DOM nodes and event listeners
            // This prevents stale state issues when reopening the import dialog
            this.destroy();
        };

        // Build the dialog UI with header, tabs, actions, and status elements
        this.renderHeader(t('importDialog.title'));
        
        this.renderTabsAndContent();

        // Initialize components after rendering
        this.initializeComponents();

        this.setupEventListeners();
    }

    private renderTabsAndContent(): void {
        const html = `
            <!-- Tab Navigation -->
            <div class="tab-navigation">
                <button class="tab-button active" data-tab="csv" data-i18n="importDialog.tabCsv">CSV Import</button>
                <button class="tab-button" data-tab="link" data-i18n="importDialog.tabLink">Link Import</button>
            </div>

            <!-- Tab Content Containers -->
            <div id="tab-csv-content" class="tab-content active">
            </div>
            
            <div id="tab-link-content" class="tab-content">
            </div>

            <!-- Status Line (always visible) -->
            <div id="import-status" class="import-status">
                <span id="valid-count" data-i18n="importDialog.validLots">0 valid lots</span>, 
                <span id="error-count" data-i18n="importDialog.errors">0 errors</span>
            </div>

            <!-- Import Actions (moved outside tab containers) -->
            <div class="import-actions">
                <button id="preview-btn" class="btn-secondary" data-i18n="importDialog.previewBtn">👁️ Preview</button>
                <button id="import-btn" class="btn-primary" data-i18n="importDialog.importBtn">📥 Import</button>
            </div>

            <!-- Shared Preview Container -->
            <div id="preview-container" class="preview-container hidden">
                <h4 data-i18n="importDialog.previewTitle">Preview:</h4>
                <ul id="preview-lots-list"></ul>
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
        }
    }

    private initializeComponents(): void {
        const csvContentContainer = document.getElementById('tab-csv-content');
        const linkContentContainer = document.getElementById('tab-link-content');

        if (csvContentContainer) {
            this.csvTabContent = new CsvTabContent(csvContentContainer);
            
            // Add listener for CSV tab updates
            if (this.csvTabContent && this.csvTabContent.getTextArea()) {
                this.csvTabContent.getTextArea()!.addEventListener('input', () => {
                    // Update when CSV content changes
                    setTimeout(() => this.updateSharedParsedLots(), 0);
                });
            }
        }

        if (linkContentContainer) {
            this.linkTabContent = new LinkTabContent(linkContentContainer);
            
            // Add listener for link tab updates  
            if (this.linkTabContent && this.linkTabContent.getLinkUrlInput()) {
                const urlInput = this.linkTabContent.getLinkUrlInput()!;
                urlInput.addEventListener('input', () => {
                    // Update when URL changes
                    this.updateSharedParsedLots();
                });
            }
        }
        
        // Initialize with first tab's data - make sure DOM is ready
        setTimeout(() => {
            this.updateSharedParsedLots();
        }, 10);
    }

    private updateSharedParsedLots(): void {
        let tabParsedResult: { validLots: ParsedLot[]; errorCount: number } | null = null;
        
        // Check which tab is currently active
        const activeTab = document.querySelector('.tab-button.active')?.dataset.tab || 'csv';
        
        if (activeTab === 'csv' && this.csvTabContent) {
            const csvResult = this.csvTabContent.getParsedResult();
            if (csvResult) {
                tabParsedResult = csvResult;
            }
        } else if (activeTab === 'link' && this.linkTabContent) {
            const linkResult = this.linkTabContent.getParsedResult();
            if (linkResult) {
                tabParsedResult = linkResult;
            }
        }

        // Update shared parsed lots
        if (tabParsedResult) {
            this.parsedLots = tabParsedResult.validLots;
            this.errorCount = tabParsedResult.errorCount;
        } else {
            this.parsedLots = [];
            this.errorCount = 0;
        }
        
        // Update the shared status elements
        this.updateSharedStatus();
    }

    private updateSharedStatus(): void {
        const validCountSpan = document.getElementById('valid-count');
        const errorCountSpan = document.getElementById('error-count');
        
        if (validCountSpan) {
            validCountSpan.textContent = `${this.parsedLots.length} valid lots`;
        }
        if (errorCountSpan) {
            errorCountSpan.textContent = `${this.errorCount} errors`;
        }
    }

    private setupEventListeners(): void {
        // Tab switching
        const tabButtons = document.querySelectorAll('.tab-button');
        const csvTabContent = document.getElementById('tab-csv-content');
        const linkTabContent = document.getElementById('tab-link-content');

        if (!csvTabContent || !linkTabContent) return;

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = (button as HTMLElement).dataset.tab;
                if (!targetTab) return;
                
                // Update active tab button styling
                tabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                
                // Show corresponding tab content
                if (targetTab === 'csv') {
                    csvTabContent.classList.add('active');
                    linkTabContent.classList.remove('active');
                } else if (targetTab === 'link') {
                    linkTabContent.classList.add('active');
                    csvTabContent.classList.remove('active');
                }
                
                // Force translation of newly revealed tab content
                setTimeout(() => {
                    try {
                        translateDOM();
                    } catch (e) {
                        console.error("translateDOM failed:", e);
                    }
                }, 0);
                
                // Update shared parsed lots when switching tabs
                this.updateSharedParsedLots();
            });
        });

        // Handle import button click
        const importBtn = document.querySelector('#import-btn');
        if (importBtn) {
            importBtn.addEventListener('click', () => this.handleImport());
        }

        // Handle preview button click
        const previewBtn = document.querySelector('#preview-btn');
        if (previewBtn) {
            previewBtn.addEventListener('click', () => this.handlePreview());
        }
    }

    private renderPreviewList(lots: (ParsedLot & { color?: string })[]): void {
        const previewList = document.getElementById('preview-lots-list') as HTMLUListElement | null;
        if (!previewList) return;
        
        previewList.innerHTML = '';
        
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
            previewList.appendChild(li);
        }
    }

    private handlePreview(): void {
        // Update shared parsed lots first
        this.updateSharedParsedLots();
        
        if (this.parsedLots.length === 0) {
            alert(t('importDialog.clickPreviewFirst'));
            return;
        }

        // Show preview container and render lots
        const previewContainer = document.getElementById('preview-container');
        if (previewContainer) {
            previewContainer.classList.remove('hidden');
            
            // Generate random colors for preview lots
            const previewLots = this.parsedLots.map(lot => ({
                ...lot,
                color: generateRandomReadableColor()
            }));
            
            this.renderPreviewList(previewLots);
        }
    }

    private handleImport(): void {
        // Update shared parsed lots first
        this.updateSharedParsedLots();
        
        if (this.parsedLots.length === 0) {
            alert(t('importDialog.clickPreviewFirst'));
            return;
        }

        // Size check passed - trigger import callback directly with ParsedLot[]
        this.importCallback(this.parsedLots);
    }
}
