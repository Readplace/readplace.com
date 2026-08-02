import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";

const INBOX_COPYABLE_ADDRESS_TEMPLATE = readFileSync(
	join(__dirname, "inbox-copyable-address.template.html"),
	"utf-8",
);

export function renderCopyableAddress(vm: {
	address: string;
	addressAriaLabel: string;
	copyAriaLabel: string;
}): string {
	return render(INBOX_COPYABLE_ADDRESS_TEMPLATE, vm);
}
