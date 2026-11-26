import assert from "node:assert/strict";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { HOME_READLIST_HEADER, NATIVE_CLIENT_HEADER } from "../../onboarding/native-client";
import { saveAccessTokenForUser } from "../../test-helpers/oauth-token";
import { READER_HOME_HREF } from "./built-in-readlists";

const useApp = useTestServer();

function view(html: string) {
	return new JSDOM(html).window.document;
}

describe("Home readlist", () => {
	it("returns to the same web view and publishes the new home only to supported native clients", async () => {
		const app = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app.server, app.auth);
		const created = await agent.post("/queue/queues").type("form").send({ label: "Weekend" });
		const slug = new URL(created.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
		assert(slug);

		const listing = view((await agent.get("/queue?queue=default&tab=done&q=weekend")).text);
		const form = listing.querySelector<HTMLFormElement>(`[data-test-readlist-menu="${slug}"] form:has([data-test-action="readlist-set-home"])`);
		assert(form);
		const saved = await agent.post(form.getAttribute("action") ?? "").type("form").send({
			returnTo: form.querySelector<HTMLInputElement>('[name="returnTo"]')?.value,
		});
		expect(saved.status).toBe(303);
		const returned = view((await agent.get(saved.headers.location)).text);
		expect(returned.querySelector('[data-test-readlist][aria-current="page"]')?.getAttribute("data-test-readlist")).toBe("default");
		expect(returned.querySelector('[role="status"][autofocus]')?.textContent).toBe("Weekend is now your home readlist.");
		expect(view((await agent.get("/queue")).text).querySelector('[data-test-readlist][aria-current="page"]')?.getAttribute("data-test-readlist")).toBe(slug);

		const user = await app.auth.findUserByEmail("test@example.com");
		assert(user);
		const token = await saveAccessTokenForUser(app, user.userId);
		const siren = (path: string) => request(app.server).get(path).set("Accept", SIREN_MEDIA_TYPE).set("Authorization", `Bearer ${token}`);
		for (const platform of ["ios", "android"]) {
			const native = await siren("/queue").set(NATIVE_CLIENT_HEADER, platform).set(HOME_READLIST_HEADER, "1");
			expect(native.body.links).toContainEqual({ rel: ["home"], href: `/queue?readlist=${slug}` });
			expect(native.body.properties.readlists[0]).toMatchObject({ rel: "current", href: "/queue" });
			const action = native.body.actions.find(({ name }: { name: string }) => name === "set-home-readlist");
			expect(action).toMatchObject({ title: "Set All as home", method: "POST" });
			const followed = await siren(`/queue?readlist=${slug}`).set(NATIVE_CLIENT_HEADER, platform).set(HOME_READLIST_HEADER, "1");
			expect(followed.body.properties.readlists).toContainEqual(expect.objectContaining({ label: "Weekend", rel: "current" }));
			expect(followed.body.actions).not.toContainEqual(expect.objectContaining({ name: "set-home-readlist" }));
		}
		const extension = await siren("/queue");
		expect(extension.body.links).toContainEqual({ rel: ["home"], href: READER_HOME_HREF });
		expect(extension.body.properties.readlists[0]).toMatchObject({ label: "All", rel: "current" });

		const allForm = view((await agent.get(`/queue?queue=${slug}`)).text)
			.querySelector<HTMLFormElement>('[data-test-readlist-menu="default"] form:has([data-test-action="readlist-set-home"])');
		assert(allForm);
		const reset = await agent.post(allForm.getAttribute("action") ?? "").type("form").send({
			returnTo: allForm.querySelector<HTMLInputElement>('[name="returnTo"]')?.value,
		});
		expect(reset.status).toBe(303);
		expect(reset.headers.location).toContain(`queue=${slug}`);
		const afterReset = view((await agent.get(reset.headers.location)).text);
		expect(afterReset.querySelector('[role="status"][autofocus]')?.textContent).toBe("All is now your home readlist.");
		const badged = Array.from(afterReset.querySelectorAll(".readlist-nav__home"), (badge) => badge.previousElementSibling?.getAttribute("data-test-readlist"));
		expect(badged.length).toBeGreaterThan(0);
		expect(new Set(badged)).toEqual(new Set(["default"]));
		expect(afterReset.querySelector('[data-test-readlist-menu="default"] [data-test-action="readlist-set-home"]')).toBeNull();
		expect(view((await agent.get("/queue")).text).querySelector('[data-test-readlist][aria-current="page"]')?.textContent).toBe("All");
		const nativeAfterReset = await siren("/queue").set(NATIVE_CLIENT_HEADER, "ios").set(HOME_READLIST_HEADER, "1");
		expect(nativeAfterReset.body.links).toContainEqual({ rel: ["root", "home"], href: "/queue" });
		expect(nativeAfterReset.body.actions).not.toContainEqual(expect.objectContaining({ name: "set-home-readlist" }));
	});

	it("offers the action in More and the phone switcher, and keeps the marker after a rejected POST", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		let writable = true;
		const app = useApp({
			...fixture,
			auth: {
				...fixture.auth,
				setHomeReadlist: (input) => writable ? fixture.auth.setHomeReadlist(input) : Promise.resolve(false),
			},
		});
		const agent = await loginAgent(app.server, app.auth);
		const user = await app.auth.findUserByEmail("test@example.com");
		assert(user);
		const createdAt = new Date("2026-11-01T01:00:00Z");
		for (let index = 1; index <= 8; index += 1) {
			await fixture.articleStore.createReadlistDefinition({
				userId: user.userId,
				slug: ReadlistSlugSchema.parse(`list-${index}`),
				label: `List ${index}`,
				createdAt,
			});
		}
		const listing = view((await agent.get("/queue")).text);
		const available = (selector: string) => Array.from(listing.querySelectorAll<HTMLFormElement>(selector))
			.find((form) => form.getAttribute("action")?.includes("/home?"));
		const more = available('#readlist-more [data-test-readlist-menu] form');
		const phone = available('#readlist-sheet [data-test-readlist-menu] form');
		assert(more && phone);
		const post = (form: HTMLFormElement) => agent.post(form.getAttribute("action") ?? "").type("form")
			.send({ returnTo: "/queue?queue=default" });
		expect((await post(more)).status).toBe(303);
		writable = false;
		const failure = await post(phone);
		expect(failure.headers.location).toContain("queue_error=unknown_readlist");
		expect(failure.headers.location).not.toContain("home_saved");
		const current = view((await agent.get("/queue")).text).querySelector('[data-test-readlist][aria-current="page"]');
		expect(current?.getAttribute("data-test-readlist")).toBe(more.getAttribute("action")?.split("/")[3]);
	});

	it("keeps Home through a rename, rejects a stale action, and falls back after a replacement", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const app = useApp(fixture);
		const agent = await loginAgent(app.server, app.auth);
		const user = await app.auth.findUserByEmail("test@example.com");
		assert(user);
		const userId = user.userId;
		const slug = ReadlistSlugSchema.parse("weekend");
		const createdAt = new Date("2026-11-01T01:00:00Z");
		await fixture.articleStore.createReadlistDefinition({ userId, slug, label: "Weekend", createdAt });
		const action = `/queue/queues/${slug}/home?createdAt=${encodeURIComponent(createdAt.toISOString())}`;
		const set = () => agent.post(action).type("form").send({ returnTo: "/queue?queue=default" });
		const active = async () => view((await agent.get("/queue")).text).querySelector('[data-test-readlist][aria-current="page"]')?.textContent;
		expect((await set()).status).toBe(303);

		await fixture.articleStore.renameReadlistDefinition({ userId, slug, label: "Saturday" });
		expect(await active()).toBe("Saturday");

		await fixture.articleStore.deleteReadlistDefinition({ userId, slug });
		await fixture.articleStore.createReadlistDefinition({ userId, slug, label: "New Weekend", createdAt: new Date("2026-11-02T01:00:00Z") });
		expect((await set()).headers.location).toContain("queue_error=unknown_readlist");
		expect(await active()).toBe("All");
	});
});
