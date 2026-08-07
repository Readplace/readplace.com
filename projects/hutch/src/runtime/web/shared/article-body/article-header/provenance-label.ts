import type { SaveProvenance } from "@packages/domain/article";
import { SUPPORTED_CLIENTS } from "@packages/supported-clients";
import { iconSvg } from "@packages/ui-icons";
import { CLIENT_ICON_SVG } from "../../client-icons";

export interface ProvenanceLabel {
	label: string;
	iconSvg?: string;
}

/** Absent rather than a raw slug: the name is a stored value, so a client that
 * has since left the registry has no display name to stand behind and the
 * reader says nothing instead of leaking the wire value. */
function labelForClient(clientName: string): ProvenanceLabel | undefined {
	const client = SUPPORTED_CLIENTS.find((candidate) => candidate.name === clientName);
	if (!client) return undefined;
	return { label: `via ${client.displayName}`, iconSvg: CLIENT_ICON_SVG[client.name] };
}

/** The registered name is supplied by the client itself, so it is matched against
 * the roster and never rendered — an assistant we don't recognise gets the
 * generic label. */
function labelForAssistant(registeredName: string): ProvenanceLabel {
	const assistant = SUPPORTED_CLIENTS.find(
		(candidate) =>
			candidate.group === "aiAssistant" &&
			candidate.displayName.toLowerCase() === registeredName.trim().toLowerCase(),
	);
	if (!assistant) return { label: "via AI assistant" };
	return { label: `via ${assistant.displayName}`, iconSvg: CLIENT_ICON_SVG[assistant.name] };
}

/** The last arm is `default` so a sixth provenance kind fails to compile here
 * rather than falling through to the assistant label. */
export function provenanceLabel(provenance: SaveProvenance): ProvenanceLabel | undefined {
	switch (provenance.kind) {
		case "web":
			return { label: "via Web" };
		case "import":
			return { label: "via Import" };
		case "client":
			return labelForClient(provenance.clientName);
		case "email": {
			const sender = provenance.senderEmail.trim();
			return { label: `via ${sender === "" ? "Email" : sender}`, iconSvg: iconSvg("mail") };
		}
		default:
			return labelForAssistant(provenance.registeredName);
	}
}
