import { formatUnreadLabel } from "./queue.component";

describe("formatUnreadLabel", () => {
	it("should format zero count", () => {
		expect(formatUnreadLabel(0)).toBe("To read (0)");
	});

	it("should format normal count", () => {
		expect(formatUnreadLabel(5)).toBe("To read (5)");
	});

	it("should format count at boundary", () => {
		expect(formatUnreadLabel(99)).toBe("To read (99)");
	});

	it("should cap at 99+ when count exceeds 99", () => {
		expect(formatUnreadLabel(100)).toBe("To read (99+)");
	});

	it("should render an ellipsis placeholder while the count is loading", () => {
		// undefined indicates that the deferred /queue/counts fragment hasn't yet
		// hydrated the badge — the template still needs a string to render in
		// the synchronous response, so the placeholder shows "…" inside the
		// label until htmx swaps in the real number.
		expect(formatUnreadLabel(undefined)).toBe("To read (…)");
	});
});
