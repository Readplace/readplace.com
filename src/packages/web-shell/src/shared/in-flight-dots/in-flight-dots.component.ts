import { render } from "../../render";
import { IN_FLIGHT_DOTS_TEMPLATE } from "./in-flight-dots.template";

export { IN_FLIGHT_DOTS_STYLES } from "./in-flight-dots.styles";

export function renderInFlightDots(className: string): string {
	return render(IN_FLIGHT_DOTS_TEMPLATE, { className });
}
