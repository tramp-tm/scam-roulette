import { t } from './i18n.js';
import type { LotListViewOptions, RenderableLot, SortField, SortDirection } from './types.js';

/**
 * LotListView
 * -----------
 * Presentation-only UI component for the lots list.
 *
 * Owns:
 *   - the list DOM (rebuilt on every render);
 *   - the sorting state (`sortField` / `sortDirection`) and the sort controls;
 *   - the disabled state of its own controls (amount inputs, delete buttons).
 *
 * Does NOT own (and must not import or reference):
 *   - LotManager, GameSession, VisualizationDriver, App;
 *   - any lot mutation, session synchronisation, or visualization refresh;
 *   - confirmation dialogs or ErrorDialog.
 *
 * User actions inside the list are surfaced back to the caller through the
 * callbacks in `LotListViewOptions`; the caller decides whether and how to
 * mutate application state.
 */
export class LotListView {
    private readonly listContainer: HTMLUListElement;
    private readonly sortControls: HTMLElement | null;

    // Sorting is presentation state owned by this view (task §4).
    private sortField: SortField = 'name';
    private sortDirection: SortDirection = 'asc';

    // Lock state — driven only by `setLocked(boolean)` (task §7).
    private locked: boolean = false;

    // Cache of the latest render inputs so a sort click can re-render
    // without the caller having to re-supply the data.
    private lastLots: RenderableLot[] = [];
    private lastOptions: LotListViewOptions = {};

    constructor(listContainer: HTMLUListElement, sortControls: HTMLElement | null) {
        this.listContainer = listContainer;
        this.sortControls = sortControls;
        this.attachSortHandlers();
    }

    /**
     * Full re-render of the list. Sorting applies internally — callers
     * pass un-sorted data and need not care about sort order (task §4 / §10).
     */
    render(lots: RenderableLot[], options: LotListViewOptions = {}): void {
        this.lastLots = lots;
        this.lastOptions = options;

        const {
            showActions = false,
            highlightId = null,
            editableAmount = true,
            onAmountChange,
            onDelete
        } = options;

        // Sorting happens on a copy — the caller's array is never mutated.
        const sorted = [...lots].sort((a, b) => {
            if (this.sortField === 'name') {
                return this.sortDirection === 'asc'
                    ? a.name.localeCompare(b.name)
                    : b.name.localeCompare(a.name);
            }
            return this.sortDirection === 'asc'
                ? a.amount - b.amount
                : b.amount - a.amount;
        });

        this.listContainer.innerHTML = '';

        for (const lot of sorted) {
            const li = document.createElement('li');

            const classNameParts: string[] = ['lot-item'];
            if (!lot.active) classNameParts.push('inactive');
            if (lot.id === highlightId) classNameParts.push('highlighted');
            li.className = classNameParts.join(' ');

            const colorIndicator = document.createElement('div');
            colorIndicator.className = 'lot-color-indicator';
            colorIndicator.style.backgroundColor = lot.color || '#888';

            const lotName = document.createElement('span');
            lotName.className = 'lot-name';
            lotName.textContent = lot.name;
            lotName.style.flex = '1';
            lotName.style.overflow = 'hidden';
            lotName.style.textOverflow = 'ellipsis';

            const amountInput = document.createElement('input');
            amountInput.type = 'number';
            amountInput.className = 'lot-amount-input';
            amountInput.value = lot.amount.toFixed(2);
            amountInput.min = '0.01';
            amountInput.step = '0.01';

            if (!editableAmount) {
                amountInput.disabled = true;
            } else if (onAmountChange && lot.id) {
                const lotId: string = lot.id;
                amountInput.addEventListener('change', () => {
                    const newAmount = parseFloat(amountInput.value);
                    if (!isNaN(newAmount) && newAmount > 0) {
                        onAmountChange(lotId, newAmount);
                    } else {
                        amountInput.value = lot.amount.toFixed(2);
                    }
                });
            }

            li.appendChild(colorIndicator);
            li.appendChild(lotName);
            li.appendChild(amountInput);

            if (showActions && lot.id !== highlightId) {
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'lot-actions';

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-delete';
                deleteBtn.textContent = '×';
                deleteBtn.style.padding = '6px 10px';

                if (lot.id && onDelete) {
                    const lotId: string = lot.id;
                    deleteBtn.onclick = () => onDelete(lotId);
                }

                actionsDiv.appendChild(deleteBtn);
                li.appendChild(actionsDiv);
            }

            this.listContainer.appendChild(li);
        }

        // Freshly-created controls must inherit the current lock state.
        this.applyLockState();
    }

    /**
     * Applies the current lock state to the list's own controls. The
     * boolean is the only thing the view ever receives from the
     * application layer (task §7).
     */
    setLocked(locked: boolean): void {
        this.locked = locked;
        this.applyLockState();
    }

    // --- Internal --------------------------------------------------------

    private attachSortHandlers(): void {
        if (!this.sortControls) return;
        const buttons = this.sortControls.querySelectorAll<HTMLElement>('.switch-btn');
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                const field = button.dataset.sortField as SortField | undefined;
                if (!field) return;
                this.setSortField(field);
            });
        });
    }

    private setSortField(field: SortField): void {
        if (this.sortField === field) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = field;
            this.sortDirection = 'asc';
        }

        this.updateSortButtons();

        // Re-render with the cached inputs.
        this.render(this.lastLots, this.lastOptions);
    }

    private updateSortButtons(): void {
        if (!this.sortControls) return;

        const nameBtn = this.sortControls.querySelector<HTMLButtonElement>('#sort-by-name');
        const amountBtn = this.sortControls.querySelector<HTMLButtonElement>('#sort-by-amount');
        if (!nameBtn || !amountBtn) return;

        const nameLabel = t('sort.byName');
        const amountLabel = t('sort.byAmount');

        nameBtn.classList.remove('active');
        amountBtn.classList.remove('active');
        nameBtn.textContent = nameLabel;
        amountBtn.textContent = amountLabel;

        if (this.sortField === 'name') {
            nameBtn.classList.add('active');
            const arrow = this.sortDirection === 'asc' ? '↑' : '↓';
            nameBtn.textContent = `${nameLabel} ${arrow}`;
        } else {
            amountBtn.classList.add('active');
            const arrow = this.sortDirection === 'asc' ? '↑' : '↓';
            amountBtn.textContent = `${amountLabel} ${arrow}`;
        }
    }

    private applyLockState(): void {
        const amountInputs = this.listContainer.querySelectorAll<HTMLInputElement>('.lot-amount-input');
        amountInputs.forEach(el => { el.disabled = this.locked; });

        const deleteButtons = this.listContainer.querySelectorAll<HTMLButtonElement>('.btn-delete');
        deleteButtons.forEach(el => { el.disabled = this.locked; });
    }
}
