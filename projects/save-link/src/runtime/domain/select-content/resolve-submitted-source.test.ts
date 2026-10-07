import { initResolveSubmittedSource } from "./resolve-submitted-source";

const url = "https://example.com/article";
const wrapper = `https://web.archive.org/web/20081203/${url}`;

describe("captured source identity", () => {
	const create = (verified = true) => initResolveSubmittedSource({ resolveOriginalUrl: async () => url, verifyWrapperSource: async ({ sourceUrl }) => verified ? { originalUrl: url, sourceUrl } : undefined });
	it("binds ordinary captured bytes to the effective original", async () => {
		expect(await create()({ url, sourceUrl: url, sourceOriginalUrl: url })).toBe(url);
	});
	it("binds a capture taken at the saved URL to the redirect adopted since", async () => {
		const adopted = "https://example.com/adopted-destination";
		const resolveSubmittedSource = initResolveSubmittedSource({ resolveOriginalUrl: async () => adopted, verifyWrapperSource: async () => undefined });
		expect(await resolveSubmittedSource({ url, sourceUrl: url, sourceOriginalUrl: url })).toBe(adopted);
	});
	it("rejects a direct capture for a different effective identity", async () => {
		await expect(create()({ url, sourceUrl: "https://attacker.example/article", sourceOriginalUrl: url })).rejects.toThrow("does not match");
	});
	it.each([wrapper, "https://archive.ph/unknown-shape/path"])("requires fresh wrapper verification for %s", async (sourceUrl) => {
		await expect(create(false)({ url, sourceUrl, sourceOriginalUrl: url })).rejects.toThrow("wrapper source");
		await expect(create()({ url, sourceUrl, sourceOriginalUrl: url })).resolves.toBe(url);
	});
});
