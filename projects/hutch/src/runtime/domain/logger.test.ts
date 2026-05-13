import { logger } from "./logger";

describe("logger", () => {
	describe("info", () => {
		it("logs a JSON line with level INFO, timestamp, and message", () => {
			const spy = jest.spyOn(console, "log").mockImplementation(() => {});
			logger().info("hello");
			expect(spy).toHaveBeenCalledTimes(1);
			const parsed = JSON.parse(spy.mock.calls[0][0] as string);
			expect(parsed.level).toBe("INFO");
			expect(parsed.message).toBe("hello");
			expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			spy.mockRestore();
		});
	});

	describe("error", () => {
		it("logs a JSON line with level ERROR and the error stack", () => {
			const spy = jest.spyOn(console, "error").mockImplementation(() => {});
			logger().error("something broke", new Error("boom"));
			expect(spy).toHaveBeenCalledTimes(1);
			const parsed = JSON.parse(spy.mock.calls[0][0] as string);
			expect(parsed.level).toBe("ERROR");
			expect(parsed.message).toBe("something broke");
			expect(parsed.stack).toContain("Error: boom");
			spy.mockRestore();
		});

		it("logs without a stack when no error is passed", () => {
			const spy = jest.spyOn(console, "error").mockImplementation(() => {});
			logger().error("just a message");
			const parsed = JSON.parse(spy.mock.calls[0][0] as string);
			expect(parsed.stack).toBeUndefined();
			spy.mockRestore();
		});
	});
});
