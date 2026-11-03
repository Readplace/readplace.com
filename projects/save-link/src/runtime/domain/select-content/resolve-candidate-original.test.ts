import { initResolveCandidateOriginal } from "./resolve-candidate-original";

describe("resolving a candidate's original", () => {
	it("uses adopted identity and accepts ordinary legacy row identity", async () => {
		const resolveAdopted = initResolveCandidateOriginal({ findIdentityRow: async () => ({ kind: "article", originalUrl: "https://trusted.example/article" }) });
		expect(await resolveAdopted("https://redirector.example/a")).toBe("https://trusted.example/article");
		const resolveLegacy = initResolveCandidateOriginal({ findIdentityRow: async () => ({ kind: "article" }) });
		expect(await resolveLegacy("https://example.com/a")).toBe("https://example.com/a");
	});
	it("rejects a missing identity and unresolved legacy wrapper identity", async () => {
		const missing = initResolveCandidateOriginal({ findIdentityRow: async () => ({ kind: "absent" }) });
		await expect(missing("https://example.com/a")).rejects.toThrow("existing article");
		const wrapper = initResolveCandidateOriginal({ findIdentityRow: async () => ({ kind: "article" }) });
		await expect(wrapper("https://web.archive.org/web/20081203/https://example.com/a")).rejects.toThrow("wrapper cannot");
		await expect(wrapper("https://javascriptweekly.com/link/100000/rss")).rejects.toThrow("wrapper cannot");
	});
	it("accepts an Apple News link kept as its own original", async () => {
		const apple = "https://apple.news/AbxPgQQdpQSy-ERx2g-kQZA";
		expect(await initResolveCandidateOriginal({ findIdentityRow: async () => ({ kind: "article" }) })(apple)).toBe(apple);
	});
	it("accepts an archive.today short link kept as its own original", async () => {
		const archive = "https://archive.ph/Ab1cD";
		expect(await initResolveCandidateOriginal({ findIdentityRow: async () => ({ kind: "article", originalUrl: archive }) })(archive)).toBe(archive);
	});
	it("accepts a tracker link saved as its own article before its platform was recognised", async () => {
		const beehiiv = "https://link.mail.beehiiv.com/ss/c/u001.TOKEN/4kq/AbCd/h1/TOKEN";
		expect(await initResolveCandidateOriginal({ findIdentityRow: async () => ({ kind: "article", originalUrl: beehiiv }) })(beehiiv)).toBe(beehiiv);
	});
});
