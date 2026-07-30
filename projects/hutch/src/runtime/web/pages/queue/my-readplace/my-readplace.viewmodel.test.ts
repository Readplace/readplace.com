import { toMyReadplaceViewModel } from "./my-readplace.viewmodel";

const PREFERENCE = { text: "Long-form essays on systems design" };

describe("toMyReadplaceViewModel", () => {
	it("should compose from an empty form when the reader has no saved preference", () => {
		const vm = toMyReadplaceViewModel({ preference: undefined, edit: false, invalid: false });

		expect(vm).toEqual({ mode: "compose", text: "", invalid: false });
	});

	it("should stay on the compose form when edit is requested with nothing saved", () => {
		const vm = toMyReadplaceViewModel({ preference: undefined, edit: true, invalid: false });

		expect(vm).toEqual({ mode: "compose", text: "", invalid: false });
	});

	it("should summarise the saved preference by default", () => {
		const vm = toMyReadplaceViewModel({ preference: PREFERENCE, edit: false, invalid: false });

		expect(vm).toEqual({ mode: "summary", text: PREFERENCE.text, invalid: false });
	});

	it("should prefill the form when the reader asks to edit a saved preference", () => {
		const vm = toMyReadplaceViewModel({ preference: PREFERENCE, edit: true, invalid: false });

		expect(vm).toEqual({ mode: "edit", text: PREFERENCE.text, invalid: false });
	});

	it("should carry the invalid flag back onto the form after a rejected save", () => {
		const vm = toMyReadplaceViewModel({ preference: PREFERENCE, edit: true, invalid: true });

		expect(vm).toEqual({ mode: "edit", text: PREFERENCE.text, invalid: true });
	});
});
