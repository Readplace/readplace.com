import { toIntegrationsIndexViewModel } from "./integrations-index.viewmodel";

describe("toIntegrationsIndexViewModel", () => {
	it("lists the services in a fixed order", () => {
		const vm = toIntegrationsIndexViewModel();

		expect(vm.services.map((s) => s.key)).toEqual(["gmail", "outlook"]);
	});

	it("marks Gmail as not set up, since no connection can exist yet", () => {
		const gmail = toIntegrationsIndexViewModel().services.find((s) => s.key === "gmail");

		expect(gmail?.statusKey).toBe("not-set-up");
		expect(gmail?.statusLabel).toBe("Not set up");
		expect(gmail?.statusModifier).toBe("integrations__status--not-set-up");
	});

	it("marks a service with no implementation as coming soon", () => {
		const outlook = toIntegrationsIndexViewModel().services.find((s) => s.key === "outlook");

		expect(outlook?.statusKey).toBe("coming-soon");
		expect(outlook?.statusLabel).toBe("Coming soon");
		expect(outlook?.statusModifier).toBe("integrations__status--coming-soon");
	});
});
