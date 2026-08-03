import type Handlebars from "handlebars";

const switchState = new WeakMap<object, { value: unknown }>();

export const switchHelpers: Record<string, Handlebars.HelperDelegate> = {
	switch(this: object, value: unknown, options: Handlebars.HelperOptions) {
		switchState.set(this, { value });
		const result = options.fn(this);
		switchState.delete(this);
		return result;
	},
	case(this: object, value: unknown, options: Handlebars.HelperOptions) {
		const state = switchState.get(this);
		if (state && value === state.value) {
			return options.fn(this);
		}
		return "";
	},
};
