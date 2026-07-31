export const READY_NONCE_ENV = "E2E_READY_NONCE";

export function readyProbePath(nonce: string): string {
	return `/e2e/ready/${nonce}`;
}
