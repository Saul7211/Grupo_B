import net from "net";
import crypto from "crypto";
import { createDeck, shuffle, deal, rankValue, rankIndex, RANKS } from "./rules.js";
import { createBettingState, placeBet, resetBets } from "./apuestas.js";

const TCP_PORT = Number(process.env.TCP_PORT || 9000);
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 4);
const HAND_SIZE = Number(process.env.HAND_SIZE || 5);
const POINTS_TO_WIN = Number(process.env.POINTS_TO_WIN || 40);

const RULES = {
	caidaPoints: 2,
	limpiaPoints: 2,
	caidaYLimpiaPoints: 2,
	rondaPoints: 2,
	dobleRondaPoints: 4,
	fallaPoints: 2,
	malRepartidoPoints: 10,
	blockRondaOver30: false,
	blockNonCaidaAt38: true,
};

const clients = new Map();

const game = {
	started: false,
	round: 0,
	deck: [],
	table: [],
	players: new Map(),
	order: [],
	turnIndex: 0,
	dealerIndex: 0,
	lastPlay: null,
	teamScores: { A: 0, B: 0 },
	teamCapturedCount: { A: 0, B: 0 },
	events: [],
	betting: createBettingState({ minBet: 1, maxBet: 100 }),
};

function send(socket, payload) {
	socket.write(`${JSON.stringify(payload)}\n`);
}

function broadcast(payload) {
	for (const client of clients.values()) {
		send(client.socket, payload);
	}
}

function assignTeams() {
	game.order.forEach((id, index) => {
		const player = game.players.get(id);
		player.team = index % 2 === 0 ? "A" : "B";
	});
}

function getTeamForPlayer(id) {
	return game.players.get(id)?.team || "A";
}

function getRightOfDealer() {
	return (game.dealerIndex - 1 + game.order.length) % game.order.length;
}

function listPlayers() {
	return game.order.map((id) => {
		const player = game.players.get(id);
		return {
			id,
			name: player?.name || "Anon",
			team: player?.team || "A",
			handCount: player?.hand?.length || 0,
			capturedCount: player?.captured?.length || 0,
		};
	});
}

function getPlayerView(viewerId) {
	const viewer = game.players.get(viewerId);
	return {
		type: "state",
		started: game.started,
		round: game.round,
		dealerId: game.order[game.dealerIndex] || null,
		turnId: game.order[game.turnIndex] || null,
		players: listPlayers(),
		table: game.table,
		teamScores: game.teamScores,
		teamCapturedCount: game.teamCapturedCount,
		pot: game.betting.pot,
		bets: game.betting.bets,
		hand: viewer?.hand || [],
		team: viewer?.team || "A",
	};
}

function awardPoints(team, points, reason) {
	if (points <= 0) return;
	if (RULES.blockNonCaidaAt38 && game.teamScores[team] >= 38 && reason !== "caida") {
		game.events.push({ type: "blocked", team, reason });
		return;
	}
	if (RULES.blockRondaOver30 && reason === "ronda" && game.teamScores[team] >= 30) {
		game.events.push({ type: "blocked", team, reason });
		return;
	}
	game.teamScores[team] += points;
	game.events.push({ type: "score", team, reason, points });
	if (game.started) {
		checkWin();
	}
}

function checkWin() {
	if (game.teamScores.A >= POINTS_TO_WIN || game.teamScores.B >= POINTS_TO_WIN) {
		const winnerTeam = game.teamScores.A >= POINTS_TO_WIN ? "A" : "B";
		endRound("chica", winnerTeam);
		return true;
	}
	return false;
}

function resetRoundState() {
	game.deck = shuffle(createDeck());
	game.table = [];
	game.lastPlay = null;
	game.teamCapturedCount = { A: 0, B: 0 };
	game.events = [];
	resetBets(game.betting);
	for (const player of game.players.values()) {
		player.hand = [];
		player.captured = [];
		player.hasCaptured = false;
	}
}

function dealHands() {
	for (const id of game.order) {
		const player = game.players.get(id);
		player.hand = deal(game.deck, HAND_SIZE);
	}
	evaluateRonda();
}

function evaluateRonda() {
	for (const id of game.order) {
		const player = game.players.get(id);
		const counts = new Map();
		for (const card of player.hand) {
			counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
		}
		let maxCount = 0;
		for (const count of counts.values()) {
			if (count > maxCount) maxCount = count;
		}
		if (maxCount >= 4) {
			awardPoints(player.team, RULES.dobleRondaPoints, "ronda");
		} else if (maxCount === 3) {
			awardPoints(player.team, RULES.rondaPoints, "ronda");
		}
	}
}

function startGame() {
	if (game.players.size < 2 || game.players.size % 2 !== 0) {
		throw new Error("Need 2 or 4 players to start");
	}
	game.started = true;
	game.round += 1;
	resetRoundState();
	dealHands();
	game.turnIndex = getRightOfDealer();
}

function allHandsEmpty() {
	for (const player of game.players.values()) {
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

function hasAnyCapture(playedCard) {
	if (game.table.some((tableCard) => tableCard.rank === playedCard.rank)) {
		return true;
	}
	const target = rankValue(playedCard.rank);
	const values = game.table.map((card) => rankValue(card.rank));
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

function validateCaptureSelection(playedCard, selectedCards) {
	if (selectedCards.length === 0) {
		if (hasAnyCapture(playedCard)) {
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

function removeCardsFromTable(cardIds) {
	const idSet = new Set(cardIds);
	game.table = game.table.filter((card) => !idSet.has(card.id));
}

function applyCapture(player, playedCard, selectedCards) {
	removeCardsFromTable(selectedCards.map((card) => card.id));
	const capturedCards = [...selectedCards, playedCard];
	player.captured.push(...capturedCards);
	player.hasCaptured = true;
	game.teamCapturedCount[player.team] += capturedCards.length;
	const limpia = game.table.length === 0;
	let caida = false;

	if (game.lastPlay) {
		const prevPlayerId = game.order[(game.turnIndex - 1 + game.order.length) % game.order.length];
		const isPrevPlayer = game.lastPlay.playerId === prevPlayerId;
		const includesLast = selectedCards.some((card) => card.id === game.lastPlay.cardId);
		if (isPrevPlayer && includesLast && game.lastPlay.rank === playedCard.rank) {
			caida = true;
		}
	}

	if (caida && limpia) {
		awardPoints(player.team, RULES.caidaYLimpiaPoints, "caida_y_limpia");
	} else {
		if (caida) awardPoints(player.team, RULES.caidaPoints, "caida");
		if (limpia) awardPoints(player.team, RULES.limpiaPoints, "limpia");
	}

	return { caida, limpia };
}

function finishCarton() {
	const cardsA = game.teamCapturedCount.A;
	const cardsB = game.teamCapturedCount.B;
	if (cardsA === 0 || cardsB === 0) {
		const winningTeam = cardsA === 0 ? "B" : "A";
		awardPoints(winningTeam, RULES.fallaPoints, "falla");
	}

	if (cardsA === cardsB && cardsA <= 20) {
		const nextDealerIndex = (game.dealerIndex + 1) % game.order.length;
		const nextDealerId = game.order[nextDealerIndex];
		const nextTeam = getTeamForPlayer(nextDealerId);
		awardPoints(nextTeam, 2, "dos_por_dar");
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
		awardPoints("A", cartonA, "carton");
	} else if (cartonB > cartonA) {
		awardPoints("B", cartonB, "carton");
	}
}

function endRound(reason, winnerTeam = null) {
	if (!winnerTeam) {
		winnerTeam = game.teamScores.A >= game.teamScores.B ? "A" : "B";
	}

	const verdict = {
		reason,
		winnerTeam,
		round: game.round,
		teamScores: game.teamScores,
		teamCapturedCount: game.teamCapturedCount,
		events: game.events,
		pot: game.betting.pot,
	};

	broadcast({ type: "final", verdict });
	game.started = false;
	game.table = [];
}

function maybeDealNext() {
	if (!allHandsEmpty()) return false;
	if (game.deck.length < HAND_SIZE * game.order.length) {
		finishCarton();
		if (!checkWin()) {
			endRound("deck_empty");
		}
		return false;
	}
	dealHands();
	game.turnIndex = getRightOfDealer();
	game.lastPlay = null;
	return true;
}

function advanceTurn() {
	game.turnIndex = (game.turnIndex + 1) % game.order.length;
}

function handlePlay(playerId, payload) {
	if (!game.started) throw new Error("Game not started");
	if (game.order[game.turnIndex] !== playerId) {
		throw new Error("Not your turn");
	}
	const player = game.players.get(playerId);
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
	const selectedCards = game.table.filter((card) => captureIds.includes(card.id));
	if (captureIds.length !== selectedCards.length) {
		throw new Error("Invalid capture selection");
	}

	const validation = validateCaptureSelection(played, selectedCards);
	if (validation.type === "none") {
		game.table.push(played);
		game.lastPlay = { playerId, cardId: played.id, rank: played.rank };
	} else {
		applyCapture(player, played, selectedCards);
		game.lastPlay = null;
	}

	if (!game.started) {
		return;
	}

	if (maybeDealNext()) {
		return;
	}

	advanceTurn();
}

const server = net.createServer((socket) => {
	if (game.players.size >= MAX_PLAYERS) {
		socket.write(`${JSON.stringify({ type: "error", message: "Server full" })}\n`);
		socket.end();
		return;
	}

	socket.setEncoding("utf8");
	const id = crypto.randomUUID();
	clients.set(id, { socket, buffer: "" });
	game.players.set(id, { id, name: "Anon", hand: [], captured: [], team: "A" });
	game.order = Array.from(game.players.keys());
	assignTeams();

	send(socket, { type: "welcome", id });

	socket.on("data", (data) => {
		const client = clients.get(id);
		client.buffer += data;
		let lineEnd = client.buffer.indexOf("\n");
		while (lineEnd !== -1) {
			const line = client.buffer.slice(0, lineEnd).trim();
			client.buffer = client.buffer.slice(lineEnd + 1);
			lineEnd = client.buffer.indexOf("\n");

			if (!line) continue;
			try {
				const message = JSON.parse(line);
				handleMessage(id, message);
			} catch (error) {
				send(socket, { type: "error", message: error.message });
			}
		}
	});

	socket.on("close", () => {
		clients.delete(id);
		game.players.delete(id);
		game.order = Array.from(game.players.keys());
		assignTeams();
		broadcast({ type: "player_left", id });
		if (game.started && game.players.size < 2) {
			endRound("player_left");
		}
	});
});

function handleMessage(playerId, message) {
	const player = game.players.get(playerId);
	switch (message.type) {
		case "ping":
			send(clients.get(playerId).socket, { type: "pong" });
			break;
		case "hello":
			player.name = message.name || "Anon";
			broadcast({ type: "players", players: listPlayers() });
			break;
		case "state":
			send(clients.get(playerId).socket, getPlayerView(playerId));
			break;
		case "start":
			startGame();
			broadcast({ type: "started" });
			for (const id of game.order) {
				send(clients.get(id).socket, getPlayerView(id));
			}
			break;
		case "bet":
			placeBet(game.betting, playerId, Number(message.amount));
			broadcast({ type: "bet", pot: game.betting.pot, bets: game.betting.bets });
			break;
		case "play":
			handlePlay(playerId, message);
			for (const id of game.order) {
				send(clients.get(id).socket, getPlayerView(id));
			}
			break;
		default:
			throw new Error("Unknown message type");
	}
}

server.listen(TCP_PORT, () => {
	console.log(`Game engine listening on port ${TCP_PORT}`);
});
