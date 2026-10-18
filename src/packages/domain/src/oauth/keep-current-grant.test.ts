import assert from "node:assert/strict";
import type { RefreshAccount } from "./current-grant";
import { type AdvanceEpochKeeping, initKeepCurrentGrant } from "./keep-current-grant";
import { OAuthGrantIdSchema } from "./oauth.schema";
import type { RefreshGrant } from "./refresh";

const reader = "reader";
const grantId = OAuthGrantIdSchema.parse("grant-1");

function grant(overrides: Partial<RefreshGrant> = {}): RefreshGrant {
	return {
		id: grantId,
		userId: reader,
		clientId: "ios-app",
		epoch: 0,
		generation: 1,
		accessToken: "a",
		refreshFingerprint: "f",
		keyThumbprint: "key",
		state: "active",
		expiresAt: 4102444800000,
		...overrides,
	};
}

function setup(input: { account: RefreshAccount; grant: RefreshGrant | undefined; answers: ("committed" | "conflict")[] }) {
	const advances: Parameters<AdvanceEpochKeeping>[0][] = [];
	const keep = initKeepCurrentGrant({
		store: { readAccount: async () => input.account, readGrant: async () => input.grant },
		advanceEpochKeeping: async request => {
			advances.push(request);
			const answer = input.answers.shift();
			assert(answer, "the keep must not advance more often than the test scripted");
			return answer;
		},
	});
	return { keep, advances };
}

describe("initKeepCurrentGrant", () => {
	it.each([
		["there is no grant row", { epoch: 0, exemption: undefined }, undefined],
		["the grant belongs to another reader", { epoch: 0, exemption: undefined }, grant({ userId: "someone-else" })],
		["the grant is revoked", { epoch: 0, exemption: undefined }, grant({ state: "revoked" })],
		["the grant was never bound to a device key", { epoch: 0, exemption: undefined }, grant({ keyThumbprint: undefined })],
		["an earlier advance fenced the grant", { epoch: 1, exemption: undefined }, grant({ epoch: 0 })],
	] as const)("keeps nothing and writes nothing when %s", async (_case, account, row) => {
		const { keep, advances } = setup({ account, grant: row, answers: [] });

		expect(await keep({ userId: reader, grantId })).toBe(false);
		expect(advances).toEqual([]);
	});

	it("exempts a current grant at the next epoch, pinning the row it read", async () => {
		const row = grant({ epoch: 2, generation: 3 });
		const { keep, advances } = setup({ account: { epoch: 2, exemption: undefined }, grant: row, answers: ["committed"] });

		expect(await keep({ userId: reader, grantId })).toBe(true);
		expect(advances).toEqual([{ userId: reader, exemption: { atEpoch: 3, grantId, grantEpoch: 2 }, expectedGrant: row }]);
	});

	it("keeps a grant that is current only through a live exemption", async () => {
		const row = grant({ epoch: 0 });
		const { keep, advances } = setup({
			account: { epoch: 1, exemption: { atEpoch: 1, grantId, grantEpoch: 0 } },
			grant: row,
			answers: ["committed"],
		});

		expect(await keep({ userId: reader, grantId })).toBe(true);
		expect(advances).toEqual([{ userId: reader, exemption: { atEpoch: 2, grantId, grantEpoch: 0 }, expectedGrant: row }]);
	});

	it("reads again after a conflict and keeps the row the second read finds", async () => {
		const state: { account: RefreshAccount; grant: RefreshGrant } = {
			account: { epoch: 0, exemption: undefined },
			grant: grant({ generation: 1 }),
		};
		const advances: Parameters<AdvanceEpochKeeping>[0][] = [];
		const keep = initKeepCurrentGrant({
			store: { readAccount: async () => state.account, readGrant: async () => state.grant },
			advanceEpochKeeping: async request => {
				advances.push(request);
				if (advances.length > 1) return "committed";
				state.grant = grant({ generation: 2, accessToken: "b" });
				return "conflict";
			},
		});

		expect(await keep({ userId: reader, grantId })).toBe(true);
		expect(advances.map(advance => [advance.expectedGrant.generation, advance.exemption])).toEqual([
			[1, { atEpoch: 1, grantId, grantEpoch: 0 }],
			[2, { atEpoch: 1, grantId, grantEpoch: 0 }],
		]);
	});

	it("keeps nothing after four conflicts", async () => {
		const { keep, advances } = setup({
			account: { epoch: 0, exemption: undefined },
			grant: grant(),
			answers: ["conflict", "conflict", "conflict", "conflict"],
		});

		expect(await keep({ userId: reader, grantId })).toBe(false);
		expect(advances).toHaveLength(4);
	});
});
