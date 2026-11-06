import assert from "node:assert";
import type { RenderProxy, ResidentialEgress } from "../../domain/render-crawl/render-page.types";

const SESSION_PARAMETER = "-session-";

export function initResidentialEgress(deps: { proxy: RenderProxy; newSessionToken: () => string }): () => ResidentialEgress {
	const { proxy } = deps;
	assert(!proxy.username.includes(SESSION_PARAMETER), "Residential proxy username must not carry a session: each render mints its own");
	return () => ({
		kind: "residential",
		proxy: { ...proxy, username: `${proxy.username}${SESSION_PARAMETER}${deps.newSessionToken()}` },
	});
}
