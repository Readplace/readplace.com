import { type BuiltInOAuthClientId, isBuiltInOAuthClientId } from "@packages/supported-clients";

export type AddToReadlistOffer = "advertised" | "withheld";

const ADD_TO_READLIST_OFFER_BY_OAUTH_ID = {
	"hutch-chrome-extension": "advertised",
	"hutch-firefox-extension": "withheld",
	"ios-app": "advertised",
	"android-app": "advertised",
} as const satisfies Record<BuiltInOAuthClientId, AddToReadlistOffer>;

export function addToReadlistOfferForClient(oauthClientId: string | undefined): AddToReadlistOffer {
	if (oauthClientId !== undefined && isBuiltInOAuthClientId(oauthClientId)) {
		return ADD_TO_READLIST_OFFER_BY_OAUTH_ID[oauthClientId];
	}
	return "advertised";
}
