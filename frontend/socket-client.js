const socket = io("http://localhost:3000");
// Notificación de sala expirada
socket.on("sala_expirada", (data) => {
  alert(data.mensaje);
  // Si el usuario estaba en esa sala, limpiar y volver al lobby
  if (currentSessionId === data.sessionId) {
    localStorage.removeItem("currentSessionId");
    window.location.href = "lobby.html";
  }
});
// LOGOUT
document.addEventListener("DOMContentLoaded", () => {
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem("currentUser");
      localStorage.removeItem("currentSessionId");
      window.location.href = "login.html";
    });
  }
});


let currentUser = JSON.parse(localStorage.getItem("currentUser")) || null;
let currentSessionId = localStorage.getItem("currentSessionId") || null;
let selectedCard = null;
let selectedCaptureCards = [];
let playersMap = {};

const page = window.location.pathname.split("/").pop();

if ((page === "lobby.html" || page === "game.html") && !currentUser) {
  window.location.href = "login.html";
}

/* =========================
   ELEMENTOS GENERALES
========================= */

const statusText = document.getElementById("statusText");
const balanceText = document.getElementById("balanceText");

/* =========================
   LOGIN
========================= */

const loginBtn = document.getElementById("loginBtn");

if (loginBtn) {
  loginBtn.addEventListener("click", () => {
    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value.trim();

    if (!username || !password) {
      alert("Ingrese usuario y contraseña");
      return;
    }

    socket.emit("login_usuario", { username, password });
  });
}

socket.on("login_exitoso", (data) => {
  currentUser = data;
  localStorage.setItem("currentUser", JSON.stringify(data));
  window.location.href = "lobby.html";
});

/* =========================
   REGISTRO
========================= */

const registerBtn = document.getElementById("registerBtn");

if (registerBtn) {
  registerBtn.addEventListener("click", () => {
    const username = document.getElementById("registerUsername").value.trim();
    const password = document.getElementById("registerPassword").value.trim();

    if (!username || !password) {
      alert("Ingrese usuario y contraseña");
      return;
    }

    socket.emit("registrar_usuario", { username, password });
  });
}

socket.on("registro_exitoso", () => {
  alert("Usuario registrado correctamente");
  window.location.href = "login.html";
});

/* =========================
   CONEXIÓN
========================= */

socket.on("connect", () => {
  if (statusText) statusText.textContent = "Conectado";
});

socket.on("disconnect", () => {
  if (statusText) statusText.textContent = "Desconectado";
});

socket.on("error_notificacion", (message) => {
  alert(message);
});

/* =========================
   LOBBY
========================= */

const usernameText = document.getElementById("usernameText");
const rechargeBtn = document.getElementById("rechargeBtn");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomsList = document.getElementById("roomsList");

if (usernameText && currentUser) {
  usernameText.textContent = currentUser.username;
}

if (balanceText && currentUser) {
  balanceText.textContent = `$${Number(currentUser.balance).toFixed(2)}`;
}

if (rechargeBtn) {
  rechargeBtn.addEventListener("click", () => {
    const monto = Number(document.getElementById("rechargeInput").value);

    if (!monto || monto <= 0) {
      alert("Ingrese un monto válido");
      return;
    }

    socket.emit("recargar_saldo", {
      userId: currentUser.userId,
      monto
    });
  });
}

socket.on("saldo_recargado", (data) => {
  currentUser.balance = data.nuevoSaldo;
  localStorage.setItem("currentUser", JSON.stringify(currentUser));

  if (balanceText) {
    balanceText.textContent = `$${Number(data.nuevoSaldo).toFixed(2)}`;
  }

  alert("Saldo recargado correctamente");
});

if (createRoomBtn) {
  createRoomBtn.addEventListener("click", () => {
    const monto = Number(document.getElementById("betInput").value);

    if (!monto || monto <= 0) {
      alert("Ingrese una apuesta válida");
      return;
    }

    socket.emit("crear_partida", {
      userId: currentUser.userId,
      monto
    });
  });
}

socket.on("partida_creada", (data) => {
  currentSessionId = data.sessionId;
  localStorage.setItem("currentSessionId", data.sessionId);
  localStorage.removeItem("lastGameState");

  const roomCode = document.getElementById("createdRoomCode");
  const roomBox = document.getElementById("createdRoomBox");

  if (roomCode) roomCode.textContent = data.sessionId;
  if (roomBox) roomBox.classList.remove("hidden");

  alert(data.mensaje);
});

socket.on("nueva_sala_disponible", (room) => {
  if (!roomsList) return;

  const emptyMessage = roomsList.querySelector(".empty-message");

  if (emptyMessage) {
    roomsList.innerHTML = "";
  }

  const item = document.createElement("div");
  item.className = "room-item";

  item.innerHTML = `
    <div>
      <strong>Código de sala</strong>
      <p>${room.sessionId}</p>
      <span>Apuesta: $${Number(room.monto).toFixed(2)}</span>
    </div>
    <button class="primary-btn">Unirse</button>
  `;

  item.querySelector("button").addEventListener("click", () => {
    joinRoom(room.sessionId);
  });

  roomsList.appendChild(item);
});

if (joinRoomBtn) {
  joinRoomBtn.addEventListener("click", () => {
    const sessionId = document.getElementById("joinCodeInput").value.trim();

    if (!sessionId) {
      alert("Ingrese el código de la sala");
      return;
    }

    joinRoom(sessionId);
  });
}

function joinRoom(sessionId) {
  socket.emit("aceptar_partida", {
    userId: currentUser.userId,
    sessionId
  });
}


// Solo la cuenta que recibe 'unido_a_sala' o 'juego_iniciado' debe cambiar de vista
socket.on("unido_a_sala", (data) => {
  currentSessionId = data.sessionId;
  localStorage.setItem("currentSessionId", data.sessionId);
  // Espera a que se inicie la partida para ir a game.html
  alert(data.mensaje);
});

socket.on("juego_iniciado", (data) => {
  currentSessionId = data.sessionId;
  localStorage.setItem("currentSessionId", data.sessionId);
  localStorage.removeItem("lastGameState");

  alert(data.mensaje);

  setTimeout(() => {
    window.location.href = "game.html";
  }, 800);
});

/* =========================
   GAME.HTML
========================= */

const potText = document.getElementById("potText");
const turnText = document.getElementById("turnText");
const tableCards = document.getElementById("tableCards");
const deckCount = document.getElementById("deckCount");
const teamAScore = document.getElementById("teamAScore");
const teamBScore = document.getElementById("teamBScore");

const player1Name = document.getElementById("player1Name");
const player1Cards = document.getElementById("player1Cards");
const player2Cards = document.getElementById("player2Cards");
const player3Cards = document.getElementById("player3Cards");
const player4Cards = document.getElementById("player4Cards");

const player2CardCount = document.getElementById("player2CardCount");
const player3CardCount = document.getElementById("player3CardCount");
const player4CardCount = document.getElementById("player4CardCount");

const playCardBtn = document.getElementById("playCardBtn");
const leaveRoomBtn = document.getElementById("leaveRoomBtn");

if (page === "game.html" && currentUser) {
  if (player1Name) {
    player1Name.textContent = `${currentUser.username} - Tus cartas`;
  }

  if (statusText) {
    statusText.textContent = `Conectado: ${currentUser.username}`;
  }

  if (balanceText) {
    balanceText.textContent = `$${Number(currentUser.balance).toFixed(2)}`;
  }
}

socket.on("evento_motor", (event) => {
  console.log("Evento del motor:", event);

  if (event.sessionId) {
    localStorage.setItem("currentSessionId", event.sessionId);
  }

  if (
    event.action === "GAME_STARTED" ||
    event.action === "STATE_UPDATE" ||
    event.action === "FINAL"
  ) {
    localStorage.setItem("lastGameState", JSON.stringify(event));
    renderGameState(event);
  }

  if (event.action === "FINAL") {
    alert(`Juego finalizado. Ganador: Equipo ${event.verdict?.winnerTeam}`);
  }

  if (event.action === "ERROR") {
    alert(event.message);
  }
});

/* ======================
   RECUPERAR ESTADO
====================== */

if (page === "game.html") {

  const lastGameState = localStorage.getItem("lastGameState");

  if (lastGameState) {

    const parsedState = JSON.parse(lastGameState);

    if (parsedState.sessionId === currentSessionId) {
      renderGameState(parsedState);
    } else {
      localStorage.removeItem("lastGameState");

      if (statusText) {
        statusText.textContent = "Esperando estado del motor...";
      }
    }

  } else {

    if (statusText) {
      statusText.textContent = "Esperando estado del motor...";
    }

  }

}

function renderGameState(event) {
  const state = event.state;
  if (!state) return;

  if (potText) {
    potText.textContent = `$${Number(state.pot || 0).toFixed(2)}`;
  }
  if (turnText) {
    turnText.textContent = getTurnText(state.turnId, state.players || []);
  }
  if (teamAScore) {
    teamAScore.textContent = state.teamScores?.A ?? 0;
  }
  if (teamBScore) {
    teamBScore.textContent = state.teamScores?.B ?? 0;
  }
  if (deckCount) {
    deckCount.textContent = state.players
      ? Math.max(0, 40 - state.players.reduce((total, p) => total + p.handCount + p.capturedCount, 0) - state.table.length)
      : 0;
  }

  // Mostrar nombres y equipos correctamente
  if (state.players && event.jugadoresNombres) {
    // Mapear ids a nombres
    const idToName = event.jugadoresNombres;
    const myIndex = state.players.findIndex(p => p.id === currentUser.userId);
    // Ordenar los jugadores desde el punto de vista del usuario actual
    const ordered = [];
    for (let i = 0; i < 4; i++) {
      ordered.push(state.players[(myIndex + i) % 4]);
    }
    // Asignar nombres y equipos
    if (player1Name && ordered[0]) player1Name.textContent = `${idToName[ordered[0].id] || 'Tú'} - Tus cartas`;
    if (player2Name && ordered[1]) player2Name.textContent = idToName[ordered[1].id] || 'Jugador 2';
    if (player3Name && ordered[2]) player3Name.textContent = idToName[ordered[2].id] || 'Jugador 3';
    if (player4Name && ordered[3]) player4Name.textContent = idToName[ordered[3].id] || 'Jugador 4';
  }

  renderTableCards(state.table || []);
  renderPlayerCounts(state.players || []);

  if (event.hands && currentUser) {
    const myHand = event.hands[currentUser.userId] || [];
    renderMyHand(myHand);
  }
}

function getTurnText(turnId, players) {
  if (!turnId) return "Esperando...";

  if (currentUser && turnId === currentUser.userId) {
    return "Es tu turno";
  }

  const playerIndex = players.findIndex(player => player.id === turnId);

  if (playerIndex !== -1) {
    return `Jugador ${playerIndex + 1}`;
  }

  return "Jugador en turno";
}

function renderPlayerCounts(players) {
  const otherPlayers = players.filter(player => player.id !== currentUser?.userId);

  if (player2CardCount && otherPlayers[0]) {
    player2CardCount.textContent = otherPlayers[0].handCount;
    renderBackCards(player2Cards, otherPlayers[0].handCount, "vertical");
  }

  if (player3CardCount && otherPlayers[1]) {
    player3CardCount.textContent = otherPlayers[1].handCount;
    renderBackCards(player3Cards, otherPlayers[1].handCount, "horizontal");
  }

  if (player4CardCount && otherPlayers[2]) {
    player4CardCount.textContent = otherPlayers[2].handCount;
    renderBackCards(player4Cards, otherPlayers[2].handCount, "vertical");
  }
}

function renderBackCards(container, count) {
  if (!container) return;

  container.innerHTML = "";

  for (let i = 0; i < count; i++) {
    const card = document.createElement("div");
    card.className = "card back";
    container.appendChild(card);
  }
}

function renderTableCards(cards) {
  if (!tableCards) return;

  tableCards.innerHTML = "";
  selectedCaptureCards = [];

  cards.forEach(card => {
    const element = createCardElement(card, false);

    element.addEventListener("click", () => {
      const exists = selectedCaptureCards.some(c => c.id === card.id);

      if (exists) {
        selectedCaptureCards = selectedCaptureCards.filter(c => c.id !== card.id);
        element.classList.remove("selected");
      } else {
        selectedCaptureCards.push(card);
        element.classList.add("selected");
      }
    });

    tableCards.appendChild(element);
  });

  const empty = document.createElement("div");
  empty.className = "card empty";
  empty.textContent = "+";
  tableCards.appendChild(empty);
}

function renderMyHand(cards) {
  if (!player1Cards) return;

  player1Cards.innerHTML = "";
  selectedCard = null;

  if (!cards || cards.length === 0) {
    player1Cards.innerHTML = `<div class="card empty">Sin cartas</div>`;
    return;
  }

  cards.forEach(card => {
    const button = createCardElement(card, true);

    button.addEventListener("click", () => {
      selectedCard = card;

      document.querySelectorAll("#player1Cards .card").forEach(c => {
        c.classList.remove("selected");
      });

      button.classList.add("selected");
    });

    player1Cards.appendChild(button);
  });
}

function createCardElement(card, isButton) {
  const element = document.createElement(isButton ? "button" : "div");
  element.className = "card";

  element.innerHTML = `
    ${card.rank}
    <span>${formatSuit(card.suit)}</span>
  `;

  return element;
}

function formatSuit(suit) {
  if (!suit) return "";

  if (suit.includes("corazones")) return "♥";
  if (suit.includes("diamantes")) return "♦";
  if (suit.includes("treboles")) return "♣";
  if (suit.includes("picas")) return "♠";

  return suit;
}

if (playCardBtn) {
  playCardBtn.addEventListener("click", () => {
    console.log("BOTÓN JUGAR PRESIONADO");

    if (!currentUser) {
      alert("No hay usuario autenticado");
      return;
    }

    if (!currentSessionId) {
      alert("No hay partida activa");
      return;
    }

    if (!selectedCard) {
      alert("Selecciona una carta de tu mano");
      return;
    }

    const jugada = {
      userId: currentUser.userId,
      sessionId: currentSessionId,
      card: {
        id: selectedCard.id
      },
      capture: selectedCaptureCards.map(card => card.id)
    };

    console.log("JUGADA ENVIADA AL BACKEND:", jugada);

    socket.emit("jugar_carta", jugada);
  });
}

if (leaveRoomBtn) {
  leaveRoomBtn.addEventListener("click", () => {
    localStorage.removeItem("currentSessionId");
    window.location.href = "lobby.html";
  });
}

/* =========================
   FUNCIONES PARA CONSOLA
========================= */

window.registrar = (username, password) => socket.emit("registrar_usuario", { username, password });
window.login = (username, password) => socket.emit("login_usuario", { username, password });
window.recargarSaldo = (monto) => socket.emit("recargar_saldo", { userId: currentUser.userId, monto });
window.crearPartida = (monto) => socket.emit("crear_partida", { userId: currentUser.userId, monto });
window.aceptarPartida = joinRoom;