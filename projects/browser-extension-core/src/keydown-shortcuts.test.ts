/// <reference lib="dom" />
import { installShortcuts, isCmdD, type Shortcut } from "./keydown-shortcuts";

function createFakeKeyEvent(
	overrides: Partial<KeyboardEvent>,
): KeyboardEvent & { preventDefault: jest.Mock; stopPropagation: jest.Mock } {
	const event = {
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		key: "",
		preventDefault: jest.fn(),
		stopPropagation: jest.fn(),
		...overrides,
	};
	return event as unknown as KeyboardEvent & {
		preventDefault: jest.Mock;
		stopPropagation: jest.Mock;
	};
}

function createFakeTarget() {
	let registered: ((event: KeyboardEvent) => void) | null = null;
	const target: Pick<Document, "addEventListener"> = {
		addEventListener(
			_type: string,
			handler: EventListenerOrEventListenerObject | null,
		): void {
			registered = (event) => {
				if (typeof handler === "function") handler(event);
			};
		},
	};
	const dispatch = (event: KeyboardEvent) => registered?.(event);
	return { target, dispatch };
}

describe("isCmdD", () => {
	it("matches Cmd+D", () => {
		expect(isCmdD(createFakeKeyEvent({ metaKey: true, key: "d" }))).toBe(true);
	});

	it("matches Ctrl+D", () => {
		expect(isCmdD(createFakeKeyEvent({ ctrlKey: true, key: "d" }))).toBe(true);
	});

	it("does not match plain D", () => {
		expect(isCmdD(createFakeKeyEvent({ key: "d" }))).toBe(false);
	});

	it("does not match Cmd+other-key", () => {
		expect(isCmdD(createFakeKeyEvent({ metaKey: true, key: "e" }))).toBe(false);
	});
});

describe("installShortcuts", () => {
	it("runs action and suppresses default for a matching shortcut", () => {
		const { target, dispatch } = createFakeTarget();
		const action = jest.fn();
		installShortcuts(target, [{ matches: isCmdD, action }]);

		const event = createFakeKeyEvent({ metaKey: true, key: "d" });
		dispatch(event);

		expect(action).toHaveBeenCalledTimes(1);
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
	});

	it("suppresses default without throwing when shortcut has no action", () => {
		const { target, dispatch } = createFakeTarget();
		installShortcuts(target, [{ matches: isCmdD }]);

		const event = createFakeKeyEvent({ metaKey: true, key: "d" });
		dispatch(event);

		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
	});

	it("ignores non-matching events", () => {
		const { target, dispatch } = createFakeTarget();
		const action = jest.fn();
		installShortcuts(target, [{ matches: isCmdD, action }]);

		const event = createFakeKeyEvent({ key: "a" });
		dispatch(event);

		expect(action).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(event.stopPropagation).not.toHaveBeenCalled();
	});

	it("dispatches the first matching shortcut only", () => {
		const { target, dispatch } = createFakeTarget();
		const first = jest.fn();
		const second = jest.fn();
		const shortcuts: Shortcut[] = [
			{ matches: isCmdD, action: first },
			{ matches: isCmdD, action: second },
		];
		installShortcuts(target, shortcuts);

		dispatch(createFakeKeyEvent({ metaKey: true, key: "d" }));

		expect(first).toHaveBeenCalledTimes(1);
		expect(second).not.toHaveBeenCalled();
	});
});
