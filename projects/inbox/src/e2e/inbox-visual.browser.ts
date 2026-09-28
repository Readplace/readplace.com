export function pinCopyableAddresses(address: string): void {
	for (const input of document.querySelectorAll("input[data-inbox-address]")) {
		if (!(input instanceof HTMLInputElement)) throw new Error("a copyable address must render as an input");
		input.value = address;
	}
}
