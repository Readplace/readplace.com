import type { Server } from "node:http";
import express from "express";
import request from "supertest";
import { GlobalNav, HtmxOmitted, initBase } from "@packages/web-shell";
import type { ResolveLogin } from "@packages/web-session";
import { describeUntrackedCtas, findUntrackedCtas } from "@packages/web-test-harness";
import { initEmbedRoutes } from "./embed.page";

const servers: Server[] = [];
afterEach(async () => {
	await Promise.all(
		servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
	);
});

const guestResolver: ResolveLogin = async () => ({ isAuthenticated: false });

const SNIPPET_REGIONS = ["[data-test-embed-copyable]", "pre", "code"];

function makeServer(): Server {
	const app = express();
	const base = initBase({
		staticBaseUrl: "",
		liveReload: false,
		renderNav: GlobalNav,
		htmx: HtmxOmitted,
	});
	app.use(
		"/embed",
		initEmbedRoutes({
			appOrigin: "https://readplace.com",
			base,
			resolveLogin: guestResolver,
		}),
	);
	const server = app.listen(0);
	servers.push(server);
	return server;
}

describe("every same-origin CTA carries its own utm_source", () => {
	it("holds across the embed docs and preview pages", async () => {
		const server = makeServer();

		const untracked: string[] = [];
		for (const path of ["/embed", "/embed/preview"]) {
			const response = await request(server).get(path);
			const found = findUntrackedCtas(response.text, { skipSelectors: SNIPPET_REGIONS });
			for (const line of describeUntrackedCtas(found)) untracked.push(`${path}  ${line}`);
		}

		expect(untracked).toEqual([]);
	});
});
