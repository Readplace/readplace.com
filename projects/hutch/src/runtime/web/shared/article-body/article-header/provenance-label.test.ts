import { iconSvg } from "@packages/ui-icons";
import { CLIENT_ICON_SVG } from "../../client-icons";
import { provenanceLabel } from "./provenance-label";

describe("provenanceLabel", () => {
	it("names the surface a save came from", () => {
		expect([
			provenanceLabel({ kind: "web" }),
			provenanceLabel({ kind: "import" }),
			provenanceLabel({ kind: "client", clientName: "chrome" }),
			provenanceLabel({ kind: "email", senderEmail: "news@example.com" }),
			provenanceLabel({ kind: "mcp", registeredName: "Claude" }),
		]).toEqual([
			{ label: "via Web" },
			{ label: "via Import" },
			{ label: "via Chrome", iconSvg: CLIENT_ICON_SVG.chrome },
			{ label: "via news@example.com", iconSvg: iconSvg("mail") },
			{ label: "via Claude", iconSvg: CLIENT_ICON_SVG.claude },
		]);
	});

	it("says nothing for a client that has since left the roster, rather than showing its stored slug", () => {
		expect(provenanceLabel({ kind: "client", clientName: "netscape" })).toBeUndefined();
	});

	it("names the medium alone when the email carried no parseable sender, so the tag never reads 'via '", () => {
		expect(provenanceLabel({ kind: "email", senderEmail: "   " })).toEqual({
			label: "via Email",
			iconSvg: iconSvg("mail"),
		});
	});

	it("matches an assistant however it cased the name it registered under", () => {
		expect(provenanceLabel({ kind: "mcp", registeredName: "  chatgpt  " })).toEqual({
			label: "via ChatGPT",
			iconSvg: CLIENT_ICON_SVG.chatgpt,
		});
	});

	it("stays generic for an assistant it cannot recognise, so a client-supplied name is never rendered", () => {
		expect(provenanceLabel({ kind: "mcp", registeredName: "dyn-registered-mcp-client" })).toEqual({
			label: "via AI assistant",
		});
	});
});
