import type { OAuthClientId } from "./oauth.schema";

export interface OAuthClient {
	id: OAuthClientId;
	name: string;
	redirectUris: string[];
	grants: string[];
}
