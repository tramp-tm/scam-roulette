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

            
            

            <div class="import-actions">
                <button id="preview-btn" class="btn-secondary">Preview</button>
                <button id="import-btn" class="btn-primary">Import</button>
            </div>
            

        `;

        container.innerHTML = html;
        
        // Cache element references
        this.textarea = container.querySelector('#import-textarea') as HTMLTextAreaElement;
        this.previewBtn = container.querySelector('#preview-btn') as HTMLButtonElement;
        this.importBtn = container.querySelector('#import-btn') as HTMLButtonElement;
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
                
                // Trigger re-parse when separator changes
                if (this.textarea) {
                    const event = new Event('input', { bubbles: true });
                    this.textarea.dispatchEvent(event);
                }
            });
        }
        

        if (sepTabBtn) {
            sepTabBtn.addEventListener('click', () => {
                this.currentSeparator = 'tab';
                sepTabBtn.classList.add('active');
                sepCommaBtn?.classList.remove('active');
                
                // Trigger re-parse when separator changes
                if (this.textarea) {
                    const event = new Event('input', { bubbles: true });
                    this.textarea.dispatchEvent(event);
                }
            });
        }

        // Textarea input - auto-update parsed result on fly
        if (this.textarea) {
            this.textarea.addEventListener('input', () => {
                // Auto-update parsed result when content changes
                this.autoUpdateParsedResult();
            });
        }

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


    private handleImport(): void {
        // Check if we have parsed result
        const parsedResult = this.parsedResult;
        if (!parsedResult || parsedResult.validLots.length === 0) {
            alert('Please click Preview first');
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
