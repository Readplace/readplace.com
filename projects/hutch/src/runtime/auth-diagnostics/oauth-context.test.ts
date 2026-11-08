import { attributeOAuthClient } from "./oauth-context";
import { authDiagnosticContext, type AuthDiagnosticContext } from "./record";

describe("attributeOAuthClient", () => {
	it("should attribute the Obsidian plugin to the obsidian client on the app surface", () => {
		const context: AuthDiagnosticContext = {
			request_id: "request",
			context_id: "context",
			client: "web",
			surface: "website",
		};

		authDiagnosticContext.run(context, () => attributeOAuthClient("obsidian-plugin"));

		expect(context).toMatchObject({ client: "obsidian", surface: "app" });
	});
});
