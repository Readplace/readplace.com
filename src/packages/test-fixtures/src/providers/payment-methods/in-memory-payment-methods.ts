import type {
	BeginAddCard,
	ListCards,
	RemoveCard,
	SavedCard,
	SetPrimaryCard,
} from "@packages/provider-contracts/payment-methods";

type StoredCard = Omit<SavedCard, "isPrimary">;

interface StoredCustomer {
	cards: StoredCard[];
	defaultId: string | undefined;
}

export function initInMemoryPaymentMethods(): {
	listCards: ListCards;
	beginAddCard: BeginAddCard;
	removeCard: RemoveCard;
	setPrimaryCard: SetPrimaryCard;
	seedCards: (input: { customerId: string; cards: SavedCard[] }) => void;
} {
	const customers = new Map<string, StoredCustomer>();
	let nextSecret = 1;

	const customerFor = (customerId: string): StoredCustomer => {
		const existing = customers.get(customerId);
		if (existing) return existing;
		const fresh: StoredCustomer = { cards: [], defaultId: undefined };
		customers.set(customerId, fresh);
		return fresh;
	};

	const listCards: ListCards = async ({ customerId }) => {
		const customer = customerFor(customerId);
		return customer.cards.map((card) => ({
			...card,
			isPrimary: card.id === customer.defaultId,
		}));
	};

	const beginAddCard: BeginAddCard = async ({ customerId }) => {
		// The card itself materialises only when the client confirms the
		// SetupIntent against Stripe; tests seed the post-confirm state via
		// seedCards. Here we just hand back a unique synthetic client secret.
		void customerFor(customerId);
		return { clientSecret: `seti_inmem_${nextSecret++}_secret` };
	};

	const removeCard: RemoveCard = async ({ customerId, cardId }) => {
		const customer = customerFor(customerId);
		customer.cards = customer.cards.filter((card) => card.id !== cardId);
	};

	const setPrimaryCard: SetPrimaryCard = async ({ customerId, cardId }) => {
		const customer = customerFor(customerId);
		customer.defaultId = cardId;
	};

	const seedCards = ({ customerId, cards }: { customerId: string; cards: SavedCard[] }): void => {
		const primary = cards.find((card) => card.isPrimary);
		customers.set(customerId, {
			cards: cards.map(({ isPrimary: _isPrimary, ...rest }) => rest),
			defaultId: primary?.id,
		});
	};

	return { listCards, beginAddCard, removeCard, setPrimaryCard, seedCards };
}
