import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";

function readTemplate(name: string): string {
	return readFileSync(join(__dirname, name), "utf-8");
}

const EMBED_COPYABLE_TEMPLATE = readTemplate("embed-copyable.template.html");

const COPYABLE_BODY_TEMPLATES = {
	code: readTemplate("embed-copyable-code.template.html"),
	prose: readTemplate("embed-copyable-prose.template.html"),
};

interface CopyableText {
	targetId: string;
	bodyTestId: string;
	copyTestId: string;
	text: string;
}

export type EmbedCopyable = (CopyableText & { kind: "code"; template: string }) | (CopyableText & { kind: "prose" });

export function renderEmbedCopyable(vm: EmbedCopyable): string {
	return render(EMBED_COPYABLE_TEMPLATE, { ...vm, body: render(COPYABLE_BODY_TEMPLATES[vm.kind], vm) });
}
