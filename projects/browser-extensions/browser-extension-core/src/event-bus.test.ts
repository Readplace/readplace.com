import { createEventBus } from "./event-bus";

describe("createEventBus", () => {
	it("should call handler when event is emitted", () => {
		const bus = createEventBus();
		const calls: unknown[][] = [];
		bus.on("test", (...args) => calls.push(args));

		bus.emit("test", "hello");

		expect(calls).toEqual([["hello"]]);
	});

	it("should support multiple handlers for the same event", () => {
		const bus = createEventBus();
		const calls: string[] = [];
		bus.on("test", () => calls.push("first"));
		bus.on("test", () => calls.push("second"));

		bus.emit("test");

		expect(calls).toEqual(["first", "second"]);
	});

	it("should not call handlers for other events", () => {
		const bus = createEventBus();
		const calls: string[] = [];
		bus.on("a", () => calls.push("a"));
		bus.on("b", () => calls.push("b"));

		bus.emit("a");

		expect(calls).toEqual(["a"]);
	});

	it("should pass multiple arguments to handler", () => {
		const bus = createEventBus();
		const calls: unknown[][] = [];
		bus.on("test", (...args) => calls.push(args));

		bus.emit("test", 1, "two", true);

		expect(calls).toEqual([[1, "two", true]]);
	});

	it("should not throw when emitting event with no handlers", () => {
		const bus = createEventBus();

		expect(() => bus.emit("no-handlers")).not.toThrow();
	});

	it("should call once handler only on first emit", () => {
		const bus = createEventBus();
		const calls: string[] = [];
		bus.once("test", () => calls.push("once"));

		bus.emit("test");
		bus.emit("test");

		expect(calls).toEqual(["once"]);
	});

	it("should not affect other handlers when once handler is removed", () => {
		const bus = createEventBus();
		const calls: string[] = [];
		bus.on("test", () => calls.push("persistent"));
		bus.once("test", () => calls.push("once"));

		bus.emit("test");
		bus.emit("test");

		expect(calls).toEqual(["persistent", "once", "persistent"]);
	});


});
