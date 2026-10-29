import { UserIdSchema } from "@packages/domain/user";
import { BrowserHandoffCodeSchema } from "./browser-handoff.schema";
import { initInMemoryBrowserHandoff } from "./in-memory-browser-handoff";

const USER = UserIdSchema.parse("user-1");
const IDENTITY = { userId: USER, emailVerified: true, oauthClientId: "readplace-ios" };

function createMutableClock(startMs: number) {
	let nowMs = startMs;
	return {
		now: () => new Date(nowMs),
		advanceSeconds: (seconds: number) => {
			nowMs += seconds * 1000;
		},
	};
}

describe("initInMemoryBrowserHandoff", () => {
	it("mints a code and redeems it once for the minting identity", async () => {
		const { mintBrowserHandoffCode, redeemBrowserHandoffCode } = initInMemoryBrowserHandoff({ now: () => new Date() });

		const code = await mintBrowserHandoffCode(IDENTITY);

		expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(await redeemBrowserHandoffCode(code)).toEqual({ ok: true, ...IDENTITY });
	});

	it("refuses a code that was already redeemed", async () => {
		const { mintBrowserHandoffCode, redeemBrowserHandoffCode } = initInMemoryBrowserHandoff({ now: () => new Date() });
		const code = await mintBrowserHandoffCode(IDENTITY);
		await redeemBrowserHandoffCode(code);

		expect(await redeemBrowserHandoffCode(code)).toEqual({ ok: false, reason: "invalid-code" });
	});

	it("refuses an unknown code", async () => {
		const { redeemBrowserHandoffCode } = initInMemoryBrowserHandoff({ now: () => new Date() });

		expect(await redeemBrowserHandoffCode(BrowserHandoffCodeSchema.parse("unknown"))).toEqual({
			ok: false,
			reason: "invalid-code",
		});
	});

	it("refuses a code redeemed more than 60 seconds after it was minted", async () => {
		const clock = createMutableClock(0);
		const { mintBrowserHandoffCode, redeemBrowserHandoffCode } = initInMemoryBrowserHandoff({ now: clock.now });
		const code = await mintBrowserHandoffCode(IDENTITY);

		clock.advanceSeconds(61);

		expect(await redeemBrowserHandoffCode(code)).toEqual({ ok: false, reason: "invalid-code" });
	});
});
