import { type BannerState, generateCspNonce, type PageBody } from "@packages/web-shell";
import { initRefuseAdminAccess } from "./admin-forbidden.page";

describe("initRefuseAdminAccess", () => {
	it("renders the admin refusal page with a 403, the caller's styles and the requester's banner state", async () => {
		const bannerState: BannerState = { isAuthenticated: true, emailVerified: true, cspNonce: generateCspNonce() };
		const rendered: { body?: PageBody; state?: BannerState } = {};
		const sent: { status?: number; headers?: Record<string, string>; body?: string } = {};
		const refuse = initRefuseAdminAccess({
			base: (body, state) => {
				rendered.body = body;
				rendered.state = state;
				return {
					to: () => ({ statusCode: 403, headers: { "content-type": "text/html" }, body: "page" }),
				};
			},
			bannerStateFor: async (req: { userId: string }) => {
				expect(req.userId).toBe("user-bob");
				return bannerState;
			},
			styles: ".admin-index {}",
		});
		const res = {
			status(code: number) {
				sent.status = code;
				return res;
			},
			set(headers: Record<string, string>) {
				sent.headers = headers;
				return res;
			},
			send(body: string) {
				sent.body = body;
				return res;
			},
		};

		await refuse({ userId: "user-bob", get: () => undefined, accepts: () => "text/html" }, res);

		expect(sent).toEqual({ status: 403, headers: { "content-type": "text/html" }, body: "page" });
		expect(rendered.body?.statusCode).toBe(403);
		expect(rendered.state).toBe(bannerState);
		expect(rendered.body?.styles).toBe(".admin-index {}");
		expect(rendered.body?.bodyClass).toBe("page-admin-forbidden");
		expect(rendered.body?.seo.robots).toBe("noindex, nofollow");
		expect(rendered.body?.content.html).toContain("data-test-admin-forbidden");
	});
});
