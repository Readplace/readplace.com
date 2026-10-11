import { iconSvg } from "@packages/ui-icons";
import { CLIENT_ICON_SVG } from "../../client-icons";
import { provenanceLabel, provenanceTitle } from "./provenance-label";

describe("provenanceLabel", () => {
	it("identifies automatic suggestions and legacy founder seeds", () => {
		expect(
			provenanceLabel({
				kind: "hn-suggestion",
				campaignId: "hn-starter-v1",
				snapshotAt: "date",
				hnItemId: 1,
				rank: 1,
			}),
		).toEqual({ label: "Added by Readplace from Hacker News" });
		expect(provenanceLabel({ kind: "founder-seed" })).toEqual({ label: "Added by Readplace" });
	});
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
			{ label: "via news@example.com", iconSvg: iconSvg("envelope") },
			{ label: "via Claude", iconSvg: CLIENT_ICON_SVG.claude },
		]);
	});

	it("says nothing for a client that has since left the roster, rather than showing its stored slug", () => {
		expect(provenanceLabel({ kind: "client", clientName: "netscape" })).toBeUndefined();
	});

	it("names the medium alone when the email carried no parseable sender, so the tag never reads 'via '", () => {
		expect(provenanceLabel({ kind: "email", senderEmail: "   " })).toEqual({
			label: "via Email",
			iconSvg: iconSvg("envelope"),
		});
	});

	it("names the newsletter a recognised sender publishes, in place of its address", () => {
		expect(provenanceLabel({ kind: "newsletter", name: "TLDR", senderEmail: "dan@tldr.tech" })).toEqual({
			label: "via TLDR",
			iconSvg: iconSvg("envelope"),
			senderEmail: "dan@tldr.tech",
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

describe("provenanceTitle", () => {
	it("puts the sender address behind a newsletter name, so hover still reaches the address", () => {
		expect(provenanceTitle({ label: "via TLDR", senderEmail: "dan@tldr.tech" })).toBe("dan@tldr.tech");
	});

	it("repeats the label when it already shows everything there is to show", () => {
		expect([
			provenanceTitle({ label: "via news@example.com" }),
			provenanceTitle({ label: "via Email" }),
			provenanceTitle({ label: "via Chrome" }),
		]).toEqual(["via news@example.com", "via Email", "via Chrome"]);
	});
});
