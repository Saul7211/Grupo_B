import net from "net";
import { createDeck, shuffle, deal, rankValue, rankIndex, RANKS } from "./rules.js";
import { createBettingState, resetBets } from "./apuestas.js";

const TCP_PORT = Number(process.env.TCP_PORT || 5000);
const HAND_SIZE = Number(process.env.HAND_SIZE || 5);
const POINTS_TO_WIN = Number(process.env.POINTS_TO_WIN || 40);

const RULES = {
	caidaPoints: 2,
	limpiaPoints: 2,
	caidaYLimpiaPoints: 2,
	rondaPoints: 2,
	dobleRondaPoints: 4,
	fallaPoints: 2,
	blockRondaOver30: false,
	blockNonCaidaAt38: true,
};

const sessions = new Map();

function sendResponse(socket, payload) {
	socket.write(JSON.stringify(payload));
	socket.end();
}

function assignTeams(session) {
	session.order.forEach((id, index) => {
		const player = session.players.get(id);
		player.team = index % 2 === 0 ? "A" : "B";
	});
}

function getTeamForPlayer(session, id) {
	return session.players.get(id)?.team || "A";
}

function getRightOfDealer(session) {
	return (session.dealerIndex - 1 + session.order.length) % session.order.length;
}

function listPlayers(session) {
	return session.order.map((id) => {
		const player = session.players.get(id);
		return {
			id,
			team: player?.team || "A",
			handCount: player?.hand?.length || 0,
			capturedCount: player?.captured?.length || 0,
		};
	});
}

function getState(session) {
	return {
		started: session.started,
		round: session.round,
		dealerId: session.order[session.dealerIndex] || null,
		turnId: session.order[session.turnIndex] || null,
		players: listPlayers(session),
		table: session.table,
		teamScores: session.teamScores,
		teamCapturedCount: session.teamCapturedCount,
		pot: session.betting.pot,
	};
}

function getHands(session) {
	const hands = {};
	for (const id of session.order) {
		hands[id] = session.players.get(id)?.hand || [];
	}
	return hands;
}

function awardPoints(session, team, points, reason) {
	if (points <= 0) return null;
	if (RULES.blockNonCaidaAt38 && session.teamScores[team] >= 38 && reason !== "caida") {
		session.events.push({ type: "blocked", team, reason });
		return null;
	}
	if (RULES.blockRondaOver30 && reason === "ronda" && session.teamScores[team] >= 30) {
		session.events.push({ type: "blocked", team, reason });
		return null;
	}
	session.teamScores[team] += points;
	session.events.push({ type: "score", team, reason, points });
	return checkWin(session);
}

function checkWin(session) {
	if (session.teamScores.A >= POINTS_TO_WIN || session.teamScores.B >= POINTS_TO_WIN) {
		const winnerTeam = session.teamScores.A >= POINTS_TO_WIN ? "A" : "B";
		return endRound(session, "chica", winnerTeam);
	}
	return null;
}

function resetRoundState(session) {
	session.deck = shuffle(createDeck());
	session.table = [];
	session.lastPlay = null;
	session.teamCapturedCount = { A: 0, B: 0 };
	session.events = [];
	resetBets(session.betting);
	for (const player of session.players.values()) {
		player.hand = [];
		player.captured = [];
		player.hasCaptured = false;
	}
}

function dealHands(session) {
	for (const id of session.order) {
		const player = session.players.get(id);
		player.hand = deal(session.deck, HAND_SIZE);
	}
	evaluateRonda(session);
}

function evaluateRonda(session) {
	for (const id of session.order) {
		const player = session.players.get(id);
		const counts = new Map();
		for (const card of player.hand) {
			counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
		}
		let maxCount = 0;
		for (const count of counts.values()) {
			if (count > maxCount) maxCount = count;
		}
		if (maxCount >= 4) {
			awardPoints(session, player.team, RULES.dobleRondaPoints, "ronda");
		} else if (maxCount === 3) {
			awardPoints(session, player.team, RULES.rondaPoints, "ronda");
		}
	}
}

function createSession({ sessionId, players, totalPot }) {
	if (!Array.isArray(players) || players.length < 2 || players.length % 2 !== 0) {
		throw new Error("Need 2 or 4 players to start");
	}
	const session = {
		sessionId,
		started: true,
		ended: false,
		round: 1,
		deck: [],
		table: [],
		players: new Map(),
		order: [...players],
		turnIndex: 0,
		dealerIndex: 0,
		lastPlay: null,
		teamScores: { A: 0, B: 0 },
		teamCapturedCount: { A: 0, B: 0 },
		events: [],
		betting: createBettingState({ minBet: 1, maxBet: 100 }),
		finalVerdict: null,
	};
	for (const id of session.order) {
		session.players.set(id, { id, hand: [], captured: [], team: "A", hasCaptured: false });
	}
	assignTeams(session);
	resetRoundState(session);
	session.betting.pot = Number(totalPot) || 0;
	dealHands(session);
	session.turnIndex = getRightOfDealer(session);
	return session;
}

function allHandsEmpty(session) {
	for (const player of session.players.values()) {
		if (player.hand.length > 0) return false;
	}
	return true;
}

function hasSubsetSum(values, target) {
	function search(index, remaining) {
		if (remaining === 0) return true;
		if (remaining < 0 || index >= values.length) return false;
		return search(index + 1, remaining) || search(index + 1, remaining - values[index]);
	}
	return search(0, target);
}

function hasAnyCapture(session, playedCard) {
	if (session.table.some((tableCard) => tableCard.rank === playedCard.rank)) {
		return true;
	}
	const target = rankValue(playedCard.rank);
	const values = session.table.map((card) => rankValue(card.rank));
	return hasSubsetSum(values, target);
}

function validateEscaleraSelection(playedCard, selectedCards) {
	const selectedRanks = selectedCards.map((card) => card.rank);
	const playedIndex = rankIndex(playedCard.rank);
	const uniqueRanks = new Set(selectedRanks);
	if (uniqueRanks.size !== selectedRanks.length) {
		throw new Error("Escalera cannot repeat ranks");
	}
	for (const rank of selectedRanks) {
		if (rankIndex(rank) < playedIndex) {
			throw new Error("Escalera cannot include lower ranks");
		}
	}
	const equalCount = selectedRanks.filter((rank) => rank === playedCard.rank).length;
	if (equalCount !== 1) {
		throw new Error("Escalera requires exactly one equal card");
	}

	const highestSelectedIndex = Math.max(...selectedRanks.map(rankIndex));
	for (let i = playedIndex + 1; i <= highestSelectedIndex; i += 1) {
		const rank = RANKS[i];
		const isSelected = selectedRanks.includes(rank);
		if (!isSelected) {
			throw new Error("Escalera must be consecutive without gaps");
		}
	}
}

function validateCaptureSelection(session, playedCard, selectedCards) {
	if (selectedCards.length === 0) {
		if (hasAnyCapture(session, playedCard)) {
			throw new Error("Capture required");
		}
		return { type: "none" };
	}

	const hasEqual = selectedCards.some((card) => card.rank === playedCard.rank);
	if (hasEqual) {
		validateEscaleraSelection(playedCard, selectedCards);
		return { type: "equal" };
	}

	const total = selectedCards.reduce((sum, card) => sum + rankValue(card.rank), 0);
	if (total !== rankValue(playedCard.rank)) {
		throw new Error("Sum capture does not match played card value");
	}
	return { type: "sum" };
}

function removeCardsFromTable(session, cardIds) {
	const idSet = new Set(cardIds);
	session.table = session.table.filter((card) => !idSet.has(card.id));
}

function applyCapture(session, player, playedCard, selectedCards) {
	removeCardsFromTable(session, selectedCards.map((card) => card.id));
	const capturedCards = [...selectedCards, playedCard];
	player.captured.push(...capturedCards);
	player.hasCaptured = true;
	session.teamCapturedCount[player.team] += capturedCards.length;
	const limpia = session.table.length === 0;
	let caida = false;
	let verdict = null;

	if (session.lastPlay) {
		const prevPlayerId = session.order[(session.turnIndex - 1 + session.order.length) % session.order.length];
		const isPrevPlayer = session.lastPlay.playerId === prevPlayerId;
		const includesLast = selectedCards.some((card) => card.id === session.lastPlay.cardId);
		if (isPrevPlayer && includesLast && session.lastPlay.rank === playedCard.rank) {
			caida = true;
		}
	}

	if (caida && limpia) {
		verdict = awardPoints(session, player.team, RULES.caidaYLimpiaPoints, "caida_y_limpia");
	} else {
		if (caida) verdict = awardPoints(session, player.team, RULES.caidaPoints, "caida");
		if (limpia) verdict = awardPoints(session, player.team, RULES.limpiaPoints, "limpia");
	}

	return { caida, limpia, verdict };
}

function finishCarton(session) {
	const cardsA = session.teamCapturedCount.A;
	const cardsB = session.teamCapturedCount.B;
	if (cardsA === 0 || cardsB === 0) {
		const winningTeam = cardsA === 0 ? "B" : "A";
		awardPoints(session, winningTeam, RULES.fallaPoints, "falla");
	}

	if (cardsA === cardsB && cardsA <= 20) {
		const nextDealerIndex = (session.dealerIndex + 1) % session.order.length;
		const nextDealerId = session.order[nextDealerIndex];
		const nextTeam = getTeamForPlayer(session, nextDealerId);
		awardPoints(session, nextTeam, 2, "dos_por_dar");
		return;
	}

	function cartonPoints(cards) {
		if (cards < 20) return 0;
		const extra = cards - 20;
		return 6 + 2 * Math.ceil(extra / 2);
	}

	const cartonA = cartonPoints(cardsA);
	const cartonB = cartonPoints(cardsB);
	if (cartonA > cartonB) {
		awardPoints(session, "A", cartonA, "carton");
	} else if (cartonB > cartonA) {
		awardPoints(session, "B", cartonB, "carton");
	}
}

function endRound(session, reason, winnerTeam = null) {
	if (!winnerTeam) {
		winnerTeam = session.teamScores.A >= session.teamScores.B ? "A" : "B";
	}

	const winnerIds = session.order.filter((id) => getTeamForPlayer(session, id) === winnerTeam);
	const verdict = {
		reason,
		winnerTeam,
		winnerIds,
		winnerId: winnerIds[0] || null,
		round: session.round,
		teamScores: session.teamScores,
		teamCapturedCount: session.teamCapturedCount,
		events: session.events,
		pot: session.betting.pot,
	};

	session.started = false;
	session.ended = true;
	session.table = [];
	session.finalVerdict = verdict;
	return verdict;
}

function maybeDealNext(session) {
	if (!allHandsEmpty(session)) return null;
	if (session.deck.length < HAND_SIZE * session.order.length) {
		finishCarton(session);
		return checkWin(session) || endRound(session, "deck_empty");
	}
	dealHands(session);
	session.turnIndex = getRightOfDealer(session);
	session.lastPlay = null;
	return null;
}

function advanceTurn(session) {
	session.turnIndex = (session.turnIndex + 1) % session.order.length;
}

function handlePlay(session, playerId, payload) {
	if (!session.started) throw new Error("Game not started");
	if (session.order[session.turnIndex] !== playerId) {
		throw new Error("Not your turn");
	}
	const player = session.players.get(playerId);
	if (!player) throw new Error("Player not found");
	const cardId = payload?.card?.id;
	const cardIndex = player.hand.findIndex((card) => {
		if (cardId) return card.id === cardId;
		return card.suit === payload?.card?.suit && card.rank === payload?.card?.rank;
	});
	if (cardIndex === -1) {
		throw new Error("Card not in hand");
	}

	const played = player.hand.splice(cardIndex, 1)[0];
	const captureIds = Array.isArray(payload?.capture)
		? payload.capture.map((entry) => (typeof entry === "string" ? entry : entry?.id)).filter(Boolean)
		: [];
	const selectedCards = session.table.filter((card) => captureIds.includes(card.id));
	if (captureIds.length !== selectedCards.length) {
		throw new Error("Invalid capture selection");
	}

	const validation = validateCaptureSelection(session, played, selectedCards);
	let verdict = null;
	if (validation.type === "none") {
		session.table.push(played);
		session.lastPlay = { playerId, cardId: played.id, rank: played.rank };
	} else {
		const captureResult = applyCapture(session, player, played, selectedCards);
		verdict = captureResult.verdict;
		session.lastPlay = null;
	}

	if (session.ended) {
		return { verdict: session.finalVerdict };
	}

	const dealVerdict = maybeDealNext(session);
	if (dealVerdict) {
		return { verdict: dealVerdict };
	}

	advanceTurn(session);
	return { verdict };
}

function handleAction(message) {
	const action = message?.action;
	if (!action) throw new Error("Missing action");

	switch (action) {
		case "START_GAME": {
			const sessionId = message.sessionId;
			if (!sessionId) throw new Error("Missing sessionId");
			if (sessions.has(sessionId)) throw new Error("Session already exists");
			const session = createSession({
				sessionId,
				players: message.players,
				totalPot: message.totalPot,
			});
			sessions.set(sessionId, session);
			return {
				action: "GAME_STARTED",
				sessionId,
				state: getState(session),
				hands: getHands(session),
			};
		}
		case "PLAY_CARD": {
			const sessionId = message.sessionId;
			const playerId = message.playerId;
			const session = sessions.get(sessionId);
			if (!session) throw new Error("Session not found");
			const result = handlePlay(session, playerId, message);
			return {
				action: result?.verdict ? "FINAL" : "STATE_UPDATE",
				sessionId,
				state: getState(session),
				hands: getHands(session),
				verdict: result?.verdict || null,
			};
		}
		case "GET_STATE": {
			const sessionId = message.sessionId;
			const session = sessions.get(sessionId);
			if (!session) throw new Error("Session not found");
			const playerId = message.playerId;
			const response = {
				action: "STATE",
				sessionId,
				state: getState(session),
			};
			if (playerId) {
				response.hand = session.players.get(playerId)?.hand || [];
			}
			return response;
		}
		case "END_GAME": {
			const sessionId = message.sessionId;
			const session = sessions.get(sessionId);
			if (!session) throw new Error("Session not found");
			const verdict = endRound(session, "manual");
			return {
				action: "FINAL",
				sessionId,
				state: getState(session),
				verdict,
			};
		}
		default:
			throw new Error("Unknown action");
	}
}

const server = net.createServer((socket) => {
	socket.setEncoding("utf8");
	let buffer = "";

	socket.on("data", (data) => {
		buffer += data;
		let lineEnd = buffer.indexOf("\n");
		while (lineEnd !== -1) {
			const line = buffer.slice(0, lineEnd).trim();
			buffer = buffer.slice(lineEnd + 1);
			lineEnd = buffer.indexOf("\n");
			if (!line) continue;
			try {
				const message = JSON.parse(line);
				const response = handleAction(message);
				sendResponse(socket, response);
				return;
			} catch (error) {
				sendResponse(socket, { action: "ERROR", message: error.message });
				return;
			}
		}

		try {
			const message = JSON.parse(buffer.trim());
			const response = handleAction(message);
			sendResponse(socket, response);
			buffer = "";
		} catch (error) {
			if (!buffer.trim()) return;
			if (error instanceof SyntaxError) {
				return;
			}
			sendResponse(socket, { action: "ERROR", message: error.message });
		}
	});

	socket.on("error", (error) => {
		console.error("[Engine] Socket error:", error.message);
	});
});

server.listen(TCP_PORT, () => {
	console.log(`Game engine listening on port ${TCP_PORT}`);
});
