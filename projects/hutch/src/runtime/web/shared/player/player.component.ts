import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EnclosureRead } from "@packages/domain/article";
import { render } from "@packages/web-shell";

const PLAYER_TEMPLATE = readFileSync(join(__dirname, "player.template.html"), "utf-8");

export function renderPlayer(input: { articleId: string; enclosure: EnclosureRead }): string {
	if (input.enclosure.kind === "absent") return render(PLAYER_TEMPLATE, {});
	return render(PLAYER_TEMPLATE, { src: `/queue/${input.articleId}/enclosure` });
}
