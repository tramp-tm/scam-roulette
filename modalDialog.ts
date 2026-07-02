import { ModalManager } from './modalManager.js';
import { translateDOM } from './i18n.js';

/**
 * Base class for modal dialogs.
 * Provides common functionality: opening, closing, rendering structure.
 */
export abstract class ModalDialog {
    protected overlay: HTMLElement | null = null;
    protected content: HTMLElement | null = null;
    
    /** Called when dialog is opened */
    protected onOpen?: () => void;
    /** Called when dialog is closed (with optional data) */
    protected onClose?: (data?: unknown) => void;

    constructor() {
        this.createStructure();
    }

    /** Creates the modal DOM structure in document body */
    private createStructure(): void {
        const manager = ModalManager.getInstance();
        
        // Create overlay with dynamic z-index for stacking
        this.overlay = document.createElement('div');
        this.overlay.className = 'modal-overlay hidden';
        this.overlay.style.zIndex = String(manager.getNextZIndex());
        
        // Create content container
        this.content = document.createElement('div');
        this.content.className = 'modal-content';
        
        // Add close button (×)
        const closeButton = document.createElement('button');
        closeButton.className = 'modal-close';
        closeButton.innerHTML = '&times;';
        closeButton.onclick = () => this.close();
        this.content.appendChild(closeButton);

        // Assemble structure
        this.overlay.appendChild(this.content);
        document.body.appendChild(this.overlay);

        // Setup close on overlay click (outside content) - only for topmost modal
        this.overlay.addEventListener('click', (e) => {
            if (this.overlay && e.target === this.overlay && manager.isTopmost(this.overlay)) {
                this.close();
            }
        });

        // Setup close on Escape key - only for topmost modal
        const escapeHandler = (e: KeyboardEvent) => {
            if (this.overlay && e.key === 'Escape' && !this.isHidden() && manager.isTopmost(this.overlay)) {
                this.close();
            }
        };
        document.addEventListener('keydown', escapeHandler);
        
        // Store handler reference for cleanup
        (this as any)._escapeHandler = escapeHandler;
    }

    /** Opens the dialog and registers with manager */
    public open(): void {
        const manager = ModalManager.getInstance();
        
        if (this.overlay) {
            this.overlay.classList.remove('hidden');
            manager.registerModal(this.overlay);
        }
        
        this.onOpen?.();
    }

    /** Closes the dialog, unregisters from manager, and optionally passes data to onClose callback */
    public close(data?: unknown): void {
        const manager = ModalManager.getInstance();
        
        if (this.overlay) {
            this.overlay.classList.add('hidden');
            manager.unregisterModal(this.overlay);
        }
        this.onClose?.(data);
    }

    /** Checks if dialog is currently hidden */
    protected isHidden(): boolean {
        return this.overlay?.classList.contains('hidden') ?? true;
    }

    /** Renders the header section - override in subclasses */
    protected renderHeader(title: string): void {
        const header = document.createElement('h2');
        header.textContent = title;
        if (this.content) {
            // Insert after close button
            this.content.insertBefore(header, this.content.children[1] || null);
        }
    }

    /** Renders content into the dialog - override in subclasses */
    protected renderContent(html: string): void {
        if (this.content) {
            const container = document.createElement('div');
            container.className = 'modal-body';
            container.innerHTML = html;
            this.content.appendChild(container);
        }
    }

    /** Renders footer buttons - override in subclasses */
    protected renderFooter(html: string): void {
        if (this.content) {
            const footer = document.createElement('div');
            footer.className = 'modal-footer';
            footer.innerHTML = html;
            this.content.appendChild(footer);
        }
    }

    /** Cleanup on destruction */
    public destroy(): void {
        if ((this as any)._escapeHandler) {
            document.removeEventListener('keydown', (this as any)._escapeHandler);
        }
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
    }
}
