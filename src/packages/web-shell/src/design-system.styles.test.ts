import { BUTTON_STYLES, DARK_ONLY_BODY_CLASS, LIGHT_ONLY_BODY_CLASS, SYSTEM_THEME_VARIABLES, UTILITY_STYLES } from "./base.styles";
import { DESIGN_SYSTEM_STYLES } from "./design-system.styles";
import { IN_FLIGHT_DOTS_STYLES } from "./shared/in-flight-dots/in-flight-dots.styles";

describe("DESIGN_SYSTEM_STYLES", () => {
	it("declares the same theme tokens the web pages declare", () => {
		expect(DESIGN_SYSTEM_STYLES.startsWith(SYSTEM_THEME_VARIABLES)).toBe(true);
	});

	it("follows the system theme, since a surface outside the web has no account setting to resolve", () => {
		expect(DESIGN_SYSTEM_STYLES).toContain("@media (prefers-color-scheme: dark)");
	});

	it("never pins a theme, since no surface outside the web carries the pinning body classes", () => {
		expect(DESIGN_SYSTEM_STYLES).not.toContain(`body.${LIGHT_ONLY_BODY_CLASS}`);
		expect(DESIGN_SYSTEM_STYLES).not.toContain(`body.${DARK_ONLY_BODY_CLASS}`);
	});

	it("ships the shared button system, the screen-reader utility and the in-flight dots", () => {
		expect(DESIGN_SYSTEM_STYLES).toContain(BUTTON_STYLES);
		expect(DESIGN_SYSTEM_STYLES).toContain(UTILITY_STYLES);
		expect(DESIGN_SYSTEM_STYLES).toContain(IN_FLIGHT_DOTS_STYLES);
	});
});
