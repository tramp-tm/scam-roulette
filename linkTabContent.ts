import { SeparatorType, ParsedLot } from './types.js';
import { parseCSV } from './csvParser.js';

/**
 * Component for Link tab content in ImportDialog
 */
export class LinkTabContent {
    private linkUrlInput: HTMLInputElement | null = null;
    private fetchBtn: HTMLButtonElement | null = null;
    private linkTextarea: HTMLTextAreaElement | null = null;
    private linkStatusEl: HTMLElement | null = null;
    private parseResult: { validLots: ParsedLot[]; errorCount: number } | null = null;

    constructor(container: HTMLElement) {
        this.render(container);
        this.setupEventListeners();
    }

    private render(container: HTMLElement): void {
        const html = `
            <!-- Header row with instruction -->
            <div class="tab-header-row">
                <p class="tab-instruction" data-i18n="importDialog.linkInstruction">Enter a URL to fetch CSV data:</p>
            </div>

            <!-- URL input and fetch button container -->
            <div class="link-input-container">
                <input 
                    type="url" 
                    id="link-url-input" 
                    placeholder="https://example.com/lots.csv"
                    class="full-width link-url-input"
                    data-i18n-placeholder="importDialog.linkUrlPlaceholder">
                <button id="fetch-btn" class="btn-secondary" data-i18n="importDialog.fetchBtn">Fetch</button>
            </div>

            <!-- Status line for link tab -->
            <div id="link-status" class="link-status"></div>
        `;

        container.innerHTML = html;
        
        // Cache element references
        this.linkUrlInput = document.getElementById('link-url-input') as HTMLInputElement | null;
        this.fetchBtn = document.getElementById('fetch-btn') as HTMLButtonElement | null;
        this.linkTextarea = null; // Remove textarea reference since we're removing the element
        this.linkStatusEl = document.getElementById('link-status');
        
        // Apply translations to newly created elements
        translateDOM();
    }

    private setupEventListeners(): void {
        // Add event listener for fetch button
        if (this.fetchBtn) {
            this.fetchBtn.addEventListener('click', () => this.handleFetchFromUrl());
        }
        
        // Add input listener to URL input field 
        if (this.linkUrlInput) {
            this.linkUrlInput.addEventListener('input', () => {
                // Trigger update when URL changes - but we don't need to do anything special here since 
                // the fetch process will trigger an event after successful fetch anyway
            });
        }
    }

    private async handleFetchFromUrl(): Promise<void> {
        if (!this.linkUrlInput) return;

        const url = this.linkUrlInput.value.trim();
        if (!url) {
            if (this.linkStatusEl) {
                this.linkStatusEl.textContent = 'Please enter a valid URL';
                this.linkStatusEl.className = 'link-status error';
            }
            return;
        }

        // Validate and process Google Docs URL
        const googleDocId = this.extractGoogleDocId(url);
        if (!googleDocId) {
            if (this.linkStatusEl) {
                this.linkStatusEl.textContent = 'Invalid Google Docs URL. Please enter a valid spreadsheet URL.';
                this.linkStatusEl.className = 'link-status error';
            }
            return;
        }

        try {
            // Generate export link for CSV
            const exportUrl = `https://docs.google.com/spreadsheets/d/${googleDocId}/export?format=csv`;
            
            // Show loading state
            if (this.fetchBtn) {
                const originalText = this.fetchBtn.textContent;
                this.fetchBtn.disabled = true;
                this.fetchBtn.textContent = 'Fetching...';

                const response = await fetch(exportUrl);

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const text = await response.text();

                // Parse the CSV data and store result for ImportDialog to use
                this.parseResult = parseCSV(text, 'comma'); // Default to comma separator

                // Update status - now we need to parse the CSV and update ImportDialog's parsed result
                if (this.linkStatusEl) {
                    const count = this.parseResult.validLots.length;
                    this.linkStatusEl.textContent = `Successfully fetched and parsed ${count} lots`;
                    this.linkStatusEl.className = 'link-status success';
                }
                
                // Trigger input event to update shared state in ImportDialog
                if (this.linkUrlInput) {
                    const inputEvent = new Event('input', { bubbles: true });
                    this.linkUrlInput.dispatchEvent(inputEvent);
                }
            }
        } catch (error) {
            console.error('Error fetching from URL:', error);
            if (this.linkStatusEl) {
                this.linkStatusEl.textContent = `Error: ${(error as Error).message}`;
                this.linkStatusEl.className = 'link-status error';
            }
        } finally {
            // Restore button state
            if (this.fetchBtn) {
                this.fetchBtn.disabled = false;
                this.fetchBtn.textContent = 'Fetch';
            }
        }
    }

    private extractGoogleDocId(url: string): string | null {
        try {
            const urlObj = new URL(url);
            
            // Handle direct spreadsheet URLs like https://docs.google.com/spreadsheets/d/{id}/edit
            if (urlObj.hostname === 'docs.google.com' && urlObj.pathname.includes('/spreadsheets/d/')) {
                const pathParts = urlObj.pathname.split('/');
                const idIndex = pathParts.indexOf('d') + 1;
                if (idIndex > 0 && idIndex < pathParts.length) {
                    return pathParts[idIndex];
                }
            }
            
            // Handle URLs with /edit or other paths
            const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (match && match[1]) {
                return match[1];
            }
            
            return null;
        } catch (error) {
            console.error('Error parsing URL:', error);
            return null;
        }
    }

    public getLinkUrlInput(): HTMLInputElement | null {
        return this.linkUrlInput;
    }

    public getLinkTextarea(): HTMLTextAreaElement | null {
        return this.linkTextarea;
    }

    public getLinkStatusEl(): HTMLElement | null {
        return this.linkStatusEl;
    }

    public getParsedResult(): { validLots: ParsedLot[]; errorCount: number } | null {
        return this.parseResult;
    }
}
