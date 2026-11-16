export function backdateFormLoad(input: HTMLInputElement): void {
	input.value = String(Date.now() - 5000);
}
