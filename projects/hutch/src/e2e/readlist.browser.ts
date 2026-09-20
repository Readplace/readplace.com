export function growRailToFitOpenFlyout(input: { rail: string; flyout: string }): void {
	const rail = document.querySelector(input.rail);
	const flyout = document.querySelector(input.flyout);
	if (!(rail instanceof HTMLElement) || !flyout) throw new Error(`"${input.rail}" and "${input.flyout}" must be laid out to be measured`);
	const neededHeight = flyout.getBoundingClientRect().bottom - rail.getBoundingClientRect().top;
	rail.style.minHeight = `${Math.ceil(neededHeight)}px`;
}
