import { SeparatorType, ParsedLot } from './types.js';
import { parseCSV } from './csvParser.js';

/**
 * Component for CSV tab content in ImportDialog
 */
export class CsvTabContent {
    private textarea: HTMLTextAreaElement | null = null;
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
                <p class="tab-instruction" data-i18n="importDialog.instruction">CSV Import Instructions</p>
                <div class="switch">
                    <button id="sep-comma" class="switch-btn active" data-separator="comma" data-i18n="importDialog.separatorComma">Comma</button>
                    <button id="sep-tab" class="switch-btn" data-separator="tab" data-i18n="importDialog.separatorTab">Tab</button>
                </div>
            </div>

            
            <textarea 
                id="import-textarea" 
                placeholder="Paste CSV content here..."
                rows="6"
                data-i18n-placeholder="importDialog.placeholder"></textarea>

            
            
        `;

        container.innerHTML = html;
        
        // Cache element references
        this.textarea = container.querySelector('#import-textarea') as HTMLTextAreaElement;
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
    }

    /** Auto-updates parsed result on textarea input (called from event listener) */
    private autoUpdateParsedResult(): void {
        if (!this.textarea) return;
        
        const csvText = this.textarea.value;
        
        // Parse CSV text with current separator
        const parsedResult = parseCSV(csvText, this.currentSeparator);
        this.parsedResult = parsedResult;
    }

    public getTextArea(): HTMLTextAreaElement | null {
        return this.textarea;
    }

    public getParsedResult(): { validLots: ParsedLot[]; errorCount: number } | null {
        return this.parsedResult;
    }
}
