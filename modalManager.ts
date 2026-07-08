import { translateDOM } from './i18n.js';

/**
 * Singleton manager for modal dialogs.
 * Handles z-index stacking and tracks open modals in order.
 */
export class ModalManager {
    private static instance: ModalManager;
    
    private zIndexCounter = 1000;
    protected openModals: HTMLElement[] = [];

    private constructor() {}

    public static getInstance(): ModalManager {
        if (!ModalManager.instance) {
            ModalManager.instance = new ModalManager();
        }
        return ModalManager.instance;
    }

    /**
     * Gets the next available z-index for a new modal.
     */
    public getNextZIndex(): number {
        return ++this.zIndexCounter;
    }

    /**
     * Registers an open modal in the stack.
     */
    public registerModal(modalElement: HTMLElement): void {
        this.openModals.push(modalElement);
    }

    /**
     * Unregisters a closed modal from the stack.
     */
    public unregisterModal(modalElement: HTMLElement): void {
        const index = this.openModals.indexOf(modalElement);
        if (index !== -1) {
            this.openModals.splice(index, 1);
        }
    }

    /**
     * Gets the topmost (last opened) modal element.
     */
    public getTopmostModal(): HTMLElement | undefined {
        return this.openModals[this.openModals.length - 1];
    }

    /**
     * Checks if a given modal is currently the topmost one.
     */
    public isTopmost(modalElement: HTMLElement): boolean {
        const topmost = this.getTopmostModal();
        return topmost === modalElement;
    }

    /**
     * Re-translates all currently open modals
     */
    public retranslateAllOpenModals(): void {
        this.openModals.forEach(modal => {
            if (modal.classList.contains('hidden')) return;

            // Find the modal content container and translate it
            const content = modal.querySelector('.modal-content');

            // ИСПРАВЛЕНО: Проверяем, что элемент существует и является HTMLElement
            if (content && content instanceof HTMLElement) {
                // Re-translate the content
                translateDOM();

                // Trigger any custom translation logic in subclasses if needed
                this.handleModalTranslation(content);
            }
        });
    }
    /**
     * Handle custom translation logic for modals
     */
    private handleModalTranslation(content: HTMLElement): void {
        // This can be overridden by subclasses to handle specific modal translation needs
        // For now, we just ensure DOM elements are re-translated
    }
}
