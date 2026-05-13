export function createBettingState({ minBet = 1, maxBet = 100 } = {}) {
	return {
		minBet,
		maxBet,
		pot: 0,
		bets: {},
	};
}

export function placeBet(state, playerId, amount) {
	if (!state) throw new Error("Missing betting state");
	if (!playerId) throw new Error("Missing playerId");
	if (typeof amount !== "number" || Number.isNaN(amount)) {
		throw new Error("Invalid bet amount");
	}
	if (amount < state.minBet) {
		throw new Error(`Bet below minimum (${state.minBet})`);
	}
	if (amount > state.maxBet) {
		throw new Error(`Bet above maximum (${state.maxBet})`);
	}

	const previous = state.bets[playerId] ?? 0;
	if (amount < previous) {
		throw new Error("Bet cannot be decreased");
	}

	state.bets[playerId] = amount;
	state.pot += amount - previous;
	return state;
}

export function resetBets(state) {
	state.pot = 0;
	state.bets = {};
	return state;
}
