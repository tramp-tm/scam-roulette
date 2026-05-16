import { ModalDialog } from './modalDialog.js';

/**
 * A simple modal dialog for displaying error messages to users.
 */
export class ErrorDialog extends ModalDialog {
    constructor(message: string, title?: string) {
        super();
        
        this.renderHeader(title || '⚠️ Error');
        this.renderErrorContent(message);
    }
    
    private renderErrorContent(message: string): void {
        const html = `
            <div class="error-message">
                <p>${message}</p>
            </div>
            
            <div class="error-actions">
                <button id="close-error-btn" class="btn-primary">OK</button>
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

            // Setup close button event listener
            const closeBtn = container.querySelector('#close-error-btn') as HTMLButtonElement;
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    this.close();
                });
            }
        }
    }
}
