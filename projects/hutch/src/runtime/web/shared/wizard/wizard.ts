import type { WizardStep, WizardSteps } from "./wizard.types";

export function resolveWizardStep<VM extends object>(input: {
	steps: WizardSteps<VM>;
	values: Partial<VM>;
}): WizardStep<VM> {
	const [first] = input.steps;
	return (
		input.steps.find((step) =>
			step.viewModel.some((key) => input.values[key] === undefined),
		) ?? first
	);
}
