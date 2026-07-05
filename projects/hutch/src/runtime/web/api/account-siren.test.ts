import { toAccountEntity } from "./account-siren";

describe("toAccountEntity", () => {
	it("advertises a self link and a bare destructive delete-account action", () => {
		expect(toAccountEntity()).toEqual({
			class: ["account"],
			links: [{ rel: ["self"], href: "/account" }],
			actions: [
				{
					name: "delete-account",
					title: "Delete account",
					href: "/account/delete",
					method: "POST",
					class: ["destructive"],
				},
			],
		});
	});
});
