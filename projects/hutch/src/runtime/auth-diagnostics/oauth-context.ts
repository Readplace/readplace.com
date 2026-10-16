import { authDiagnosticContext, type AuthDiagnosticContext } from "./record";

const clients: Record<string, Pick<AuthDiagnosticContext, "client" | "surface">> = {
	"hutch-chrome-extension": { client: "chrome", surface: "background" },
	"hutch-firefox-extension": { client: "firefox", surface: "background" },
	"ios-app": { client: "ios", surface: "app" },
	"android-app": { client: "android", surface: "app" },
};

export function attributeOAuthClient(clientId: string): void {
	const context = authDiagnosticContext.getStore();
	if (context) Object.assign(context, clients[clientId] ?? { client: "external", surface: "external" });
}
