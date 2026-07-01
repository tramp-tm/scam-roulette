import { SeparatorType, ParsedLot } from './types.js';
import { parseCSV } from './csvParser.js';
import { generateRandomReadableColor } from './utils.js';

/**
 * Component for CSV tab content in ImportDialog
 */
export class CsvTabContent {
    private textarea: HTMLTextAreaElement | null = null;
    private previewBtn: HTMLButtonElement | null = null;
    private importBtn: HTMLButtonElement | null = null;
    private statusEl: HTMLElement | null = null;
    private validCountSpan: HTMLElement | null = null;
    private errorCountSpan: HTMLElement | null = null;
    private previewContainer: HTMLElement | null = null;
    private previewList: HTMLUListElement | null = null;
    private parsedResult: { validLots: ParsedLot[]; errorCount: number } | null = null;
    private currentSeparator: SeparatorType = 'comma';  // Default separator

    constructor(container: HTMLElement) {
        this.render(container);
        this.setupEventListeners();
    }

    private render(container: HTMLElement): void {
        const html = `
            <!-- Header row with instruction and separator switch -->
            <div class="tab-header-row">
                <p class="tab-instruction">CSV Import Instructions</p>
                <div class="switch">
                    <button id="sep-comma" class="switch-btn active" data-separator="comma">Comma</button>
                    <button id="sep-tab" class="switch-btn" data-separator="tab">Tab</button>
                </div>
            </div>

            
            <textarea 
                id="import-textarea" 
                placeholder="Paste CSV content here..."
                rows="6"></textarea>

            
            <!-- Status Line (always visible) -->
            <div id="import-status" class="import-status">
                <span id="valid-count">0 valid lots</span>, 
                <span id="error-count">0 errors</span>
            </div>
            

            <div class="import-actions">
                <button id="preview-btn" class="btn-secondary">Preview</button>
                <button id="import-btn" class="btn-primary">Import</button>
            </div>
            

            <!-- Preview Container -->
            <div id="preview-container" class="preview-container hidden">
                <h4>Preview:</h4>
                <ul id="preview-lots-list"></ul>
            </div>
        `;

        container.innerHTML = html;
        
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

    private setupEventListeners(): void {
        // Separator switch buttons
        const sepCommaBtn = document.getElementById('sep-comma') as HTMLButtonElement;
        const sepTabBtn = document.getElementById('sep-tab') as HTMLButtonElement;
        
        if (sepCommaBtn) {
            sepCommaBtn.addEventListener('click', () => {
                this.currentSeparator = 'comma';
                sepCommaBtn.classList.add('active');
                sepTabBtn?.classList.remove('active');
            });
        }
        

        if (sepTabBtn) {
            sepTabBtn.addEventListener('click', () => {
                this.currentSeparator = 'tab';
                sepTabBtn.classList.add('active');
                sepCommaBtn?.classList.remove('active');
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
            this.validCountSpan.textContent = `${parsedResult.validLots.length} valid lots`;
            this.errorCountSpan.textContent = `${parsedResult.errorCount} errors`;
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
            alert('Please click Preview first');
            return;
        }
        if (parsedResult.validLots.length === 0) {
            alert('No valid lots to import');
            return;
        }

        // Size check passed - trigger import callback directly with ParsedLot[]
        console.log("Importing lots:", parsedResult.validLots);
    }

    public getTextArea(): HTMLTextAreaElement | null {
        return this.textarea;
    }

    public getParsedResult(): { validLots: ParsedLot[]; errorCount: number } | null {
        return this.parsedResult;
    }
}
