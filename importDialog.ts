import { ModalDialog } from './modalDialog.js';
import { t } from './i18n.js';

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
                <button class="tab-button active" data-tab="csv">${t('importDialog.tabCsv')}</button>
                <button class="tab-button" data-tab="link">${t('importDialog.tabLink')}</button>
            </div>

            <!-- Tab Content Containers -->
            <div id="tab-csv-content" class="tab-content active">
                <!-- CSV tab content will be rendered by CsvTabContent component -->
            </div>
            
            <div id="tab-link-content" class="tab-content">
                <!-- Link tab content will be rendered by LinkTabContent component -->
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
        }

        if (linkContentContainer) {
            this.linkTabContent = new LinkTabContent(linkContentContainer);
        }
    }

    private setupEventListeners(): void {
        // Tab switching
        const tabButtons = document.querySelectorAll('.tab-button');
        const csvTabContent = document.getElementById('tab-csv-content');
        const linkTabContent = document.getElementById('tab-link-content');

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

    private handlePreview(): void {
        if (!this.csvTabContent) return;
        
        const parsedResult = this.csvTabContent.getParsedResult();
        if (!parsedResult || parsedResult.validLots.length === 0) {
            alert(t('importDialog.clickPreviewFirst'));
            return;
        }
        
        // In a real implementation, we would show the preview here
        console.log("Previewing lots:", parsedResult.validLots);
    }

    private handleImport(): void {
        if (!this.csvTabContent) return;
        
        const parsedResult = this.csvTabContent.getParsedResult();
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
