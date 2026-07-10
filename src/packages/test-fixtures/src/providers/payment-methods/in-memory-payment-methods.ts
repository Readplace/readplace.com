import assert from "node:assert";
import {
	type BeginAddCard,
	type CardSetupId,
	CardSetupIdSchema,
	type GetCardSetupResult,
	type ListCards,
	type RemoveCard,
	type SavedCard,
	type SetPrimaryCard,
} from "@packages/provider-contracts/payment-methods";

type StoredCard = Omit<SavedCard, "isPrimary">;

interface StoredCustomer {
	cards: StoredCard[];
	defaultId: string | undefined;
}

interface StoredSetup {
	customerId: string;
	outcome: "pending" | "succeeded" | "failed";
	cardId: SavedCard["id"] | undefined;
	failureReason: string | undefined;
}

export function initInMemoryPaymentMethods(): {
	listCards: ListCards;
	beginAddCard: BeginAddCard;
	getCardSetupResult: GetCardSetupResult;
	removeCard: RemoveCard;
	setPrimaryCard: SetPrimaryCard;
	seedCards: (input: { customerId: string; cards: SavedCard[] }) => void;
	completeCardSetup: (input: { setupId: CardSetupId; card: SavedCard }) => void;
	failCardSetup: (input: { setupId: CardSetupId; reason?: string }) => void;
} {
	const customers = new Map<string, StoredCustomer>();
	const setups = new Map<CardSetupId, StoredSetup>();
	let nextSetup = 1;

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
		// The card itself materialises only when the client confirms the setup
		// against the provider — begin hands back credentials, never a card.
		void customerFor(customerId);
		const setupId = CardSetupIdSchema.parse(`seti_inmem_${nextSetup++}`);
		setups.set(setupId, {
			customerId,
			outcome: "pending",
			cardId: undefined,
			failureReason: undefined,
		});
		return { clientSecret: `${setupId}_secret`, setupId };
	};

	const getCardSetupResult: GetCardSetupResult = async ({ setupId }) => {
		const setup = setups.get(setupId);
		if (!setup || setup.outcome === "pending") {
			return {
				status: "failed",
				customerId: setup?.customerId,
				cardId: undefined,
				failureReason: undefined,
			};
		}
		return {
			status: setup.outcome,
			customerId: setup.customerId,
			cardId: setup.cardId,
			failureReason: setup.failureReason,
		};
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

	const completeCardSetup = ({ setupId, card }: { setupId: CardSetupId; card: SavedCard }): void => {
		const setup = setups.get(setupId);
		assert(setup, `No card setup: ${setupId}`);
		setup.outcome = "succeeded";
		setup.cardId = card.id;
		const customer = customerFor(setup.customerId);
		const { isPrimary, ...stored } = card;
		customer.cards = [...customer.cards.filter((existing) => existing.id !== card.id), stored];
		if (isPrimary) customer.defaultId = card.id;
	};

	const failCardSetup = ({ setupId, reason }: { setupId: CardSetupId; reason?: string }): void => {
		const setup = setups.get(setupId);
		assert(setup, `No card setup: ${setupId}`);
		setup.outcome = "failed";
		setup.failureReason = reason;
	};

	return {
		listCards,
		beginAddCard,
		getCardSetupResult,
		removeCard,
		setPrimaryCard,
		seedCards,
		completeCardSetup,
		failCardSetup,
	};
}
