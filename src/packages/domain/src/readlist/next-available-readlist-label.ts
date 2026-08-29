export function nextAvailableReadlistLabel(params: {
	label: string;
	takenLabels: readonly string[];
}): string {
	const taken = new Set(params.takenLabels.map((label) => label.toLowerCase()));
	let candidate = params.label;
	let position = 1;
	while (taken.has(candidate.toLowerCase())) {
		position += 1;
		candidate = `${params.label} ${position}`;
	}
	return candidate;
}
