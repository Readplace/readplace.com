import assert from "node:assert/strict";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { HOME_READLIST_HEADER, NATIVE_CLIENT_HEADER } from "../../onboarding/native-client";
import { saveAccessTokenForUser } from "../../test-helpers/oauth-token";
import { HAND_PICKED_HREF } from "./built-in-readlists";

const useApp = useTestServer();
const ASKING_ACTION_NAMES = [
	"save-article",
	"save-articles",
	"save-content",
	"stage-upload",
	"search",
	"lookup-article",
	"find-articles",
	"create-session",
	"create-browser-handoff",
	"report-age-range",
	"create-readlist",
];

function view(html: string) {
	return new JSDOM(html).window.document;
}

describe("Home readlist", () => {
	it("returns to the same web view, publishes the chosen home to any client that asks and offers set-home only to native apps", async () => {
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
			expect(action).toMatchObject({ title: "Set Main saves as home", method: "POST" });
			const followed = await siren(`/queue?readlist=${slug}`).set(NATIVE_CLIENT_HEADER, platform).set(HOME_READLIST_HEADER, "1");
			expect(followed.body.properties.readlists).toContainEqual(expect.objectContaining({ label: "Weekend", rel: "current" }));
			expect(followed.body.actions).not.toContainEqual(expect.objectContaining({ name: "set-home-readlist" }));
		}
		const asking = await siren("/queue").set(HOME_READLIST_HEADER, "1");
		expect(asking.body.links).toContainEqual({ rel: ["home"], href: `/queue?readlist=${slug}` });
		expect(asking.body.actions.map(({ name }: { name: string }) => name)).toEqual(ASKING_ACTION_NAMES);
		const extension = await siren("/queue");
		expect(extension.body.links).toContainEqual({ rel: ["home"], href: HAND_PICKED_HREF });
		expect(extension.body.properties.readlists[0]).toMatchObject({ label: "Main saves", rel: "current" });

		const allForm = view((await agent.get(`/queue?queue=${slug}`)).text)
			.querySelector<HTMLFormElement>('[data-test-readlist-menu="default"] form:has([data-test-action="readlist-set-home"])');
		assert(allForm);
		const reset = await agent.post(allForm.getAttribute("action") ?? "").type("form").send({
			returnTo: allForm.querySelector<HTMLInputElement>('[name="returnTo"]')?.value,
		});
		expect(reset.status).toBe(303);
		expect(reset.headers.location).toContain(`queue=${slug}`);
		const afterReset = view((await agent.get(reset.headers.location)).text);
		expect(afterReset.querySelector('[role="status"][autofocus]')?.textContent).toBe("Main saves is now your home readlist.");
		const badged = Array.from(afterReset.querySelectorAll(".readlist-nav__home"), (badge) => badge.previousElementSibling?.getAttribute("data-test-readlist"));
		expect(badged.length).toBeGreaterThan(0);
		expect(new Set(badged)).toEqual(new Set(["default"]));
		expect(afterReset.querySelector('[data-test-readlist-menu="default"] [data-test-action="readlist-set-home"]')).toBeNull();
		expect(view((await agent.get("/queue")).text).querySelector('[data-test-readlist][aria-current="page"]')?.textContent).toBe("Main saves");
		const nativeAfterReset = await siren("/queue").set(NATIVE_CLIENT_HEADER, "ios").set(HOME_READLIST_HEADER, "1");
		expect(nativeAfterReset.body.links).toContainEqual({ rel: ["root", "home"], href: "/queue" });
		expect(nativeAfterReset.body.actions).not.toContainEqual(expect.objectContaining({ name: "set-home-readlist" }));
	});

	it("opens the chosen home at the home entry address and Hand Picked when none is chosen", async () => {
		const app = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app.server, app.auth);
		const current = async (path: string) => view((await agent.get(path)).text)
			.querySelector('[data-test-readlist][aria-current="page"]')?.getAttribute("data-test-readlist");

		const root = await agent.get("/");
		expect(root.status).toBe(303);
		expect(root.headers.location).toBe("/queue?scope=home");
		expect(await current("/queue?scope=home")).toBe("~hand-picked");

		const created = await agent.post("/queue/queues").type("form").send({ label: "Weekend" });
		const slug = new URL(created.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
		assert(slug);
		expect(await current(`/queue?scope=home&queue=${slug}`)).toBe(slug);
		expect(await current(`/queue?scope=home&readlist=${slug}`)).toBe(slug);
		const form = view((await agent.get("/queue")).text)
			.querySelector<HTMLFormElement>(`[data-test-readlist-menu="${slug}"] form:has([data-test-action="readlist-set-home"])`);
		assert(form);
		await agent.post(form.getAttribute("action") ?? "").type("form").send({ returnTo: "/queue" });

		expect(await current("/queue?scope=home")).toBe(slug);
		expect(await current(HAND_PICKED_HREF)).toBe("~hand-picked");
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

	describe("Hand Picked as Home", () => {
		const HAND_PICKED_MENU = '[data-test-readlist-menu="~hand-picked"] form:has([data-test-action="readlist-set-home"])';
		const weekendCreatedAt = new Date("2026-11-01T01:00:00Z");
		const weekendHomeAction = `/queue/queues/weekend/home?createdAt=${encodeURIComponent(weekendCreatedAt.toISOString())}`;

		async function readerWithWeekend(options: { otherReadlists: number } = { otherReadlists: 0 }) {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const app = useApp(fixture);
			const agent = await loginAgent(app.server, app.auth);
			const user = await app.auth.findUserByEmail("test@example.com");
			assert(user);
			const slugs = ["weekend", ...Array.from({ length: options.otherReadlists }, (_, index) => `list-${index + 1}`)];
			for (const slug of slugs) {
				await fixture.articleStore.createReadlistDefinition({
					userId: user.userId,
					slug: ReadlistSlugSchema.parse(slug),
					label: slug === "weekend" ? "Weekend" : slug,
					createdAt: weekendCreatedAt,
				});
			}
			return { app, agent, userId: user.userId };
		}

		const current = (document: Document) => document.querySelector('[data-test-readlist][aria-current="page"]')?.getAttribute("data-test-readlist");

		it("offers Hand Picked as Home in the rail and the phone switcher once another readlist is Home, and stores it explicitly", async () => {
			const { app, agent, userId } = await readerWithWeekend({ otherReadlists: 7 });
			expect((await agent.post(weekendHomeAction).type("form").send({ returnTo: "/queue?queue=default" })).status).toBe(303);

			const listing = view((await agent.get("/queue?scope=hand-picked")).text);
			const forms = Array.from(listing.querySelectorAll<HTMLFormElement>(HAND_PICKED_MENU));
			expect(forms.filter((form) => form.closest("#readlist-sheet"))).toHaveLength(1);
			expect(forms.filter((form) => !form.closest("#readlist-sheet"))).toHaveLength(1);
			const form = forms[0];
			assert(form);
			const saved = await agent.post(form.getAttribute("action") ?? "").type("form").send({
				returnTo: form.querySelector<HTMLInputElement>('[name="returnTo"]')?.value,
			});
			expect(saved.status).toBe(303);
			expect(saved.headers.location).toContain("scope=hand-picked");
			expect(saved.headers.location).not.toContain("queue=default");

			const returned = view((await agent.get(saved.headers.location)).text);
			expect(current(returned)).toBe("~hand-picked");
			expect(returned.querySelector('[role="status"][autofocus]')?.textContent).toBe("Hand Picked is now your home readlist.");
			const badged = Array.from(returned.querySelectorAll(".readlist-nav__home"), (badge) =>
				badge.previousElementSibling?.getAttribute("data-test-readlist") ?? badge.previousElementSibling?.getAttribute("data-test-readlist-more-entry"));
			expect(new Set(badged)).toEqual(new Set(["~hand-picked"]));
			expect(returned.querySelector(HAND_PICKED_MENU)).toBeNull();
			expect(await app.auth.findHomeReadlist(userId)).toEqual({ slug: "~hand-picked" });
			expect(current(view((await agent.get("/queue")).text))).toBe("~hand-picked");
		});

		it("returns to Hand Picked after setting another Home from it", async () => {
			const { agent } = await readerWithWeekend();
			await agent.post("/queue/queues/~hand-picked/home").type("form").send({ returnTo: "/queue?queue=default" });

			const listing = view((await agent.get("/queue")).text);
			expect(current(listing)).toBe("~hand-picked");
			const form = listing.querySelector<HTMLFormElement>('[data-test-readlist-menu="weekend"] form:has([data-test-action="readlist-set-home"])');
			assert(form);
			const saved = await agent.post(form.getAttribute("action") ?? "").type("form").send({
				returnTo: form.querySelector<HTMLInputElement>('[name="returnTo"]')?.value,
			});
			expect(saved.headers.location).toContain("scope=hand-picked");
			const returned = view((await agent.get(saved.headers.location)).text);
			expect(current(returned)).toBe("~hand-picked");
			expect(returned.querySelector('[role="status"][autofocus]')?.textContent).toBe("Weekend is now your home readlist.");
			expect(current(view((await agent.get("/queue")).text))).toBe("weekend");
		});

		it("publishes Hand Picked's set-home action only to native clients that support Home", async () => {
			const { app, agent, userId } = await readerWithWeekend();
			await agent.post(weekendHomeAction).type("form").send({ returnTo: "/queue?queue=default" });
			const token = await saveAccessTokenForUser(app, userId);
			const siren = (path: string) => request(app.server).get(path).set("Accept", SIREN_MEDIA_TYPE).set("Authorization", `Bearer ${token}`);

			for (const platform of ["ios", "android"]) {
				const native = await siren("/queue?scope=hand-picked").set(NATIVE_CLIENT_HEADER, platform).set(HOME_READLIST_HEADER, "1");
				const action = native.body.actions.find(({ name }: { name: string }) => name === "set-home-readlist");
				expect(action).toMatchObject({ title: "Set Hand Picked as home", method: "POST" });
				const saved = await request(app.server).post(action.href).set("Accept", SIREN_MEDIA_TYPE).set("Authorization", `Bearer ${token}`)
					.set(NATIVE_CLIENT_HEADER, platform).set(HOME_READLIST_HEADER, "1");
				expect(saved.status).toBe(303);
				expect(saved.headers.location).toContain("scope=hand-picked");
				expect(await app.auth.findHomeReadlist(userId)).toEqual({ slug: "~hand-picked" });
				await agent.post(weekendHomeAction).type("form").send({ returnTo: "/queue?queue=default" });

				const unsupported = await siren("/queue?scope=hand-picked").set(NATIVE_CLIENT_HEADER, platform);
				expect(unsupported.body.actions).not.toContainEqual(expect.objectContaining({ name: "set-home-readlist" }));
			}
		});

		it("refuses Hand Picked with a creation time", async () => {
			const { app, agent, userId } = await readerWithWeekend();
			const refused = await agent.post(`/queue/queues/~hand-picked/home?createdAt=${encodeURIComponent(weekendCreatedAt.toISOString())}`)
				.type("form").send({ returnTo: "/queue?scope=hand-picked" });
			expect(refused.headers.location).toContain("queue_error=unknown_readlist");
			expect(await app.auth.findHomeReadlist(userId)).toBeUndefined();
		});

		it("offers Hand Picked as Home on a readlist's Preferences page", async () => {
			const { agent } = await readerWithWeekend();
			await agent.post(weekendHomeAction).type("form").send({ returnTo: "/queue?queue=default" });
			const preferences = view((await agent.get("/queue/queues/weekend/preferences")).text);
			expect(preferences.querySelector(HAND_PICKED_MENU)).not.toBeNull();
		});
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
		expect(await active()).toBe("Main saves");
	});
});
