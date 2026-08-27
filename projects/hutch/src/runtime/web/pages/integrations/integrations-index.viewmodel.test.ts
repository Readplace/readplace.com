import { toIntegrationsIndexViewModel } from "./integrations-index.viewmodel";

const DISCONNECTED = { gmailConnected: false };

describe("toIntegrationsIndexViewModel", () => {
	it("lists the services in a fixed order", () => {
		const vm = toIntegrationsIndexViewModel(DISCONNECTED);

		expect(vm.services.map((s) => s.key)).toEqual(["gmail", "outlook"]);
	});

	it("offers the connect button while Gmail is not set up", () => {
		const gmail = toIntegrationsIndexViewModel(DISCONNECTED).services.find((s) => s.key === "gmail");

		expect(gmail?.statusKey).toBe("not-set-up");
		expect(gmail?.statusLabel).toBe("Not set up");
		expect(gmail?.connectVisibility).toBe("visible");
		expect(gmail?.connectAction).toBe("/integrations/gmail/connect");
	});

	it("hides the connect button once Gmail is connected", () => {
		const gmail = toIntegrationsIndexViewModel({ gmailConnected: true }).services.find(
			(s) => s.key === "gmail",
		);

		expect(gmail?.statusKey).toBe("connected");
		expect(gmail?.statusLabel).toBe("Connected");
		expect(gmail?.statusModifier).toBe("integrations__status--connected");
		expect(gmail?.connectVisibility).toBe("hidden");
	});

	it("never offers a connect button for a service with no implementation", () => {
		const outlook = toIntegrationsIndexViewModel(DISCONNECTED).services.find(
			(s) => s.key === "outlook",
		);

		expect(outlook?.statusKey).toBe("coming-soon");
		expect(outlook?.statusLabel).toBe("Coming soon");
		expect(outlook?.connectVisibility).toBe("hidden");
	});

	it("renders no alert or notice on a plain visit", () => {
		const vm = toIntegrationsIndexViewModel(DISCONNECTED);

		expect(vm.alerts).toEqual([]);
		expect(vm.notices).toEqual([]);
		expect(vm.hasAlert).toBe(false);
		expect(vm.hasNotice).toBe(false);
		expect(vm.alertVisibility).toBe("hidden");
		expect(vm.noticeVisibility).toBe("hidden");
	});

	it("confirms a completed connection", () => {
		const vm = toIntegrationsIndexViewModel({ gmailConnected: true, justConnected: true });

		expect(vm.notices.map((n) => n.key)).toEqual(["connected"]);
		expect(vm.hasNotice).toBe(true);
		expect(vm.noticeVisibility).toBe("visible");
	});

	it("explains each connect failure the callback can redirect with", () => {
		for (const error of [
			"connect_failed",
			"oauth_denied",
			"oauth_state",
			"oauth_scope",
			"oauth_exchange",
		]) {
			const vm = toIntegrationsIndexViewModel({ gmailConnected: false, error });
			expect(vm.alerts.map((a) => a.key)).toEqual([error]);
			expect(vm.hasAlert).toBe(true);
			expect(vm.alertVisibility).toBe("visible");
		}
	});

	it("ignores an error code it does not recognise rather than rendering an empty alert", () => {
		const vm = toIntegrationsIndexViewModel({ gmailConnected: false, error: "made-up" });

		expect(vm.alerts).toEqual([]);
		expect(vm.hasAlert).toBe(false);
	});
});
