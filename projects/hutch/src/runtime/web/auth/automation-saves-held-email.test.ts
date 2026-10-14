import { JSDOM } from "jsdom";
import { AutomationSavesHeldEmail } from "./automation-saves-held-email";

const INBOX_URL = "https://readplace.com/inbox?highlight=held-email";
const REACTIVATE_URL = "https://readplace.com/account?utm_content=reactivate";
const MANAGE_URL = "https://readplace.com/newsletters/custom-emails?utm_content=manage-addresses";

const AFTER_THE_OPENING = [
	`Don't worry, you didn't lose anything. The email and the extracted articles stay in your Inbox. You can save them yourself, and new emails go back to saving automatically, once your subscription is active again: ${REACTIVATE_URL}`,
	`See the articles waiting: ${INBOX_URL}`,
	"If you have any questions, please reply to this email",
	`If you'd rather not continue, disable your custom emails and nothing more will be forwarded and you will stop receiving these emails: ${MANAGE_URL}`,
	"— Fayner Brack, Founder & CEO",
];

const heldNotice = (inboxAddress: string | undefined) =>
	AutomationSavesHeldEmail({
		founderAvatarUrl: "https://static.readplace.com/fayner-brack.jpg",
		inboxAddress,
		inboxUrl: INBOX_URL,
		reactivateUrl: REACTIVATE_URL,
		manageAddressesUrl: MANAGE_URL,
	});

describe("AutomationSavesHeldEmail", () => {
	it("names the address the held email was sent to and says what an active subscription brings back", () => {
		expect(heldNotice("news-3f9a2c@read.place").to("text/plain")).toBe([
			"An email to news-3f9a2c@read.place just arrived in your Readplace Inbox, but the articles weren't saved to All — your subscription is read-only, so saving is paused.",
			...AFTER_THE_OPENING,
		].join("\n\n"));
	});

	it("opens without an address when the notice carries none", () => {
		expect(heldNotice(undefined).to("text/plain")).toBe([
			"An email just arrived in your Readplace Inbox, but the articles weren't saved to All — your subscription is read-only, so saving is paused.",
			...AFTER_THE_OPENING,
		].join("\n\n"));
	});

	it("links the subscription, the held email and the custom emails page from the HTML body", () => {
		const { document } = new JSDOM(heldNotice("news-3f9a2c@read.place").to("text/html")).window;

		expect(document.title).toBe("Links sent to your Readplace Inbox are waiting");
		expect(document.querySelector("p")?.textContent).toBe(
			"An email to news-3f9a2c@read.place just arrived in your Readplace Inbox, but the articles weren't saved to All — your subscription is read-only, so saving is paused.",
		);
		expect([...document.querySelectorAll("a")].map((anchor) => [anchor.textContent, anchor.getAttribute("href")])).toEqual([
			["your subscription is active again", REACTIVATE_URL],
			["See the articles waiting", INBOX_URL],
			["disable your custom emails", MANAGE_URL],
		]);
	});
});
