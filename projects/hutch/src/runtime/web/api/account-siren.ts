import type { SirenEntity, SirenLink } from "./siren";

/** The account resource as Siren. Carries the account-scoped affordances a
 * client can act on — today just irreversible deletion, advertised as a bare
 * no-body POST tagged with the reserved "destructive" role token so the client
 * gates it behind its own confirmation. */
export function toAccountEntity(): SirenEntity {
	const links: SirenLink[] = [{ rel: ["self"], href: "/account" }];

	return {
		class: ["account"],
		links,
		actions: [
			{
				name: "delete-account",
				title: "Delete account",
				href: "/account/delete",
				method: "POST",
				class: ["destructive"],
			},
		],
	};
}
