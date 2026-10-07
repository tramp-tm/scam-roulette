import type { SeparatorType, ParsedLot } from './csvParser.js';
import { parseCSV } from './csvParser.js';

/**
 * Component for CSV tab content in ImportDialog
 */
export class CsvTabContent {
    private container: HTMLElement;
    private textarea: HTMLTextAreaElement | null = null;
    private parsedResult: { validLots: ParsedLot[]; errorCount: number } | null = null;
    private currentSeparator: SeparatorType = 'comma';  // Default separator

    constructor(container: HTMLElement) {
        this.container = container;
        this.render();
        this.setupEventListeners();
    }

    private render(): void {
        const html = `
            <!-- Header row with instruction and separator switch -->
            <div class="tab-header-row">
                <p class="tab-instruction" data-i18n="importDialog.instruction">Paste your lots below (name, amount per line):</p>
                <div class="switch">
                    <button id="sep-comma" class="switch-btn active" data-separator="comma" data-i18n="importDialog.separatorComma">Comma (,)</button>
                    <button id="sep-tab" class="switch-btn" data-separator="tab" data-i18n="importDialog.separatorTab">Tab (↹)</button>
                </div>
            </div>

            
            <textarea 
                id="import-textarea" 
                placeholder="Paste your lots below (name, amount per line):"
                rows="6"
                data-i18n-placeholder="importDialog.placeholder"></textarea>

            
            
        `;

        this.container.innerHTML = html;
        
        // Cache element references — always WITHIN our own container, never via
        // the global document (a sibling modal may be open at the same time).
        this.textarea = this.container.querySelector('#import-textarea') as HTMLTextAreaElement;
    }

    private setupEventListeners(): void {
        // Separator switch buttons — scoped to our own container.
        const sepCommaBtn = this.container.querySelector('#sep-comma') as HTMLButtonElement;
        const sepTabBtn = this.container.querySelector('#sep-tab') as HTMLButtonElement;
        
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
