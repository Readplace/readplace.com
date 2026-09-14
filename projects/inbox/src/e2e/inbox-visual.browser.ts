export function pinCopyableAddresses(address: string): void {
	for (const input of document.querySelectorAll(".inbox-copyable__value")) {
		if (!(input instanceof HTMLInputElement)) throw new Error("a copyable address must render as an input");
		input.value = address;
	}
}
