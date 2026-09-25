import assert from "node:assert/strict";
import { BASE_CSS_VARIABLES, EMAIL_FRAME_CANVAS, SYSTEM_THEME_VARIABLES } from "./base.styles";

function lightRootDeclarations(): string {
	const lightRoot = /:root \{\s*color-scheme: light;([^}]*)\}/.exec(BASE_CSS_VARIABLES);
	assert(lightRoot, "BASE_CSS_VARIABLES must declare the light theme on :root");
	return lightRoot[1];
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

describe("BASE_CSS_VARIABLES", () => {
	it("opens with the system theme tokens every surface shares", () => {
		expect(BASE_CSS_VARIABLES.startsWith(SYSTEM_THEME_VARIABLES)).toBe(true);
	});
});
