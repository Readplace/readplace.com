import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";

const EMBED_COPYABLE_TEMPLATE = readFileSync(join(__dirname, "embed-copyable.template.html"), "utf-8");

type CopyableKind = "code" | "prose";

const COPYABLE_BODY: Record<CopyableKind, { tag: "pre" | "p"; bodyClass: string }> = {
	code: { tag: "pre", bodyClass: "embed-copyable__body embed-copyable__body--code" },
	prose: { tag: "p", bodyClass: "embed-copyable__body embed-copyable__body--prose" },
};

export interface EmbedCopyable {
	kind: CopyableKind;
	targetId: string;
	bodyTestId: string;
	copyTestId: string;
	text: string;
}

export function renderEmbedCopyable(vm: EmbedCopyable): string {
	return render(EMBED_COPYABLE_TEMPLATE, { ...vm, ...COPYABLE_BODY[vm.kind] });
}
