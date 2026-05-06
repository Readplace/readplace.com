import type Handlebars from "handlebars";

interface SwitchState {
	value: unknown;
	matched: boolean;
}

const switchState = new WeakMap<object, SwitchState>();

export const switchHelpers: Record<string, Handlebars.HelperDelegate> = {
	switch(this: object, value: unknown, options: Handlebars.HelperOptions) {
		switchState.set(this, { value, matched: false });
		const result = options.fn(this);
		switchState.delete(this);
		return result;
	},
	case(this: object, value: unknown, options: Handlebars.HelperOptions) {
		const state = switchState.get(this);
		if (state && value === state.value) {
			state.matched = true;
			return options.fn(this);
		}
		return "";
	},
	default(this: object, options: Handlebars.HelperOptions) {
		const state = switchState.get(this);
		if (!state?.matched) {
			return options.fn(this);
		}
		return "";
	},
};
