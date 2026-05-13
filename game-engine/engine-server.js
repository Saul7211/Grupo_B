import net from "net";
import crypto from "crypto";
import { createDeck, shuffle, deal, compareCards } from "./rules.js";
import { createBettingState, placeBet, resetBets } from "./apuestas.js";

const TCP_PORT = Number(process.env.TCP_PORT || 9000);
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 4);
const HAND_SIZE = Number(process.env.HAND_SIZE || 5);

const clients = new Map();

const game = {
	started: false,
	deck: [],
	discard: [],
	table: [],
	players: new Map(),
	order: [],
	turnIndex: 0,
	round: 0,
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

function listPlayers() {
	return game.order.map((id) => {
		const player = game.players.get(id);
		return {
			id,
			name: player?.name || "Anon",
			handCount: player?.hand?.length || 0,
			tricks: player?.tricks || 0,
			score: player?.score || 0,
		};
	});
}

function getPlayerView(viewerId) {
	const viewer = game.players.get(viewerId);
	return {
		type: "state",
		started: game.started,
		round: game.round,
		turnId: game.order[game.turnIndex] || null,
		players: listPlayers(),
		table: game.table,
		pot: game.betting.pot,
		bets: game.betting.bets,
		hand: viewer?.hand || [],
	};
}

function startGame() {
	if (game.players.size < 2) {
		throw new Error("Need at least 2 players to start");
	}
	game.started = true;
	game.round += 1;
	game.deck = shuffle(createDeck());
	game.discard = [];
	game.table = [];
	game.order = Array.from(game.players.keys());
	game.turnIndex = 0;
	resetBets(game.betting);

	for (const id of game.order) {
		const player = game.players.get(id);
		player.hand = deal(game.deck, HAND_SIZE);
		player.tricks = 0;
		player.score = 0;
	}
}

function finishRound(reason = "round_complete") {
	const scores = {};
	let winnerId = null;
	let bestScore = -Infinity;
	for (const [id, player] of game.players.entries()) {
		scores[id] = player.score;
		if (player.score > bestScore) {
			bestScore = player.score;
			winnerId = id;
		}
	}

	const verdict = {
		reason,
		winnerId,
		scores,
		pot: game.betting.pot,
	};

	broadcast({ type: "final", verdict });
	game.started = false;
	game.table = [];
}

function advanceTurn() {
	game.turnIndex = (game.turnIndex + 1) % game.order.length;
}

function resolveTrick() {
	let winning = game.table[0];
	for (const entry of game.table.slice(1)) {
		if (compareCards(entry.card, winning.card) > 0) {
			winning = entry;
		}
	}
	const winner = game.players.get(winning.playerId);
	if (winner) {
		winner.tricks += 1;
		winner.score += 1;
	}
	game.table = [];
	game.turnIndex = game.order.indexOf(winning.playerId);
}

function handlePlay(playerId, card) {
	if (!game.started) throw new Error("Game not started");
	if (game.order[game.turnIndex] !== playerId) {
		throw new Error("Not your turn");
	}
	const player = game.players.get(playerId);
	const cardIndex = player.hand.findIndex(
		(handCard) => handCard.suit === card?.suit && handCard.rank === card?.rank
	);
	if (cardIndex === -1) {
		throw new Error("Card not in hand");
	}

	const played = player.hand.splice(cardIndex, 1)[0];
	game.table.push({ playerId, card: played });

	if (game.table.length === game.order.length) {
		resolveTrick();
	} else {
		advanceTurn();
	}

	if (player.hand.length === 0 && game.deck.length === 0) {
		finishRound();
	}
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
	game.players.set(id, { id, name: "Anon", hand: [], tricks: 0, score: 0 });
	game.order = Array.from(game.players.keys());

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
		broadcast({ type: "player_left", id });
		if (game.started && game.players.size < 2) {
			finishRound("player_left");
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
			handlePlay(playerId, message.card);
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
