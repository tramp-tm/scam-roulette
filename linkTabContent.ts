/**
 * Component for Link tab content in ImportDialog
 */
export class LinkTabContent {
    private linkUrlInput: HTMLInputElement | null = null;
    private fetchBtn: HTMLButtonElement | null = null;
    private linkTextarea: HTMLTextAreaElement | null = null;
    private linkStatusEl: HTMLElement | null = null;

    constructor(container: HTMLElement) {
        this.render(container);
        this.setupEventListeners();
    }

    private render(container: HTMLElement): void {
        const html = `
            <!-- Header row with instruction -->
            <div class="tab-header-row">
                <p class="tab-instruction">Import from URL</p>
            </div>

            <!-- URL input and fetch button -->
            <div class="link-input-container">
                <input 
                    type="url" 
                    id="link-url-input" 
                    placeholder="Enter URL to fetch CSV..."
                    class="link-url-input">
                <button id="fetch-btn" class="btn-secondary">Fetch</button>
            </div>

            <!-- Status line for link tab -->
            <div id="link-status" class="link-status"></div>

            <!-- Textarea to display fetched content (read-only) -->
            <textarea 
                id="link-textarea" 
                placeholder="Fetched CSV will appear here..."
                rows="6"
                readonly></textarea>
        `;

        container.innerHTML = html;
        
        // Cache element references
        this.linkUrlInput = document.getElementById('link-url-input') as HTMLInputElement | null;
        this.fetchBtn = document.getElementById('fetch-btn') as HTMLButtonElement | null;
        this.linkTextarea = document.getElementById('link-textarea') as HTMLTextAreaElement | null;
        this.linkStatusEl = document.getElementById('link-status');
    }

    private setupEventListeners(): void {
        // Add event listener for fetch button
        if (this.fetchBtn) {
            this.fetchBtn.addEventListener('click', () => this.handleFetchFromUrl());
        }
    }

    private async handleFetchFromUrl(): Promise<void> {
        if (!this.linkUrlInput || !this.linkTextarea) return;

        const url = this.linkUrlInput.value.trim();
        if (!url) {
            if (this.linkStatusEl) {
                this.linkStatusEl.textContent = 'Please enter a valid URL';
            }
            return;
        }

        try {
            // Show loading state
            if (this.fetchBtn) {
                const originalText = this.fetchBtn.textContent;
                this.fetchBtn.disabled = true;
                this.fetchBtn.textContent = 'Fetching...';

                const response = await fetch(url);

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const text = await response.text();

                // Update textarea with fetched content
                if (this.linkTextarea) {
                    this.linkTextarea.value = text;
                }

                // Update status
                if (this.linkStatusEl) {
                    this.linkStatusEl.textContent = 'Successfully fetched CSV';
                    this.linkStatusEl.className = 'link-status success';
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

    public getLinkUrlInput(): HTMLInputElement | null {
        return this.linkUrlInput;
    }

    public getLinkTextarea(): HTMLTextAreaElement | null {
        return this.linkTextarea;
    }

    public getLinkStatusEl(): HTMLElement | null {
        return this.linkStatusEl;
    }
}
