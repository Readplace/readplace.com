import assert from "node:assert/strict";
import {
	BASE_CSS_VARIABLES,
	BUTTON_STYLES,
	CHIP_STYLES,
	DARK_ONLY_BODY_CLASS,
	EMAIL_FRAME_CANVAS,
	FORM_CONTROL_STYLES,
	LIGHT_ONLY_BODY_CLASS,
	SCRIM_BLUR,
	SCRIM_DARK,
	SCRIM_LIGHT,
	SYSTEM_THEME_VARIABLES,
} from "./base.styles";

function lightRootDeclarations(): string {
	const lightRoot = /:root \{\s*color-scheme: light;([^}]*)\}/.exec(BASE_CSS_VARIABLES);
	assert(lightRoot, "BASE_CSS_VARIABLES must declare the light theme on :root");
	return lightRoot[1];
}

function darkRootDeclarations(): string {
	const darkRoot = /:root \{\s*color-scheme: dark;([^}]*)\}/.exec(BASE_CSS_VARIABLES);
	assert(darkRoot, "BASE_CSS_VARIABLES must declare the dark theme on :root");
	return darkRoot[1];
}

function pinnedThemeDeclarations(bodyClass: string): string {
	const block = new RegExp(`body\\.${bodyClass} \\{([^}]*)\\}`).exec(BASE_CSS_VARIABLES);
	assert(block, `BASE_CSS_VARIABLES must pin a theme under body.${bodyClass}`);
	return block[1];
}

function rootDeclarationsUnder(mediaQuery: string): string {
	const escaped = mediaQuery.replace(/[()]/g, "\\$&");
	const block = new RegExp(`@media ${escaped} \\{\\s*:root \\{([^}]*)\\}`).exec(BASE_CSS_VARIABLES);
	assert(block, `BASE_CSS_VARIABLES must declare :root under @media ${mediaQuery}`);
	return block[1];
}

function formControlRules(): { selectors: string[]; body: string }[] {
	return Array.from(FORM_CONTROL_STYLES.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => ({
		selectors: match[1].split(",").map((selector) => selector.trim()),
		body: match[2],
	}));
}

function formControlRuleIndex(selector: string): number {
	const index = formControlRules().findIndex((rule) => rule.selectors.includes(selector));
	assert(index >= 0, `FORM_CONTROL_STYLES must style ${selector}`);
	return index;
}

function formControlRule(selector: string): string {
	return formControlRules()[formControlRuleIndex(selector)].body;
}

function ruleBody({ css, selector }: { css: string; selector: string }): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const rule = new RegExp(`\\n\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
	assert(rule, `${selector} must be declared`);
	return rule[1];
}

function declaredValue({ body, property }: { body: string; property: string }): string {
	const declaration = new RegExp(`(?:^|\\s)${property}:\\s*([^;]+);`).exec(body);
	assert(declaration, `${property} must be declared`);
	return declaration[1];
}

describe("EMAIL_FRAME_CANVAS", () => {
	it("carries the light theme's canvas, text colour and sans stack as literal values an email frame's srcdoc can use", () => {
		const declarations = lightRootDeclarations();
		expect(declarations).toContain(`--color-background: ${EMAIL_FRAME_CANVAS.background};`);
		expect(declarations).toContain(`--color-text-primary: ${EMAIL_FRAME_CANVAS.text};`);
		expect(declarations).toContain(`--font-sans: ${EMAIL_FRAME_CANVAS.fontFamily};`);
	});

	it("holds no var() reference, since a srcdoc document cannot read the page's custom properties", () => {
		for (const value of Object.values(EMAIL_FRAME_CANVAS)) {
			expect(value).not.toContain("var(");
		}
	});
});

describe("scrim constants", () => {
	it("hold literal values, since ::backdrop cannot read the page's custom properties", () => {
		for (const value of [SCRIM_LIGHT, SCRIM_DARK, SCRIM_BLUR]) {
			expect(value).not.toContain("var(");
		}
	});
});

describe("BASE_CSS_VARIABLES", () => {
	it("keeps the warning alert icon legible on the light tint and follows the warning mark in dark mode", () => {
		expect(lightRootDeclarations()).toContain("--warning-text: hsl(37 56% 40%);");
		expect(darkRootDeclarations()).toContain("--warning-text: var(--color-warning);");
	});

	it("tints the reader header's provenance glyph in the secondary ink the site glyph shares", () => {
		expect(lightRootDeclarations()).toContain("--fact-provenance: var(--color-secondary-text);");
	});

	it("tints the reader header's publish-date glyph in the secondary ink the site glyph shares", () => {
		expect(lightRootDeclarations()).toContain("--fact-published: var(--color-secondary-text);");
	});

	it("lifts the public reader's action bar on an upward shadow that deepens in dark, pinned or not", () => {
		expect(lightRootDeclarations()).toContain("--shadow-bar: 0 -2px 12px rgba(0,0,0,0.2);");
		expect(darkRootDeclarations()).toContain("--shadow-bar: 0 -2px 12px rgba(0,0,0,0.5);");
		expect(pinnedThemeDeclarations(DARK_ONLY_BODY_CLASS)).toContain("--shadow-bar: 0 -2px 12px rgba(0,0,0,0.5);");
	});

	it("opens with the system theme tokens every surface shares", () => {
		expect(BASE_CSS_VARIABLES.startsWith(SYSTEM_THEME_VARIABLES)).toBe(true);
	});

	it("keeps field and form sizing out of the pinned-theme blocks, so a reader who pins Light or Dark still gets the wide-screen values", () => {
		for (const bodyClass of [LIGHT_ONLY_BODY_CLASS, DARK_ONLY_BODY_CLASS]) {
			const declarations = pinnedThemeDeclarations(bodyClass);
			expect(declarations).not.toContain("--form-gap");
			expect(declarations).not.toContain("--input-font-size");
		}
	});

	it("sizes field text at 16px so iOS does not zoom on focus, and at 14px only on a wide screen with a fine pointer", () => {
		expect(lightRootDeclarations()).toContain("--input-font-size: 16px;");
		expect(rootDeclarationsUnder("(min-width: 768px) and (pointer: fine)")).toContain(
			"--input-font-size: 14px;",
		);
		expect(rootDeclarationsUnder("(min-width: 768px)")).not.toContain("--input-font-size");
	});

	it("spaces form rows at 20px, widening to 24px from 768px", () => {
		expect(lightRootDeclarations()).toContain("--form-gap: 20px;");
		expect(rootDeclarationsUnder("(min-width: 768px)")).toContain("--form-gap: 24px;");
	});

	it("insets field text 12px on every side", () => {
		expect(lightRootDeclarations()).toContain("--input-padding: 12px;");
	});

	it("declares the placeholder ink in every theme block, so a pinned theme resolves it against its own secondary ink", () => {
		expect(lightRootDeclarations()).toContain("--input-placeholder: var(--muted-foreground);");
		expect(pinnedThemeDeclarations(LIGHT_ONLY_BODY_CLASS)).toContain(
			"--input-placeholder: var(--muted-foreground);",
		);
		expect(pinnedThemeDeclarations(DARK_ONLY_BODY_CLASS)).toContain(
			"--input-placeholder: var(--muted-foreground);",
		);
	});

	it("leaves the dark system theme to inherit the placeholder token rather than redeclaring it", () => {
		expect(darkRootDeclarations()).not.toContain("--input-placeholder");
	});

	it("steps the layout tokens on :root only, so a theme-pinned page still widens them at each breakpoint", () => {
		for (const token of ["--page-gutter", "--page-top", "--stack-gap", "--column-gap", "--header-inset"]) {
			expect(BASE_CSS_VARIABLES).toContain(`${token}:`);
			expect(pinnedThemeDeclarations(LIGHT_ONLY_BODY_CLASS)).not.toContain(`${token}:`);
			expect(pinnedThemeDeclarations(DARK_ONLY_BODY_CLASS)).not.toContain(`${token}:`);
		}
	});
});

describe("FORM_CONTROL_STYLES", () => {
	it("draws the placeholder in the placeholder ink at full opacity, overriding Firefox's dimmed default", () => {
		for (const selector of [".form-input::placeholder", ".form-input__control::placeholder"]) {
			const rule = formControlRule(selector);
			expect(rule).toContain("color: var(--input-placeholder);");
			expect(rule).toContain("opacity: 1;");
		}
	});

	it("rounds a field to the 8px control corner and fills it with the page ground", () => {
		const rule = formControlRule(".form-input");
		expect(rule).toContain("border-radius: var(--radius);");
		expect(rule).toContain("border: 1px solid var(--input);");
		expect(rule).toContain("background: var(--background);");
		expect(rule).toContain("font-size: var(--input-font-size);");
	});

	it("shows focus as a solid 2px amber edge, with no translucent halo", () => {
		const rule = formControlRule(".form-input:focus");
		expect(rule).toContain("outline: none;");
		expect(rule).toContain("border-color: var(--ring);");
		expect(rule).toContain("box-shadow: 0 0 0 1px var(--ring);");
		expect(FORM_CONTROL_STYLES).not.toContain("--ring-shadow");
	});

	it("marks an invalid field through aria-invalid, ordered before focus so the amber edge wins while focused", () => {
		const invalid = formControlRuleIndex('.form-input[aria-invalid="true"]');
		expect(formControlRule('.form-input[aria-invalid="true"]')).toContain(
			"border-color: var(--color-error);",
		);
		expect(invalid).toBeLessThan(formControlRuleIndex(".form-input:focus"));
	});

	it("fills a disabled field with the muted surface and secondary ink at full opacity, cancelling WebKit's built-in fade", () => {
		const rule = formControlRule(".form-input:disabled");
		expect(rule).toContain("background: var(--muted);");
		expect(rule).toContain("color: var(--muted-foreground);");
		expect(rule).toContain("cursor: not-allowed;");
		expect(rule).toContain("opacity: 1;");
	});

	it("greys a disabled field's label to match the field", () => {
		expect(formControlRule(".form-field:has(.form-input:disabled) .form-field__label")).toContain(
			"color: var(--muted-foreground);",
		);
	});

	it("labels a field at 14/500 and sets its message at 12/500 in the accessible error ink", () => {
		const label = formControlRule(".form-field__label");
		expect(label).toContain("font-size: 0.875rem;");
		expect(label).toContain("font-weight: 500;");
		const error = formControlRule(".form-field__error");
		expect(error).toContain("font-size: 0.75rem;");
		expect(error).toContain("font-weight: 500;");
		expect(error).toContain("color: var(--error-text);");
	});

	it("sets a neutral field message at 12/500 in secondary ink", () => {
		const message = formControlRule(".form-field__message");
		expect(message).toContain("margin: 0;");
		expect(message).toContain("font-size: 0.75rem;");
		expect(message).toContain("font-weight: 500;");
		expect(message).toContain("line-height: 1.35;");
		expect(message).toContain("color: var(--muted-foreground);");
		expect(message).toContain("text-wrap: pretty;");
	});

	it("collapses an empty error line, so a field with no message reserves no space", () => {
		expect(formControlRule(".form-field__error:empty")).toContain("display: none;");
	});

	it("grows a multi-line field to two and a half rows at the brand's 1.5 line height, resizable only vertically", () => {
		const rule = formControlRule(".form-input--multiline");
		expect(rule).toContain("height: auto;");
		expect(rule).toContain("min-height: calc(var(--input-height) * 2.5);");
		expect(rule).toContain("line-height: 1.5;");
		expect(rule).toContain("resize: vertical;");
	});

	it("draws the box around a wrapped control and rings it only while the wrapped control has focus, not a neighbour like its Copy button", () => {
		expect(formControlRule(".form-input--within")).toContain("padding: 0;");
		expect(formControlRule(".form-input--within:has(.form-input__control:focus-within)")).toBe(
			formControlRule(".form-input:focus"),
		);
		const control = formControlRule(".form-input__control");
		expect(control).toContain("border: none;");
		expect(control).toContain("background: transparent;");
		expect(control).toContain("padding: var(--input-padding);");
	});

	it("draws a select's own chevron, clear of its value, and leaves the click to the select", () => {
		expect(formControlRule(".form-input--select")).toContain("position: relative;");
		const select = formControlRule(".form-input--select .form-input__control");
		expect(select).toContain("appearance: none;");
		expect(select).toContain("padding-inline-end: 48px;");
		const chevron = formControlRule(".form-input__chevron");
		expect(chevron).toContain("pointer-events: none;");
		expect(chevron).toContain("color: var(--foreground);");
	});

	it("lets a marketing field show its paired button's outline instead of the field edge", () => {
		const focus = formControlRule(".form-input--cta-ring:focus");
		expect(focus).toContain("border-color: var(--input);");
		expect(focus).toContain("box-shadow: none;");
		expect(formControlRule(".form-input--cta-ring:focus-visible")).toContain(
			"outline: 2px solid var(--ring);",
		);
		expect(formControlRuleIndex(".form-input--cta-ring:focus")).toBeGreaterThan(
			formControlRuleIndex(".form-input:focus"),
		);
	});

	it("keeps a marketing field's red edge while it is focused, since its focus shows as the outline", () => {
		expect(formControlRule('.form-input--cta-ring[aria-invalid="true"]:focus')).toContain(
			"border-color: var(--color-error);",
		);
		expect(formControlRuleIndex('.form-input--cta-ring[aria-invalid="true"]:focus')).toBeGreaterThan(
			formControlRuleIndex(".form-input--cta-ring:focus"),
		);
	});

	it("draws checkbox and radio as an 18px neutral-ink box, rounding the radio into a ring", () => {
		const box = formControlRule(".form-choice");
		expect(box).toContain("appearance: none;");
		expect(box).toContain("width: 18px;");
		expect(box).toContain("height: 18px;");
		expect(box).toContain("border: 1.5px solid var(--foreground);");
		expect(formControlRule('.form-choice[type="radio"]')).toContain("border-radius: 50%;");
	});

	it("fills a checked or indeterminate checkbox with the ink and marks it in the page ground", () => {
		for (const selector of ['.form-choice[type="checkbox"]:checked', '.form-choice[type="checkbox"]:indeterminate']) {
			expect(formControlRule(selector)).toContain("background: var(--foreground);");
		}
		expect(formControlRule('.form-choice[type="checkbox"]:checked::before')).toContain(
			"border: solid var(--background);",
		);
		expect(formControlRule('.form-choice[type="checkbox"]:indeterminate::before')).toContain(
			"border-bottom: 1.5px solid var(--background);",
		);
		expect(formControlRuleIndex('.form-choice[type="checkbox"]:indeterminate::before')).toBeGreaterThan(
			formControlRuleIndex('.form-choice[type="checkbox"]:checked::before'),
		);
	});

	it("marks a checked radio with an 8px ink dot", () => {
		expect(formControlRule('.form-choice[type="radio"]:checked')).toContain(
			"background: radial-gradient(circle, var(--foreground) 0 4px, transparent 4.5px);",
		);
	});

	it("rings a choice mark inside a button and dots it from the button's aria-pressed", () => {
		expect(formControlRule(".form-choice--mark")).toContain("border-radius: 50%;");
		expect(formControlRuleIndex(".form-choice--mark")).toBeGreaterThan(formControlRuleIndex(".form-choice"));
		expect(formControlRule('[aria-pressed="true"] > .form-choice--mark')).toContain(
			"background: radial-gradient(circle, var(--foreground) 0 4px, transparent 4.5px);",
		);
	});

	it("insets a field's text past a leading glyph", () => {
		expect(formControlRule(".form-input--leading-icon")).toContain("padding-inline-start: 40px;");
	});

	it("draws the 2px ring outline on a focused checkbox or radio", () => {
		const rule = formControlRule(".form-choice:focus-visible");
		expect(rule).toContain("outline: 2px solid var(--ring);");
		expect(rule).toContain("outline-offset: 2px;");
	});
});

describe("BUTTON_STYLES", () => {
	it("keeps a destructive action outlined until hover or press", () => {
		const rest = ruleBody({ css: BUTTON_STYLES, selector: ".btn--destructive" });
		const hover = ruleBody({ css: BUTTON_STYLES, selector: ".btn--destructive:hover" });
		const pressed = ruleBody({ css: BUTTON_STYLES, selector: ".btn--destructive:active" });
		expect(declaredValue({ body: rest, property: "background" })).toBe("var(--card)");
		expect(declaredValue({ body: rest, property: "color" })).toBe("var(--error-text)");
		expect(declaredValue({ body: rest, property: "box-shadow" })).toBe("inset 0 0 0 1px var(--color-error)");
		expect(declaredValue({ body: hover, property: "background" })).toBe("var(--error-fill)");
		expect(declaredValue({ body: hover, property: "color" })).toBe("var(--error-foreground)");
		expect(declaredValue({ body: pressed, property: "background" })).toBe("var(--error-fill-hover)");
		expect(declaredValue({ body: pressed, property: "color" })).toBe("var(--error-foreground)");
	});

	it("sizes the XL tier at 56px with 24px inline padding and the 12px corner", () => {
		const rule = ruleBody({ css: BUTTON_STYLES, selector: ".btn--xl" });
		expect([
			declaredValue({ body: rule, property: "min-height" }),
			declaredValue({ body: rule, property: "padding" }),
			declaredValue({ body: rule, property: "border-radius" }),
		]).toEqual(["56px", "16px 24px", "var(--radius-md)"]);
	});

	it.each([".btn--m", ".btn--s"])("extends the %s tier's hit area to the 44px tap-target floor", (tier) => {
		const height = Number.parseFloat(declaredValue({ body: ruleBody({ css: BUTTON_STYLES, selector: tier }), property: "min-height" }));
		const [blockInset] = declaredValue({ body: ruleBody({ css: BUTTON_STYLES, selector: `${tier}::before` }), property: "inset" }).split(" ");
		expect(height - 2 * Number.parseFloat(blockInset)).toBeGreaterThanOrEqual(44);
	});

	it("squares the icon-only tier to the 48px target with no padding, so the glyph sits centred", () => {
		const rule = ruleBody({ css: BUTTON_STYLES, selector: ".btn--icon" });
		expect(declaredValue({ body: rule, property: "padding" })).toBe("0");
		expect(declaredValue({ body: rule, property: "min-width" })).toBe("48px");
		expect(declaredValue({ body: rule, property: "aspect-ratio" })).toBe("1");
	});

	it.each(["primary", "secondary", "neutral"])("gives the %s variant distinct rest, hover and pressed fills", (variant) => {
		const fills = [`.btn--${variant}`, `.btn--${variant}:hover`, `.btn--${variant}:active`].map((selector) =>
			declaredValue({ body: ruleBody({ css: BUTTON_STYLES, selector }), property: "background" }),
		);
		expect(new Set(fills).size).toBe(3);
	});
});

describe("CHIP_STYLES", () => {
	const SELECTORS = [
		".chip",
		".chip--badge",
		".chip--large",
		".chip--status",
		".chip--tab",
		".chip--accent",
		".chip--badge.chip--accent",
		".chip--success",
		".chip--status.chip--success",
		".chip--error",
		".chip__remove-form",
		".chip__remove",
		".chip__remove::before",
		".chip__remove:hover",
		".chip__remove:focus-visible",
		".chip__remove svg",
	];

	it("styles the whole chip family: sizes, tones and the removable tag's control", () => {
		for (const selector of SELECTORS) {
			ruleBody({ css: CHIP_STYLES, selector });
		}
	});

	it("reads tokens only, so dark mode and the pill radius follow the theme", () => {
		expect(CHIP_STYLES).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
		expect(CHIP_STYLES).not.toContain("999px");
		expect(declaredValue({ body: ruleBody({ css: CHIP_STYLES, selector: ".chip" }), property: "border-radius" })).toBe("var(--radius-pill)");
	});

	it("declares its own line box, so a chip keeps its height whatever line-height its container sets", () => {
		expect(declaredValue({ body: ruleBody({ css: CHIP_STYLES, selector: ".chip" }), property: "line-height" })).toBe("1.25");
	});

	it.each([
		[".chip", "2px 8px", "26px"],
		[".chip--badge", "1px 6px", "22px"],
		[".chip--large", "4px 12px", "34px"],
		[".chip--status", "4px 12px", "34px"],
		[".chip--tab", "0 12px", "25px"],
	])("sizes %s with %s padding to a %s minimum height", (selector, padding, minHeight) => {
		const rule = ruleBody({ css: CHIP_STYLES, selector });
		expect(declaredValue({ body: rule, property: "padding" })).toBe(padding);
		expect(declaredValue({ body: rule, property: "min-height" })).toBe(minHeight);
	});

	it("sets an accent badge's amber label in the ink that clears contrast on the tint", () => {
		expect(declaredValue({ body: ruleBody({ css: CHIP_STYLES, selector: ".chip--badge.chip--accent" }), property: "color" })).toBe(
			"var(--primary-text-on-tint)",
		);
	});

	it("sets a success status chip's label in --foreground, which clears 4.5:1 on its tint where --success-text does not", () => {
		expect(declaredValue({ body: ruleBody({ css: CHIP_STYLES, selector: ".chip--status.chip--success" }), property: "color" })).toBe(
			"var(--foreground)",
		);
	});

	it("fills a tab badge with the amber that carries its white label at AA, squared where it meets its box", () => {
		const rule = ruleBody({ css: CHIP_STYLES, selector: ".chip--tab" });
		expect(declaredValue({ body: rule, property: "background" })).toBe("var(--primary)");
		expect(declaredValue({ body: rule, property: "border-color" })).toBe("var(--primary)");
		expect(declaredValue({ body: rule, property: "color" })).toBe("var(--primary-foreground)");
		expect(declaredValue({ body: rule, property: "border-radius" })).toBe("var(--radius) var(--radius) 0 0");
	});

	it("draws a filter chip as an outlined 50px pill whose ticked state darkens the outline to the text ink", () => {
		const rule = ruleBody({ css: CHIP_STYLES, selector: ".chip--filter" });
		expect(declaredValue({ body: rule, property: "min-height" })).toBe("50px");
		expect(declaredValue({ body: rule, property: "padding" })).toBe("0 16px");
		expect(declaredValue({ body: rule, property: "border" })).toBe("1px solid var(--border)");
		expect(declaredValue({ body: rule, property: "background" })).toBe("transparent");
		expect(declaredValue({ body: rule, property: "font-size" })).toBe("var(--text-md)");
		expect(declaredValue({ body: ruleBody({ css: CHIP_STYLES, selector: ".chip__input:checked + .chip--filter" }), property: "border-color" })).toBe(
			"var(--foreground)",
		);
		expect(declaredValue({ body: ruleBody({ css: CHIP_STYLES, selector: ".chip--filter:hover" }), property: "background" })).toBe("var(--muted)");
	});

	it("rings a filter chip whose hidden checkbox has keyboard focus", () => {
		const rule = ruleBody({ css: CHIP_STYLES, selector: ".chip__input:focus-visible + .chip--filter" });
		expect(declaredValue({ body: rule, property: "outline" })).toBe("2px solid var(--ring)");
		expect(declaredValue({ body: rule, property: "outline-offset" })).toBe("2px");
	});

	it("insets the remove control's focus ring, so it stays legible on the accent tint", () => {
		const rule = ruleBody({ css: CHIP_STYLES, selector: ".chip__remove:focus-visible" });
		expect(declaredValue({ body: rule, property: "outline" })).toBe("2px solid var(--ring)");
		expect(declaredValue({ body: rule, property: "outline-offset" })).toBe("-2px");
	});
});
