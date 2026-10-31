import type { Server } from "node:http";
import express from "express";
import request from "supertest";
import { GlobalNav, HtmxOmitted, initBase } from "@packages/web-shell";
import type { ResolveLogin } from "@packages/web-session";
import { describeUntrackedCtas, findUntrackedCtas, useLoopbackServer } from "@packages/web-test-harness";
import { initEmbedRoutes } from "./embed.page";

const serve = useLoopbackServer();

const APP_ORIGIN = "https://readplace.com";

const guestResolver: ResolveLogin = async () => ({ isAuthenticated: false });

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
			appOrigin: APP_ORIGIN,
			base,
			resolveLogin: guestResolver,
		}),
	);
	return serve(app);
}

describe("every same-origin CTA carries its own utm_source", () => {
	it("holds across the embed docs and preview pages", async () => {
		const server = makeServer();

		const untracked: string[] = [];
		for (const path of ["/embed", "/embed/preview"]) {
			const response = await request(server).get(path);
			const found = findUntrackedCtas(response.text, { skipSelectors: [], ownOrigin: APP_ORIGIN });
			for (const line of describeUntrackedCtas(found)) untracked.push(`${path}  ${line}`);
		}

		expect(untracked).toEqual([]);
	});
});
