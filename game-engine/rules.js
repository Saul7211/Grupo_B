export const SUITS = ["corazones ♥️", "diamantes ♦️", "treboles ♣️", "picas ♠️"];
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "J", "Q", "K"];
export const RANK_VALUE = {
	A: 1,
	2: 2,
	3: 3,
	4: 4,
	5: 5,
	6: 6,
	7: 7,
	J: 8,
	Q: 9,
	K: 10,
};

export function createDeck() {
	const deck = [];
	let counter = 0;
	for (const suit of SUITS) {
		for (const rank of RANKS) {
			deck.push({ id: `${suit}-${rank}-${counter}`, suit, rank });
			counter += 1;
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

export function rankValue(rank) {
	return RANK_VALUE[rank] ?? 0;
}

export function rankIndex(rank) {
	return RANKS.indexOf(rank);
}
