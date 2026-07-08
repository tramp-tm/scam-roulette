import { SeparatorType, ParsedLot } from './types.js';
import { parseCSV } from './csvParser.js';
import { t } from './i18n.js';

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
        
        // No need for manual translateDOM calls - let modal manager handle it
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
                this.linkStatusEl.textContent = t('importDialog.invalidUrl');
                this.linkStatusEl.className = 'link-status error';
            }
            return;
        }

        // Извлекаем оба значения из объекта
        const extracted = this.extractGoogleDocId(url);
        if (!extracted) {
            if (this.linkStatusEl) {
                this.linkStatusEl.textContent = t('importDialog.invalidUrl');
                this.linkStatusEl.className = 'link-status error';
            }
            return;
        }

        const { id, gid } = extracted;

        try {
            // Формируем URL, используя полученные id и gid
            const exportUrl =
            `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`;

            // Show loading state
            if (this.fetchBtn) {
                const originalText = this.fetchBtn.textContent;
                this.fetchBtn.disabled = true;
                this.fetchBtn.textContent = t('importDialog.loading');

                const response = await fetch(exportUrl);

                console.log(exportUrl);

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const text = await response.text();

                                console.log(text);

                // Parse the CSV data and store result for ImportDialog to use
                this.parseResult = parseCSV(text, 'comma'); // Default to comma separator

                // Update status - now we need to parse the CSV and update ImportDialog's parsed result
                if (this.linkStatusEl) {
                    const count = this.parseResult.validLots.length;
                    this.linkStatusEl.textContent = t('importDialog.fetchSuccess', { count });
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
                this.linkStatusEl.textContent = t('importDialog.fetchError');
                this.linkStatusEl.className = 'link-status error';
            }
        } finally {
            // Restore button state
            if (this.fetchBtn) {
                this.fetchBtn.disabled = false;
                this.fetchBtn.textContent = t('importDialog.fetchBtn');
            }
        }
    }


    private extractGoogleDocId(url: string): { id: string; gid: string } | null {
        try {
            const urlObj = new URL(url);

            if (
                urlObj.hostname !== 'docs.google.com' ||
                !urlObj.pathname.includes('/spreadsheets/d/')
            ) {
                return null;
            }

            const match = urlObj.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (!match) {
                return null;
            }

            const id = match[1];

            let gid = urlObj.searchParams.get('gid');

            if (!gid && urlObj.hash.startsWith('#gid=')) {
                gid = urlObj.hash.substring(5);
            }

            gid ??= '0';

            return { id, gid };
        } catch (error) {
            console.error('Invalid URL passed to extractor:', error);
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
