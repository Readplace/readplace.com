import type { AuthDiagnosticEvent } from "@packages/domain/auth-diagnostics";
import type { OAuthTokens } from "./auth.types";
import type { RefreshKey } from "./refresh-proof";

type StoredCredential = OAuthTokens & {
	bound: boolean;
	grantId?: string;
	generation?: number;
	accessExpiresAt?: string;
};
export type PendingRefresh = { id: string; epoch: string; protocol: boolean };
export type DiagnosticEntry = { event: AuthDiagnosticEvent; epoch: string; permit?: string };
export type AuthState = {
	version: 1;
	installationId: string;
	epoch: string;
	key: RefreshKey;
	credentials: StoredCredential | null;
	pending: PendingRefresh | null;
	permit?: string;
	diagnosticsEndpoint?: string;
	journal: DiagnosticEntry[];
};

export interface AuthStateStore {
	read(): Promise<AuthState>;
	update<T>(mutate: (state: AuthState) => T): Promise<T>;
}
