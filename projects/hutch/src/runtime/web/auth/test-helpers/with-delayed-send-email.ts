import type { EmailBundle } from "@packages/web-test-harness";

export function withDelayedSendEmail(email: EmailBundle): EmailBundle {
	return {
		...email,
		sendEmail: async (message) => {
			await new Promise((resolve) => setTimeout(resolve, 50));
			await email.sendEmail(message);
		},
	};
}
