import { UPGRADE_CTA_LABEL } from "../../pricing";
import { render } from "../../render";
import { NEEDS_UPGRADE_TEMPLATE } from "./needs-upgrade.template";

export { NEEDS_UPGRADE_STYLES } from "./needs-upgrade.styles";

export interface NeedsUpgradeControl {
	key: string;
	label: string;
	controlClass: string;
	popoverId: string;
	fallbackHref: string;
}

export function renderNeedsUpgrade(control: NeedsUpgradeControl): string {
	return render(NEEDS_UPGRADE_TEMPLATE, { ...control, chipLabel: UPGRADE_CTA_LABEL });
}
