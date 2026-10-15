import { BUTTON_STYLES, SYSTEM_THEME_VARIABLES, UTILITY_STYLES } from "./base.styles";
import { ALERT_STYLES } from "./shared/alert/alert.styles";
import { IN_FLIGHT_DOTS_STYLES } from "./shared/in-flight-dots/in-flight-dots.styles";

export { SYSTEM_THEME_VARIABLES };

export const DESIGN_SYSTEM_STYLES = `${SYSTEM_THEME_VARIABLES}${BUTTON_STYLES}${UTILITY_STYLES}${IN_FLIGHT_DOTS_STYLES}${ALERT_STYLES}`;
