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
	// Agrupar cartas capturadas por equipo
	const teamCapturedCards = { A: [], B: [] };
	for (const id of session.order) {
		const player = session.players.get(id);
		const team = player.team;
		if (player.captured && player.captured.length > 0) {
			teamCapturedCards[team].push(...player.captured);
		}
	}

	return {
		started: session.started,
		round: session.round,
		dealerId: session.order[session.dealerIndex] || null,
		turnId: session.order[session.turnIndex] || null,
		players: listPlayers(session),
		table: session.table,
		teamScores: session.teamScores,
		teamCapturedCount: session.teamCapturedCount,
		teamCaidaCount: session.teamCaidaCount,
		teamCapturedCards: teamCapturedCards,
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
	// Verificar si algún equipo llegó a 40 puntos
	if (session.teamScores.A >= POINTS_TO_WIN || session.teamScores.B >= POINTS_TO_WIN) {
		const winnerTeam = session.teamScores.A >= POINTS_TO_WIN ? "A" : "B";
		const loserTeam = winnerTeam === "A" ? "B" : "A";
		
		// Registrar evento de victoria
		session.events.push({
			type: "game_end",
			winnerTeam,
			reason: "40_points_reached",
			winnerScore: session.teamScores[winnerTeam],
			loserScore: session.teamScores[loserTeam],
			message: `🏆 ¡EQUIPO ${winnerTeam} GANA! Llegó a ${session.teamScores[winnerTeam]} puntos`
		});
		
		return endRound(session, "chica", winnerTeam);
	}
	return null;
}

function resetRoundState(session) {
	session.deck = shuffle(createDeck());
	session.table = [];
	session.lastPlay = null;
	session.lastPlayedCard = null;
	session.lastPlayerId = null;
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
		lastPlayedCard: null,
		lastPlayerId: null,
		teamScores: { A: 0, B: 0 },
		teamCapturedCount: { A: 0, B: 0 },
		teamCaidaCount: { A: 0, B: 0 },
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

function hasPossibleEscalera(playedCard, tableCards) {
	// Verificar si existe una escalera posible desde la carta jugada en adelante
	const playedIndex = rankIndex(playedCard.rank);
	const tableRanks = tableCards.map(card => card.rank);
	
	// Necesita al menos contener la carta jugada
	if (!tableRanks.includes(playedCard.rank)) {
		return false;
	}
	
	// Intentar encontrar una escalera desde la carta jugada
	for (let highestIdx = playedIndex; highestIdx < RANKS.length; highestIdx++) {
		let hasAll = true;
		for (let idx = playedIndex; idx <= highestIdx; idx++) {
			if (!tableRanks.includes(RANKS[idx])) {
				hasAll = false;
				break;
			}
		}
		if (hasAll) {
			return true; // Encontrada una escalera válida
		}
	}
	return false;
}

function hasPossibleFigureEscalera(playedCard, tableCards) {
	// Para figuras (J, Q, K)
	const figures = { "J": 0, "Q": 1, "K": 2 };
	const playedIndex = figures[playedCard.rank];
	const tableRanks = new Set(tableCards.map(card => card.rank));
	
	// Verificar si hay una escalera desde la carta jugada en adelante
	const figureRanks = ["J", "Q", "K"];
	for (let i = playedIndex; i < figureRanks.length; i++) {
		if (!tableRanks.has(figureRanks[i])) {
			return false;
		}
	}
	return true;
}

function hasAnyCapture(session, playedCard) {
	const isFigure = !isNumberRank(playedCard.rank);
	
	if (isFigure) {
		// Para figuras (J, Q, K): solo escalera
		return hasPossibleFigureEscalera(playedCard, session.table);
	} else {
		// Para números: puede ser escalera o suma
		// Verificar escalera
		if (hasPossibleEscalera(playedCard, session.table)) {
			return true;
		}
		// Verificar suma (solo con números)
		const target = rankValue(playedCard.rank);
		const numberCards = session.table.filter(card => isNumberRank(card.rank));
		const values = numberCards.map((card) => rankValue(card.rank));
		return hasSubsetSum(values, target);
	}
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

// Nueva función para validar escaleras para números (A-7)
function isNumberRank(rank) {
	return rankIndex(rank) < 7; // A,2,3,4,5,6,7 son índices 0-6, J,Q,K son 7,8,9
}

// Función para validar escalera de números
function validateNumberEscalera(playedCard, selectedCards) {
	const selectedRanks = selectedCards.map((card) => card.rank);
	const playedIndex = rankIndex(playedCard.rank);
	
	// Verificar que todos sean números
	if (!selectedRanks.every(rank => isNumberRank(rank))) {
		throw new Error("Escalera must contain only number ranks");
	}
	
	// Verificar sin duplicados
	const uniqueRanks = new Set(selectedRanks);
	if (uniqueRanks.size !== selectedRanks.length) {
		throw new Error("Escalera cannot repeat ranks");
	}
	
	// La carta jugada debe estar en las seleccionadas
	if (!selectedRanks.includes(playedCard.rank)) {
		throw new Error("Played card must be in the escalera");
	}
	
	// Encontrar la secuencia continua que incluya la carta jugada
	const sortedIndices = selectedRanks.map(rank => rankIndex(rank)).sort((a, b) => a - b);
	
	// Verificar que sea una secuencia continua
	for (let i = 0; i < sortedIndices.length - 1; i++) {
		if (sortedIndices[i + 1] - sortedIndices[i] !== 1) {
			throw new Error("Escalera must be consecutive without gaps");
		}
	}
	
	// Verificar que la carta jugada sea la más baja de la secuencia (no incluir menores)
	const lowestIndex = Math.min(...sortedIndices);
	if (playedIndex > lowestIndex) {
		throw new Error("Can only capture from played card onwards");
	}
}

// Nueva función para validar J,Q,K escalera
function validateFigureEscalera(playedCard, selectedCards) {
	const figures = { "J": 0, "Q": 1, "K": 2 };
	const selectedRanks = selectedCards.map((card) => card.rank);
	const playedIndex = figures[playedCard.rank];
	
	// Verificar que todos sean figuras
	if (!selectedRanks.every(rank => rank in figures)) {
		throw new Error("Figure escalera must contain only J, Q, K");
	}
	
	// Verificar sin duplicados
	const uniqueRanks = new Set(selectedRanks);
	if (uniqueRanks.size !== selectedRanks.length) {
		throw new Error("Escalera cannot repeat ranks");
	}
	
	// Convertir a índices
	const selectedIndices = selectedRanks.map(rank => figures[rank]).sort((a, b) => a - b);
	
	// Verificar continuidad desde la carta jugada en adelante
	for (let i = 0; i < selectedIndices.length - 1; i++) {
		if (selectedIndices[i + 1] - selectedIndices[i] !== 1) {
			throw new Error("Figure escalera must be consecutive (J-Q-K)");
		}
	}
	
	// Verificar que la carta jugada sea la más baja de la secuencia
	const lowestIndex = selectedIndices[0];
	if (playedIndex > lowestIndex) {
		throw new Error("Can only capture figures from played card onwards");
	}
}

function validateCaptureSelection(session, playedCard, selectedCards) {
	if (selectedCards.length === 0) {
		if (hasAnyCapture(session, playedCard)) {
			throw new Error("Capture required");
		}
		return { type: "none" };
	}

	// Validar que todas las cartas seleccionadas existan en la mesa
	for (const selected of selectedCards) {
		const exists = session.table.some(card => card.id === selected.id);
		if (!exists) {
			throw new Error("Invalid card selection - card not on table");
		}
	}

	const playedRank = playedCard.rank;
	const isFigure = !isNumberRank(playedRank); // J, Q, K
	
	// CASO 1: Figuras (J, Q, K) - Solo escalera
	if (isFigure) {
		validateFigureEscalera(playedCard, selectedCards);
		return { type: "escalera_figure" };
	}
	
	// CASO 2: Números - Puede ser suma O escalera
	const hasEqual = selectedCards.some((card) => card.rank === playedCard.rank);
	
	// CASO 2A: Captura por escalera (desde la carta jugada en adelante)
	if (hasEqual) {
		validateNumberEscalera(playedCard, selectedCards);
		return { type: "escalera_number" };
	}
	
	// CASO 2B: Captura por suma (números solamente)
	const total = selectedCards.reduce((sum, card) => {
		// Solo contar números en la suma, no figuras
		if (isNumberRank(card.rank)) {
			return sum + rankValue(card.rank);
		}
		return sum;
	}, 0);
	
	if (total !== rankValue(playedCard.rank)) {
		throw new Error("Sum capture does not match played card value");
	}
	
	// Verificar que no haya figuras en una captura por suma
	if (selectedCards.some(card => !isNumberRank(card.rank))) {
		throw new Error("Cannot mix numbers and figures in sum capture");
	}
	
	return { type: "sum" };
}

function removeCardsFromTable(session, cardIds) {
	const idSet = new Set(cardIds);
	session.table = session.table.filter((card) => !idSet.has(card.id));
}

function applyCapture(session, player, playedCard, selectedCards) {
	// Remover las cartas capturadas de la mesa
	removeCardsFromTable(session, selectedCards.map((card) => card.id));
	
	// Las cartas capturadas van al "cartón" del equipo
	// Incluye: cartas de la mesa seleccionadas + carta jugada
	const capturedCards = [...selectedCards, playedCard];
	player.captured.push(...capturedCards);
	player.hasCaptured = true;
	
	// Sumar al conteo de cartas capturadas del equipo (para el cartón)
	session.teamCapturedCount[player.team] += capturedCards.length;
	
	const limpia = session.table.length === 0;
	let caida = false;
	let verdict = null;

	// CAÍDA: Todas las cartas capturadas son del mismo rango que la jugada
	// Casos:
	// ✓ Captura por igualdad: Juego 5, captura dos 5s de mesa → CAÍDA
	// ✗ Captura por suma: Juego 5, captura 2+3 (suma 5) → NO es caída, es suma
	const allSameRank = selectedCards.length > 0 && selectedCards.every(card => card.rank === playedCard.rank);
	if (allSameRank) {
		caida = true;
	}

	// Calcular puntos según el tipo de captura
	// NOTA: La caída ahora SOLO se valida si el SIGUIENTE jugador juega la misma carta
	// Ver handlePlay para la lógica de caída.
	if (limpia) {
		// LIMPIA (sin caída): Puede ser captura por suma o igualdad, pero mesa queda vacía
		verdict = awardPoints(session, player.team, RULES.limpiaPoints, "limpia");
	}

	return { caida, limpia, verdict };
}

function finishCarton(session) {
	const cardsA = session.teamCapturedCount.A;
	const cardsB = session.teamCapturedCount.B;
	
	// REGLA: Si un equipo no capturó ninguna carta, el otro equipo gana 2 puntos (falla)
	if (cardsA === 0 || cardsB === 0) {
		const winningTeam = cardsA === 0 ? "B" : "A";
		awardPoints(session, winningTeam, RULES.fallaPoints, "falla");
	}

	// REGLA: Si ambos equipos tienen igual cantidad de cartas y <= 20, el próximo dealer gana 2 puntos
	if (cardsA === cardsB && cardsA <= 20) {
		const nextDealerIndex = (session.dealerIndex + 1) % session.order.length;
		const nextDealerId = session.order[nextDealerIndex];
		const nextTeam = getTeamForPlayer(session, nextDealerId);
		awardPoints(session, nextTeam, 2, "dos_por_dar");
		return;
	}

	// REGLA DEL CARTÓN (CORREGIDA):
	// Si tienes menos de 20 cartas: 0 puntos
	// Si tienes 20+ cartas: 6 puntos base + 2 por cada carta adicional después de 20
	// Ejemplos:
	//   20 cartas = 6 puntos
	//   21 cartas = 8 puntos (6 + 2)
	//   22 cartas = 10 puntos (6 + 4)
	//   23 cartas = 12 puntos (6 + 6)
	function cartonPoints(cards) {
		if (cards < 20) return 0;
		// A partir de 20 cartas: 6 + 2*(cartas - 20)
		return 6 + 2 * (cards - 20);
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
	const loserTeam = winnerTeam === "A" ? "B" : "A";
	const loserIds = session.order.filter((id) => getTeamForPlayer(session, id) === loserTeam);
	
	// Crear mensaje de victoria personalizado
	let victoryMessage = "";
	if (reason === "chica") {
		// Victoria por llegar a 40 puntos
		victoryMessage = `🏆 ¡EQUIPO ${winnerTeam} HA GANADO LA PARTIDA!\n\n` +
			`Equipo ${winnerTeam}: ${session.teamScores[winnerTeam]} puntos\n` +
			`Equipo ${loserTeam}: ${session.teamScores[loserTeam]} puntos\n\n` +
			`Cartas capturadas:\n` +
			`Equipo ${winnerTeam}: ${session.teamCapturedCount[winnerTeam]} cartas\n` +
			`Equipo ${loserTeam}: ${session.teamCapturedCount[loserTeam]} cartas`;
	}
	
	const verdict = {
		reason,
		winnerTeam,
		winnerIds,
		winnerId: winnerIds[0] || null,
		loserTeam,
		loserIds,
		round: session.round,
		teamScores: session.teamScores,
		teamCapturedCount: session.teamCapturedCount,
		events: session.events,
		pot: session.betting.pot,
		victoryMessage: victoryMessage
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
	let caidaDetected = false;
	
	if (validation.type === "none") {
		session.table.push(played);
		session.lastPlay = { playerId, cardId: played.id, rank: played.rank };
		session.lastPlayedCard = played.rank;
		session.lastPlayerId = playerId;
	} else {
		// VERIFICAR CAÍDA: El jugador anterior jugó la misma carta
		// Una caída es válida SOLO si:
		// 1. El jugador anterior jugó una carta
		// 2. El jugador actual juega la MISMA carta
		// 3. Todas las cartas capturadas son del mismo rango
		const previousPlayerCard = session.lastPlayedCard;
		const allSameRank = selectedCards.length > 0 && selectedCards.every(card => card.rank === played.rank);
		
		if (previousPlayerCard === played.rank && allSameRank && session.lastPlayerId) {
			// CAÍDA DETECTADA
			caidaDetected = true;
			session.teamCaidaCount[player.team]++;
			
			// Asignar puntos por caída
			if (selectedCards.length > 0) {
				const limpia = session.table.length === selectedCards.length; // Mesa queda vacía después de captura
				if (limpia) {
					verdict = awardPoints(session, player.team, RULES.caidaYLimpiaPoints, "caida_y_limpia");
				} else {
					verdict = awardPoints(session, player.team, RULES.caidaPoints, "caida");
				}
			}
		}
		
		const captureResult = applyCapture(session, player, played, selectedCards);
		verdict = verdict || captureResult.verdict;
		session.lastPlay = null;
		session.lastPlayedCard = null;
		session.lastPlayerId = null;
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
