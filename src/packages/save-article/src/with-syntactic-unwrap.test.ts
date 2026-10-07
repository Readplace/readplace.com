import { withSyntacticUnwrap } from "./with-syntactic-unwrap";

describe("withSyntacticUnwrap", () => {
	const ARTICLE = "https://mamund.substack.com/p/the-hypermedia-commons-we-missed";

	function createResolver() {
		const calls: string[] = [];
		const resolve = withSyntacticUnwrap(async (url) => {
			calls.push(url);
			return { url: "https://publisher.example/from-the-network" };
		});
		return { resolve, calls };
	}

	it("answers a wrapper whose path names its article without touching the network", async () => {
		const { resolve, calls } = createResolver();

		expect(await resolve(`https://web.archive.org/web/20260000000000*/${ARTICLE}`)).toEqual({ url: ARTICLE, contentSourceUrl: `https://web.archive.org/web/${ARTICLE}` });
		expect(calls).toEqual([]);
	});

	it("delegates a wrapper whose target is only knowable over the network", async () => {
		const { resolve, calls } = createResolver();

		expect(await resolve("https://archive.ph/Ab1cD")).toEqual({ url: "https://publisher.example/from-the-network" });
		expect(calls).toEqual(["https://archive.ph/Ab1cD"]);
	});
});
