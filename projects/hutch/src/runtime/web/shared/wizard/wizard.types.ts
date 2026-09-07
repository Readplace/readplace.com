export type WizardSurface = "popover" | "inline";

export interface WizardField {
	idPrefix: string;
	errorId: string;
	invalid: boolean;
}

export interface WizardStep<VM extends object, K extends keyof VM = keyof VM> {
	id: string;
	title: string;
	description: string;
	viewModel: readonly K[];
	template: (input: { values: Partial<Pick<VM, K>>; field: WizardField }) => string;
}

export type WizardSteps<VM extends object> = readonly [WizardStep<VM>, ...WizardStep<VM>[]];

export function defineWizardStep<VM extends object>() {
	return <K extends keyof VM>(step: WizardStep<VM, K>): WizardStep<VM> => step;
}
