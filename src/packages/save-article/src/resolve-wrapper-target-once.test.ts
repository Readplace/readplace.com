import { initResolveWrapperTargetOnce } from "./resolve-wrapper-target-once";

const TRACKER = "https://link.mail.beehiiv.com/ss/c/u001.TOKEN/4vf/TOKEN/h101/h001.TOKEN";
const OTHER_TRACKER = "https://link.mail.beehiiv.com/ss/c/u001.OTHER/4vf/OTHER/h101/h001.OTHER";
const DESTINATION = { url: "https://publisher.example/article", contentSourceUrl: TRACKER };

describe("initResolveWrapperTargetOnce", () => {
	it("answers every caller of the same wrapper from one resolution, including a caller that asks while it is in flight", async () => {
		const requests: string[] = [];
		const resolve = initResolveWrapperTargetOnce(async (url) => {
			requests.push(url);
			return DESTINATION;
		});

		const [identity, verifier] = await Promise.all([resolve(TRACKER), resolve(TRACKER)]);
		const later = await resolve(TRACKER);

		expect({ identity, verifier, later }).toEqual({ identity: DESTINATION, verifier: DESTINATION, later: DESTINATION });
		expect(requests).toEqual([TRACKER]);
	});

	it("resolves each different wrapper on its own", async () => {
		const requests: string[] = [];
		const resolve = initResolveWrapperTargetOnce(async (url) => {
			requests.push(url);
			return { url: `${DESTINATION.url}?from=${url === TRACKER ? "first" : "second"}` };
		});

		expect(await resolve(TRACKER)).toEqual({ url: `${DESTINATION.url}?from=first` });
		expect(await resolve(OTHER_TRACKER)).toEqual({ url: `${DESTINATION.url}?from=second` });
		expect(requests).toEqual([TRACKER, OTHER_TRACKER]);
	});

	it("tries a wrapper again after its resolution rejected", async () => {
		const requests: string[] = [];
		const resolve = initResolveWrapperTargetOnce(async (url) => {
			requests.push(url);
			if (requests.length === 1) throw new Error("unlocker socket reset");
			return DESTINATION;
		});

		await expect(resolve(TRACKER)).rejects.toThrow("unlocker socket reset");
		expect(await resolve(TRACKER)).toEqual(DESTINATION);
		expect(requests).toEqual([TRACKER, TRACKER]);
	});
});
