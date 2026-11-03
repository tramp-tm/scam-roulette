import { ModalDialog } from './modalDialog.js';
import { ModalManager } from './modalManager.js';
import { t } from './i18n.js';
import { AnimationController, EasingFunctions } from './animation.js';
import { RiskyBetStripRenderer } from './riskyBetStripRenderer.js';
import type { Lot } from './types.js';
import {
    addRiskyBetOutcome, removeRiskyBetOutcome, updateRiskyBetOutcome,
    parseNumericDraft, expectedMultiplier, prepareRiskyBet,
    type RiskyBetDistribution, type RiskyBetMode, type RiskyBetOutcome, type RiskyBetResult, type PendingRiskyBet
} from './riskyBetModel.js';

type OutcomeField = 'multiplier' | 'probability';
interface OutcomeRow {
    element: HTMLTableRowElement;
    multiplier: HTMLInputElement;
    probability: HTMLInputElement;
    percent: HTMLElement;
    action: HTMLButtonElement;
    color: string;
}

export type RiskyBetCommitResult =
    | { success: true; amount: number; presentationFailed?: boolean }
    | { success: false; reason: string };

export interface RiskyBetDialogOptions {
    getLots: () => readonly Lot[];
    getDistribution: () => RiskyBetDistribution;
    onDistributionChange: (distribution: RiskyBetDistribution) => void;
    onClosed: () => void;
    canRisk?: () => boolean;
    onCommit?: (request: { lotId: string; expectedAmount: number; amount: number }) => RiskyBetCommitResult;
}

/** Pre-game risk editor and independent spin lifecycle; all writes go through the App callback. */
export class RiskyBetDialog extends ModalDialog {
    private readonly options: RiskyBetDialogOptions;
    private readonly lotsPanel: HTMLElement;
    private readonly riskPanel: HTMLElement;
    private readonly distributionPanel: HTMLElement;
    private readonly baseInput: HTMLInputElement;
    private readonly riskInput: HTMLInputElement;
    private readonly lotList: HTMLElement;
    private readonly modeButtons = new Map<RiskyBetMode, HTMLButtonElement>();
    private readonly error: HTMLElement;
    private readonly tableBody: HTMLTableSectionElement;
    private readonly chart: HTMLElement;
    private readonly expectation: HTMLElement;
    private readonly rows = new Map<string, OutcomeRow>();
    // Only input-boundary text: the domain and App keep ordinary numeric values.
    private readonly drafts = new Map<string, string>();
    private colorIndex = 0;
    private mode: RiskyBetMode = 'add';
    private selectedLotId: string | null = null;
    private disposed = false;
    private busy = false;
    private committing = false;
    private operation = 0;
    private pending: PendingRiskyBet | null = null;
    private readonly animationController = new AnimationController();
    private renderer: RiskyBetStripRenderer | null = null;
    private stripDistribution: RiskyBetDistribution | null = null;
    private readonly canvas: HTMLCanvasElement;
    private readonly riskButton: HTMLButtonElement;
    private readonly addButton: HTMLButtonElement;
    private readonly outcomeTemplate: OutcomeRow;
    private readonly resultElement: HTMLElement;
    private spinErrorKey: string | null = null;
    private lastResult: { multiplier: number; riskAmount: number; before: number; after: number } | null = null;

    public get isCommitting(): boolean { return this.committing; }

    constructor(options: RiskyBetDialogOptions) {
        super();
        this.options = options;
        this.content!.classList.add('risky-bet-dialog');
        this.content!.setAttribute('role', 'dialog');
        this.content!.setAttribute('aria-modal', 'true');
        this.text(this.content!, 'h2', 'title');
        const zones = this.element(this.content!, 'div', 'risky-bet-zones');
        this.lotsPanel = this.element(zones, 'section', 'risky-bet-lots');
        this.distributionPanel = this.element(zones, 'section', 'risky-bet-distribution');
        this.riskPanel = this.element(zones, 'section', 'risky-bet-risk');
        this.text(this.lotsPanel, 'h3', 'lots');
        this.lotList = this.element(this.lotsPanel, 'div', 'risky-bet-lot-list');
        const controls = this.element(this.riskPanel, 'div', 'risky-bet-risk-controls');
        const modes = this.element(controls, 'div', 'risky-bet-modes switch');
        for (const mode of ['add', 'all'] as const) {
            const button = this.element(modes, 'button', 'switch-btn');
            button.type = 'button';
            button.dataset.mode = mode;
            this.element(button, 'span').textContent = mode === 'add' ? '+' : '→';
            button.dataset.i18nTitle = `riskyBet.${mode === 'add' ? 'addMode' : 'allMode'}`;
            button.onclick = () => {
                if (this.disposed || this.busy || this.mode === mode || !this.selectedLot()) return;
                this.mode = mode;
                this.resetRisk();
            };
            this.modeButtons.set(mode, button);
        }
        const baseLabel = this.element(controls, 'label');
        this.text(baseLabel, 'span', 'baseAmount');
        this.baseInput = this.element(baseLabel, 'input');
        this.baseInput.dataset.field = 'baseAmount';
        this.baseInput.readOnly = true;
        this.baseInput.value = '0';
        const riskLabel = this.element(controls, 'label');
        this.text(riskLabel, 'span', 'riskAmount');
        this.riskInput = this.element(riskLabel, 'input');
        this.riskInput.dataset.field = 'riskAmount';
        this.riskInput.value = '0';
        this.riskInput.type = 'text';
        this.riskInput.inputMode = 'decimal';
        this.riskInput.oninput = () => {
            if (this.disposed || this.busy || this.riskInput.readOnly) return;
            this.spinErrorKey = null;
            const parsed = parseNumericDraft(this.riskInput.value);
            this.riskInput.setAttribute('aria-invalid', String(!parsed.success || parsed.value <= 0));
            this.refreshError();
        };
        this.riskButton = this.text(this.riskPanel, 'button', 'risk');
        this.riskButton.className = 'btn-primary';
        this.riskButton.dataset.action = 'risk';
        this.riskButton.disabled = true;
        this.riskButton.onclick = () => this.startRisk();
        this.error = this.text(this.riskPanel, 'p', 'invalidDraft');
        this.error.className = 'risky-bet-error';
        this.error.setAttribute('role', 'alert');
        this.error.hidden = true;
        this.canvas = this.element(this.riskPanel, 'canvas', 'risky-bet-strip');
        this.canvas.setAttribute('aria-label', t('riskyBet.strip'));
        this.resultElement = this.element(this.riskPanel, 'div', 'risky-bet-result');
        this.resultElement.dataset.role = 'risk-result';
        this.resultElement.setAttribute('aria-live', 'polite');
        this.resultElement.hidden = true;
        this.text(this.distributionPanel, 'h3', 'distribution');
        const tableWrap = this.element(this.distributionPanel, 'div', 'risky-bet-table-scroll');
        this.tableBody = this.createOutcomeTable(tableWrap);
        const templateWrap = this.element(this.distributionPanel, 'div', 'risky-bet-template');
        this.outcomeTemplate = this.createOutcomeRow(undefined, this.createOutcomeTable(templateWrap));
        this.addButton = this.outcomeTemplate.action;
        const expectationLabel = this.element(this.distributionPanel, 'p');
        this.text(expectationLabel, 'span', 'expectation');
        this.expectation = this.element(expectationLabel, 'output');
        this.expectation.dataset.role = 'expectation';
        this.chart = this.element(this.distributionPanel, 'div', 'risky-bet-chart');
        this.chart.setAttribute('role', 'img');
        this.renderLots();
        this.resetRisk();
        this.refreshPresentation();
    }

    private selectedLot(): Lot | undefined {
        return this.options.getLots().find(lot => lot.id === this.selectedLotId);
    }

    private renderLots(): void {
        const lots = this.options.getLots();
        const selectedLotId = lots.some(lot => lot.id === this.selectedLotId)
            ? this.selectedLotId : lots[0]?.id ?? null;
        if (selectedLotId !== this.selectedLotId) {
            this.selectedLotId = selectedLotId;
            this.mode = 'add';
            this.resetRisk();
        }
        this.clearHandlers(this.lotList);
        this.lotList.replaceChildren();
        if (!lots.length) this.text(this.lotList, 'p', 'empty').dataset.role = 'empty';
        for (const lot of lots) {
            const button = this.element(this.lotList, 'button', 'risky-bet-lot');
            button.type = 'button';
            button.dataset.lotId = lot.id;
            button.setAttribute('aria-pressed', String(lot.id === this.selectedLotId));
            this.element(button, 'span', 'risky-bet-swatch').style.backgroundColor = lot.color;
            this.element(button, 'span', 'risky-bet-lot-name').textContent = lot.name;
            this.element(button, 'span').textContent = String(lot.amount);
            button.onclick = () => {
                if (this.disposed || this.busy || this.selectedLotId === lot.id) return;
                this.selectedLotId = lot.id;
                this.mode = 'add';
                this.resetRisk();
                this.renderLots();
            };
        }
    }

    private resetRisk(preserveResult = false): void {
        if (!preserveResult) {
            this.lastResult = null;
            this.spinErrorKey = null;
            this.renderResult();
            this.renderer?.reset();
        }
        const lot = this.selectedLot();
        this.baseInput.value = String(this.mode === 'add' ? lot?.amount ?? 0 : 0);
        this.riskInput.value = String(this.mode === 'all' ? lot?.amount ?? 0 : 0);
        this.riskInput.readOnly = this.mode === 'all';
        this.riskInput.disabled = !lot;
        this.riskInput.setAttribute('aria-invalid', 'false');
        for (const [mode, button] of this.modeButtons) {
            button.setAttribute('aria-pressed', String(mode === this.mode));
            button.classList.toggle('active', mode === this.mode);
            button.disabled = !lot;
        }
        this.refreshError();
    }

    private refreshError(): void {
        const invalid = this.riskInput.getAttribute('aria-invalid') === 'true'
            || [...this.rows.values()].some(row => row.multiplier.getAttribute('aria-invalid') === 'true'
                || row.probability.getAttribute('aria-invalid') === 'true');
        this.error.hidden = !invalid && !this.spinErrorKey;
        this.error.dataset.i18n = this.spinErrorKey ?? 'riskyBet.invalidDraft';
        this.error.textContent = t(this.error.dataset.i18n);
        this.syncSpinControls();
    }

    private saveDistribution(result: RiskyBetResult<RiskyBetDistribution>): void {
        if (this.disposed || this.busy || !result.success) return;
        this.options.onDistributionChange(result.value);
        this.renderDistribution();
        this.retranslate();
    }

    /** Same columns for the scrolling list and its persistent new-item template. */
    private createOutcomeTable(parent: HTMLElement): HTMLTableSectionElement {
        const table = this.element(parent, 'table', 'risky-bet-table');
        const columns = this.element(table, 'colgroup');
        for (const name of ['color', 'percent', 'multiplier', 'probability', 'action']) {
            this.element(columns, 'col', `risky-bet-${name}-column`);
        }
        return this.element(table, 'tbody');
    }

    private createOutcomeRow(outcome?: RiskyBetOutcome, parent = this.tableBody): OutcomeRow {
        const element = this.element(parent, 'tr', outcome ? '' : 'lot-item add-row');
        if (outcome) element.dataset.outcomeId = outcome.id;
        else element.dataset.role = 'outcome-template';
        const color = `hsl(${this.colorIndex * 137.5 % 360} 65% 48%)`;
        if (outcome) this.colorIndex++;
        this.element(this.element(element, 'td'), 'span', 'risky-bet-swatch').style.backgroundColor = color;
        const percent = this.element(this.element(element, 'td'), 'span');
        const multiplier = this.element(this.element(element, 'td'), 'input', outcome ? '' : 'add-lot-amount');
        const probability = this.element(this.element(element, 'td'), 'input', outcome ? '' : 'add-lot-amount');
        const action = this.element(this.element(element, 'td'), 'button', outcome ? 'btn-delete' : 'btn-add');
        action.textContent = outcome ? '×' : '➕';
        action.dataset.i18nTitle = outcome ? 'riskyBet.remove' : 'riskyBet.addOutcome';
        action.type = 'button';
        action.dataset.action = outcome ? 'remove' : 'add';
        action.onclick = () => {
            if (outcome) this.saveDistribution(removeRiskyBetOutcome(this.options.getDistribution(), outcome.id));
            else this.addOutcome();
        };
        for (const [field, input] of [['multiplier', multiplier], ['probability', probability]] as const) {
            input.type = 'text';
            input.inputMode = 'decimal';
            input.dataset.field = field;
            if (!outcome) input.value = '0';
            input.oninput = () => {
                if (this.disposed || this.busy || input.readOnly) return;
                if (outcome) this.drafts.set(`${outcome.id}:${field}`, input.value);
                this.validateOutcomeInput(input, field);
                if (outcome) this.refreshError();
                else this.syncOutcomeTemplate();
            };
            const commit = () => {
                if (outcome) this.commitOutcomeInput(outcome.id, field, input);
                else this.confirmTemplateInput(field, input);
            };
            input.onchange = commit;
            input.onblur = commit;
            input.onkeydown = event => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (outcome) commit();
                else this.addOutcome();
            };
        }
        return { element, multiplier, probability, percent, action, color };
    }

    private normalizeOutcomeInput(field: OutcomeField, value: number): number {
        return field === 'multiplier' ? Number(Math.min(1000000000, value).toFixed(2)) : Number(value.toFixed(3));
    }

    private confirmTemplateInput(field: OutcomeField, input: HTMLInputElement): void {
        if (this.disposed || this.busy) return;
        const parsed = parseNumericDraft(input.value);
        if (this.validateOutcomeInput(input, field) && parsed.success) {
            let value = this.normalizeOutcomeInput(field, parsed.value);
            if (field === 'probability') {
                const distribution = this.options.getDistribution();
                const budget = distribution.outcomes.find(row => row.id === distribution.baseId)!.probability;
                value = Number(Math.min(Math.max(value, 0), budget).toFixed(3));
            }
            input.value = String(value);
        }
        this.syncOutcomeTemplate();
    }

    /** Prepare both fields without publishing the intermediate zero-probability row. */
    private prepareOutcomeAddition(): RiskyBetResult<RiskyBetDistribution> {
        const multiplier = parseNumericDraft(this.outcomeTemplate.multiplier.value);
        const probability = parseNumericDraft(this.outcomeTemplate.probability.value);
        if (!multiplier.success || multiplier.value < 0) return { success: false, reason: 'invalid_multiplier' };
        if (!probability.success) return { success: false, reason: 'invalid_probability' };
        const added = addRiskyBetOutcome(this.options.getDistribution());
        if (!added.success) return added;
        const outcome = added.value.outcomes[added.value.outcomes.length - 1];
        return updateRiskyBetOutcome(added.value, outcome.id, {
            multiplier: this.normalizeOutcomeInput('multiplier', multiplier.value),
            probability: this.normalizeOutcomeInput('probability', probability.value)
        });
    }

    private syncOutcomeTemplate(): void {
        const row = this.outcomeTemplate;
        for (const field of ['multiplier', 'probability'] as const) {
            const input = row[field];
            input.disabled = this.busy;
            input.setAttribute('aria-label', t('riskyBet.addOutcome') + ' · ' + t(`riskyBet.${field}`));
            input.setAttribute('placeholder', t(`riskyBet.${field}`));
            this.validateOutcomeInput(input, field);
        }
        const prepared = this.prepareOutcomeAddition();
        this.addButton.disabled = this.busy || !prepared.success;
        row.percent.textContent = prepared.success
            ? `${Number((prepared.value.outcomes[prepared.value.outcomes.length - 1].probability * 100).toFixed(1))}%` : '—';
        row.percent.setAttribute('aria-label', t('riskyBet.percent'));
        row.color = `hsl(${this.colorIndex * 137.5 % 360} 65% 48%)`;
        row.element.querySelector<HTMLElement>('.risky-bet-swatch')!.style.backgroundColor = row.color;
    }

    private addOutcome(): void {
        if (this.disposed || this.busy) return;
        const prepared = this.prepareOutcomeAddition();
        if (!prepared.success) { this.syncOutcomeTemplate(); return; }
        this.saveDistribution(prepared);
        this.outcomeTemplate.multiplier.value = this.outcomeTemplate.probability.value = '0';
        this.syncOutcomeTemplate();
        this.outcomeTemplate.multiplier.focus();
    }

    private validateOutcomeInput(input: HTMLInputElement, field: OutcomeField): boolean {
        const parsed = parseNumericDraft(input.value);
        const valid = parsed.success && (field === 'probability' || parsed.value >= 0);
        input.setAttribute('aria-invalid', String(!valid));
        return valid;
    }

    private commitOutcomeInput(id: string, field: OutcomeField, input: HTMLInputElement): void {
        if (this.disposed || this.busy || input.readOnly) return;
        if (!this.validateOutcomeInput(input, field)) { this.refreshError(); return; }
        const parsed = parseNumericDraft(input.value);
        if (!parsed.success) return;
        const distribution = this.options.getDistribution();
        // UI precision only; amounts still use the independent LotManager policy.
        const value = this.normalizeOutcomeInput(field, parsed.value);
        const result = updateRiskyBetOutcome(distribution, id, { [field]: value });
        if (!result.success) return;
        this.drafts.delete(`${id}:${field}`);
        if (distribution.outcomes.find(row => row.id === id)?.[field] !== value) this.saveDistribution(result);
        else this.renderDistribution();
    }

    private renderDistribution(): void {
        const distribution = this.options.getDistribution();
        for (const [id, row] of this.rows) {
            if (!distribution.outcomes.some(outcome => outcome.id === id)) {
                this.clearHandlers(row.element);
                row.element.remove();
                this.rows.delete(id);
                this.drafts.delete(`${id}:multiplier`);
                this.drafts.delete(`${id}:probability`);
            }
        }
        this.chart.replaceChildren();
        const chartLabels: string[] = [];
        for (const outcome of distribution.outcomes) {
            let row = this.rows.get(outcome.id);
            if (!row) { row = this.createOutcomeRow(outcome); this.rows.set(outcome.id, row); }
            const base = outcome.id === distribution.baseId;
            row.action.disabled = base;
            for (const field of ['multiplier', 'probability'] as const) {
                const input = row[field];
                input.readOnly = base;
                if (!this.drafts.has(`${outcome.id}:${field}`)) {
                    input.value = String(Number(outcome[field].toFixed(field === 'probability' ? 3 : 2)));
                }
                input.setAttribute('aria-label', t(`riskyBet.${field}`) + ` · ${outcome.id}`);
                this.validateOutcomeInput(input, field);
            }
            const label = `x${outcome.multiplier} · ${Number((outcome.probability * 100).toFixed(6))}%`;
            row.percent.textContent = `${Number((outcome.probability * 100).toFixed(1))}%`;
            row.percent.setAttribute('aria-label', t('riskyBet.percent'));
            row.element.title = label;
            row.action.setAttribute('aria-label', t('riskyBet.remove') + ` · ${outcome.id}`);
            if (outcome.probability > 0) {
                const segment = this.element(this.chart, 'span');
                segment.dataset.segmentId = outcome.id;
                segment.style.width = `${outcome.probability * 100}%`;
                segment.style.backgroundColor = row.color;
                segment.title = label;
                segment.textContent = `x${outcome.multiplier}`;
                chartLabels.push(label);
            }
        }
        this.chart.setAttribute('aria-label', t('riskyBet.chart') + ': ' + chartLabels.join('; '));
        this.expectation.textContent = String(expectedMultiplier(distribution));
        this.updateStrip();
        this.refreshError();
    }

    private canStartRisk(): boolean {
        const parsed = parseNumericDraft(this.riskInput.value);
        return !this.disposed && !this.busy && !!this.selectedLot() && !!this.renderer
            && !!this.options.onCommit && !!this.options.canRisk?.() && this.drafts.size === 0
            && (this.mode === 'all' || (parsed.success && parsed.value > 0));
    }

    private syncSpinControls(): void {
        for (const button of this.lotList.querySelectorAll<HTMLButtonElement>('button')) button.disabled = this.busy;
        for (const button of this.modeButtons.values()) button.disabled = this.busy || !this.selectedLot();
        this.riskInput.disabled = this.busy || !this.selectedLot();
        this.riskInput.readOnly = this.busy || this.mode === 'all';
        this.syncOutcomeTemplate();
        for (const [id, row] of this.rows) {
            row.multiplier.readOnly = row.probability.readOnly = this.busy || id === this.options.getDistribution().baseId;
            row.action.disabled = this.busy || id === this.options.getDistribution().baseId;
        }
        this.riskButton.disabled = !this.canStartRisk();
        const close = this.content?.querySelector<HTMLButtonElement>('.modal-close');
        if (close) close.disabled = this.busy;
        this.riskPanel.setAttribute('aria-busy', String(this.busy));
        this.canvas.setAttribute('aria-label', t('riskyBet.strip'));
    }

    private updateStrip(): void {
        if (!this.renderer || this.busy) return;
        try {
            const distribution = this.options.getDistribution();
            if (distribution !== this.stripDistribution) {
                this.renderer.setOutcomes(distribution.outcomes);
                this.stripDistribution = distribution;
            }
            this.renderer.render();
        } catch {
            this.renderer.destroy();
            this.renderer = null;
            this.spinErrorKey = 'riskyBet.spinFailed';
        }
    }

    private renderResult(): void {
        this.resultElement.replaceChildren();
        this.resultElement.hidden = !this.lastResult;
        if (!this.lastResult) return;
        this.resultElement.setAttribute('aria-label', t('riskyBet.resultTitle'));
        const heading = this.element(this.resultElement, 'div', 'risky-bet-result-heading');
        this.element(heading, 'span', 'risky-bet-result-title').textContent = t('riskyBet.resultTitle');
        this.element(heading, 'strong', 'risky-bet-result-multiplier').textContent = `×${this.lastResult.multiplier}`;
        const values = this.element(this.resultElement, 'dl', 'risky-bet-result-values');
        for (const [field, key] of [['before', 'beforeAmount'], ['riskAmount', 'riskAmount'], ['after', 'afterAmount']] as const) {
            const metric = this.element(values, 'div', `risky-bet-result-${field}`);
            this.element(metric, 'dt').textContent = t(`riskyBet.${key}`);
            const value = this.element(metric, 'dd');
            value.dataset.resultField = field;
            value.textContent = this.lastResult[field].toFixed(2);
        }
    }

    private failRisk(reason: string): void {
        const keys: Record<string, string> = {
            amount_overflow: 'amountOverflow', conflict: 'conflict', unavailable: 'unavailable',
            invalid_amount: 'invalidDraft', invalid_risk_amount: 'invalidDraft', update_failed: 'updateFailed'
        };
        this.spinErrorKey = `riskyBet.${keys[reason] ?? 'spinFailed'}`;
        this.refreshError();
    }

    /** Decide once before animation; no UI input is consulted by completion. */
    private startRisk(): void {
        if (!this.canStartRisk()) return;
        const lot = this.selectedLot()!;
        const parsed = parseNumericDraft(this.riskInput.value);
        const prepared = prepareRiskyBet({
            lotId: lot.id, amount: lot.amount, mode: this.mode,
            riskAmount: parsed.success ? parsed.value : 0, distribution: this.options.getDistribution()
        });
        if (!prepared.success) { this.failRisk(prepared.reason); return; }
        const pending = prepared.value;
        const operation = ++this.operation;
        this.pending = pending;
        this.busy = true;
        this.spinErrorKey = null;
        this.lastResult = null;
        this.renderResult();
        this.syncSpinControls();
        try {
            this.renderer!.setOutcomes(pending.distribution.outcomes);
            this.renderer!.setSpinning(true);
            const startValue = this.renderer!.getAnimationValue();
            const endValue = this.renderer!.computeSpinTarget(pending.outcome.id, pending.durationMs);
            this.animationController.configure({
                startValue, endValue, duration: pending.durationMs, easing: EasingFunctions[pending.easing].fn,
                onUpdate: value => {
                    if (this.disposed || operation !== this.operation) return;
                    try { this.renderer!.setAnimationValue(value); this.renderer!.render(); }
                    catch { this.abortRisk(operation); }
                },
                onComplete: () => this.finishRisk(operation, pending)
            });
            this.animationController.start();
        } catch { this.abortRisk(operation); }
    }

    private abortRisk(operation: number): void {
        if (this.disposed || operation !== this.operation) return;
        this.operation++;
        this.animationController.stop();
        this.pending = null;
        this.busy = this.committing = false;
        try { this.renderer?.setSpinning(false); } catch { /* A broken renderer must not strand the modal. */ }
        this.failRisk('spin_failed');
    }

    private finishRisk(operation: number, pending: PendingRiskyBet): void {
        if (this.disposed || !this.busy || operation !== this.operation) return;
        this.operation++; // Consume completion before calling any external code.
        this.committing = true;
        let result: RiskyBetCommitResult;
        try {
            result = this.options.onCommit!({ lotId: pending.lotId, expectedAmount: pending.originalAmount, amount: pending.amount });
        } catch { result = { success: false, reason: 'update_failed' }; }
        this.pending = null;
        this.busy = this.committing = false;
        try { this.renderer?.setSpinning(false); } catch { this.spinErrorKey = 'riskyBet.spinFailed'; }
        if (result.success) {
            this.resetRisk(true);
            this.lastResult = { multiplier: pending.outcome.multiplier, riskAmount: pending.riskAmount,
                before: pending.originalAmount, after: result.amount };
            if (result.presentationFailed) this.spinErrorKey = 'riskyBet.presentationFailed';
        } else {
            this.renderLots();
            this.resetRisk();
            this.failRisk(result.reason);
        }
        this.refreshPresentation();
        this.refreshError();
    }

    private element<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = ''): HTMLElementTagNameMap[K] {
        const element = document.createElement(tag);
        element.className = className;
        parent.appendChild(element);
        return element;
    }

    private text<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, key: string): HTMLElementTagNameMap[K] {
        const element = this.element(parent, tag);
        element.dataset.i18n = `riskyBet.${key}`;
        return element;
    }

    public refreshPresentation(): void {
        if (this.disposed) return;
        if (!this.busy) this.renderLots();
        this.renderDistribution();
        this.retranslate();
        this.renderResult();
        this.syncSpinControls();
        this.content!.setAttribute('aria-label', t('riskyBet.title'));
        this.content!.querySelector('.modal-close')?.setAttribute('aria-label', t('riskyBet.close'));
        for (const [mode, button] of this.modeButtons) {
            const label = t(`riskyBet.${mode === 'add' ? 'addMode' : 'allMode'}`);
            button.setAttribute('aria-label', label);
            button.title = label;
        }
        this.addButton.setAttribute('aria-label', t('riskyBet.addOutcome'));
    }

    private clearHandlers(root: HTMLElement): void {
        for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
            element.onclick = null;
            element.oninput = null;
            element.onchange = null;
            element.onblur = null;
            element.onkeydown = null;
        }
    }

    public override open(): void {
        if (this.disposed || !this.isHidden()) return;
        this.selectedLotId = this.options.getLots()[0]?.id ?? null;
        this.mode = 'add';
        this.resetRisk();
        super.open();
        if (this.options.onCommit) {
            try {
                this.renderer = new RiskyBetStripRenderer(this.canvas);
                this.updateStrip();
            } catch {
                this.spinErrorKey = 'riskyBet.spinFailed';
            }
        }
        this.refreshPresentation();
    }

    public override close(): void { if (!this.busy) this.destroy(); }

    public override destroy(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.operation++;
        this.animationController.stop();
        this.renderer?.destroy();
        this.renderer = null;
        this.pending = null;
        if (this.overlay) ModalManager.getInstance().unregisterModal(this.overlay);
        if (this.content) this.clearHandlers(this.content);
        this.rows.clear();
        this.drafts.clear();
        super.destroy();
        this.overlay = null;
        this.content = null;
        this.options.onClosed();
    }
}
