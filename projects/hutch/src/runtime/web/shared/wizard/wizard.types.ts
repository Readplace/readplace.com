export type WizardSurface = "popover" | "inline";

export type WizardHeading = { kind: "step" } | { kind: "task"; title: string };

export interface WizardField {
	idPrefix: string;
	errorId: string;
	invalid: boolean;
	autofocus: boolean;
}

export interface WizardStep<VM extends object> {
	id: string;
	title: string;
	description: string;
	template: (input: { values: Partial<VM>; field: WizardField }) => string;
}
