export const SUITS = ["oros", "copas", "espadas", "bastos"];
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];

export function createDeck() {
	const deck = [];
	for (const suit of SUITS) {
		for (const rank of RANKS) {
			deck.push({ suit, rank });
		}
	}
	return deck;
}

export function shuffle(deck) {
	for (let i = deck.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		const temp = deck[i];
		deck[i] = deck[j];
		deck[j] = temp;
	}
	return deck;
}

export function deal(deck, count) {
	return deck.splice(0, count);
}

export function cardValue(card) {
	if (!card || typeof card.rank !== "number") {
		return 0;
	}
	return card.rank;
}

export function compareCards(cardA, cardB) {
	const valueA = cardValue(cardA);
	const valueB = cardValue(cardB);
	if (valueA > valueB) return 1;
	if (valueA < valueB) return -1;
	const suitA = SUITS.indexOf(cardA?.suit);
	const suitB = SUITS.indexOf(cardB?.suit);
	if (suitA > suitB) return 1;
	if (suitA < suitB) return -1;
	return 0;
}

export function evaluateHand(hand) {
	return hand.reduce((total, card) => total + cardValue(card), 0);
}
