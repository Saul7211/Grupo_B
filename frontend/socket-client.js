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
let isMyTurn = false;
let previousTeamStats = { A: { cartón: 0, perros: 0 }, B: { cartón: 0, perros: 0 } };
let disconnectionTimeout = null;
let disconnectionCountdown = null;

// Valores de cartas para cálculo de suma
const CARD_VALUES = {
  'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, 'J': 8, 'Q': 9, 'K': 10
};

// Sonido de notificación para turno
const turnNotificationAudio = new Audio('data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA==');

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

    // Enviar sessionId si existe (para reconectar a partida en progreso)
    socket.emit("login_usuario", { 
      username, 
      password,
      sessionId: currentSessionId || null
    });
  });
}

socket.on("login_exitoso", (data) => {
  currentUser = data;
  localStorage.setItem("currentUser", JSON.stringify(data));
  
  // Si tenía una sessionId guardada, intentar reconectar a esa sesión
  if (currentSessionId) {
    // Enviar login con sessionId para reconectar
    console.log("Intentando reconectar a sesión:", currentSessionId);
  }
  
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
  
  // Si había una sesión en progreso, pedir actualización del estado
  if (currentSessionId && currentUser && page === "game.html") {
    console.log("Reconectando a sesión en progreso:", currentSessionId);
    // El servidor enviará el estado automáticamente
  }
});

socket.on("disconnect", () => {
  if (statusText) statusText.textContent = "Desconectado";
  console.warn("Conexión perdida con el servidor");
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

// ═════════════════════════════════════════════════════════════════
// EVENTOS DE DESCONEXIÓN Y RECONEXIÓN
// ═════════════════════════════════════════════════════════════════

/**
 * Maneja desconexión de otro jugador
 */
socket.on("jugador_desconectado", (data) => {
  console.warn(`⚠️ [DESCONEXIÓN] ${data.mensaje}`);
  
  const notification = document.createElement("div");
  notification.className = "disconnection-warning";
  notification.innerHTML = `
    <strong>⚠️ Jugador desconectado</strong>
    <p>${data.mensaje}</p>
    <p>Esperando reconexión... <span id="countdownTimer">40</span>s</p>
  `;
  
  document.body.appendChild(notification);
  
  // Mostrar countdown
  let timeLeft = 40;
  const timerEl = document.getElementById("countdownTimer");
  
  disconnectionCountdown = setInterval(() => {
    timeLeft--;
    if (timerEl) timerEl.textContent = timeLeft;
    
    if (timeLeft <= 0) {
      clearInterval(disconnectionCountdown);
    }
  }, 1000);
});

/**
 * Maneja reconexión exitosa
 */
socket.on("jugador_reconectado", (data) => {
  console.log(`✅ [RECONEXIÓN] ${data.mensaje}`);
  
  // Limpiar countdown
  if (disconnectionCountdown) {
    clearInterval(disconnectionCountdown);
  }
  
  // Remover notificaciones de desconexión
  const warnings = document.querySelectorAll(".disconnection-warning");
  warnings.forEach(w => {
    w.style.animation = "slide-down 0.4s ease-out reverse";
    setTimeout(() => w.remove(), 400);
  });
  
  // Mostrar notificación de éxito
  const successNotif = document.createElement("div");
  successNotif.className = "reconnection-success";
  successNotif.textContent = "✅ Jugador reconectado";
  document.body.appendChild(successNotif);
  
  setTimeout(() => {
    successNotif.style.animation = "slide-down 0.4s ease-out reverse";
    setTimeout(() => successNotif.remove(), 400);
  }, 2000);
});

/**
 * Maneja cierre de sesión por timeout
 */
socket.on("sesion_cerrada", (data) => {
  console.error(`🔴 [SESIÓN CERRADA] ${data.razón}`);
  
  // Limpiar countdown
  if (disconnectionCountdown) {
    clearInterval(disconnectionCountdown);
  }
  
  // Limpiar datos de sesión
  localStorage.removeItem("currentSessionId");
  localStorage.removeItem("lastGameState");
  
  alert(`La partida ha finalizado\n${data.razón}\n${data.mensaje}`);
  
  // Redirigir al lobby
  setTimeout(() => {
    window.location.href = "lobby.html";
  }, 500);
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
const teamAPerros = document.getElementById("teamAPerros");
const teamBPerros = document.getElementById("teamBPerros");

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

// ═════════════════════════════════════════════════════════════════
// MODAL DE VICTORIA
// ═════════════════════════════════════════════════════════════════

/**
 * Muestra un modal elegante cuando un equipo llega a 40 puntos y gana
 */
function showVictoryModal(message, verdict) {
  // Crear overlay
  const overlay = document.createElement("div");
  overlay.className = "victory-overlay";
  
  // Crear modal
  const modal = document.createElement("div");
  modal.className = `victory-modal team-${verdict?.winnerTeam}`;
  
  const teamColor = verdict?.winnerTeam === "A" ? "🔵 Equipo A" : "🔴 Equipo B";
  const teamEmoji = verdict?.winnerTeam === "A" ? "🔵" : "🔴";
  
  modal.innerHTML = `
    <div class="victory-header">
      <h1>${teamEmoji} ¡VICTORIA! ${teamEmoji}</h1>
      <p class="team-name">${teamColor}</p>
    </div>
    
    <div class="victory-stats">
      <div class="stat-box">
        <span class="stat-label">PUNTOS EQUIPO ${verdict?.winnerTeam}</span>
        <strong class="stat-value winner">${verdict?.teamScores[verdict?.winnerTeam]}</strong>
      </div>
      
      <div class="stat-box">
        <span class="stat-label">PUNTOS EQUIPO ${verdict?.winnerTeam === "A" ? "B" : "A"}</span>
        <strong class="stat-value loser">${verdict?.teamScores[verdict?.winnerTeam === "A" ? "B" : "A"]}</strong>
      </div>
    </div>
    
    <div class="victory-details">
      <div class="detail-row">
        <span>Cartas Equipo ${verdict?.winnerTeam}:</span>
        <strong>${verdict?.teamCapturedCount[verdict?.winnerTeam]}</strong>
      </div>
      <div class="detail-row">
        <span>Cartas Equipo ${verdict?.winnerTeam === "A" ? "B" : "A"}:</span>
        <strong>${verdict?.teamCapturedCount[verdict?.winnerTeam === "A" ? "B" : "A"]}</strong>
      </div>
      <div class="detail-row">
        <span>Ronda:</span>
        <strong>${verdict?.round}</strong>
      </div>
      <div class="detail-row">
        <span>Pozo Total:</span>
        <strong>$${Number(verdict?.pot || 0).toFixed(2)}</strong>
      </div>
    </div>
    
    <button class="victory-btn" onclick="location.href='lobby.html'">
      Volver al Lobby
    </button>
  `;
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  // Animación de entrada
  setTimeout(() => {
    overlay.classList.add("show");
  }, 100);
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
    // Mostrar mensaje de victoria mejorado
    const verdict = event.verdict;
    const victoryMessage = verdict?.victoryMessage || 
      `Juego finalizado. Ganador: Equipo ${verdict?.winnerTeam}`;
    
    // Crear modal elegante de victoria
    showVictoryModal(victoryMessage, verdict);
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

  // Verificar si es el turno del usuario
  const wasMyTurn = isMyTurn;
  isMyTurn = state.turnId === currentUser?.userId;
  
  // Si es el turno del usuario AHORA, mostrar notificación
  if (isMyTurn && !wasMyTurn) {
    showTurnNotification();
  }

  if (potText) {
    potText.textContent = `$${Number(state.pot || 0).toFixed(2)}`;
  }
  
  if (turnText) {
    const turnText_elem = document.getElementById("turnText");
    if (turnText_elem) {
      const turnTextContent = getTurnText(state.turnId, state.players || []);
      turnText_elem.textContent = turnTextContent;
      
      // Agregar clase de animación si es mi turno
      if (isMyTurn) {
        turnText_elem.classList.add("turn-indicator");
        setTimeout(() => turnText_elem.classList.remove("turn-indicator"), 500);
      }
    }
  }
  
  // ACTUALIZAR CARTÓN Y PERROS CON ANIMACIÓN
  if (teamAScore) {
    const currentScore = state.teamScores?.A ?? 0;
    teamAScore.textContent = currentScore;
    
    // Animar si cambió
    if (currentScore !== previousTeamStats.A.cartón) {
      teamAScore.classList.add("update-flash");
      setTimeout(() => teamAScore.classList.remove("update-flash"), 600);
      previousTeamStats.A.cartón = currentScore;
    }
  }
  
  if (teamBScore) {
    const currentScore = state.teamScores?.B ?? 0;
    teamBScore.textContent = currentScore;
    
    // Animar si cambió
    if (currentScore !== previousTeamStats.B.cartón) {
      teamBScore.classList.add("update-flash");
      setTimeout(() => teamBScore.classList.remove("update-flash"), 600);
      previousTeamStats.B.cartón = currentScore;
    }
  }
  
  // ACTUALIZAR PERROS (cartas capturadas)
  if (teamAPerros) {
    const currentPerros = state.teamCapturedCount?.A ?? 0;
    teamAPerros.textContent = currentPerros;
    
    // Animar si cambió
    if (currentPerros !== previousTeamStats.A.perros) {
      teamAPerros.classList.add("update-flash");
      setTimeout(() => teamAPerros.classList.remove("update-flash"), 600);
      previousTeamStats.A.perros = currentPerros;
    }
  }
  
  if (teamBPerros) {
    const currentPerros = state.teamCapturedCount?.B ?? 0;
    teamBPerros.textContent = currentPerros;
    
    // Animar si cambió
    if (currentPerros !== previousTeamStats.B.perros) {
      teamBPerros.classList.add("update-flash");
      setTimeout(() => teamBPerros.classList.remove("update-flash"), 600);
      previousTeamStats.B.perros = currentPerros;
    }
  }
  
  if (deckCount) {
    deckCount.textContent = state.players
      ? Math.max(0, 40 - state.players.reduce((total, p) => total + p.handCount + p.capturedCount, 0) - state.table.length)
      : 0;
  }

  // Mostrar nombres, equipos y cartas correctamente
  if (state.players && event.jugadoresNombres) {
    // Mapear ids a nombres y equipos
    const idToName = event.jugadoresNombres;
    const myIndex = state.players.findIndex(p => p.id === currentUser.userId);
    // Ordenar los jugadores desde el punto de vista del usuario actual
    const ordered = [];
    for (let i = 0; i < 4; i++) {
      ordered.push(state.players[(myIndex + i) % 4]);
    }
    // Asignar nombres, equipos y actualizar UI
    if (player1Name && ordered[0]) {
      player1Name.textContent = `${idToName[ordered[0].id] || 'Tú'} - Tus cartas`;
      const p1TeamEl = player1Name.nextElementSibling;
      if (p1TeamEl) p1TeamEl.textContent = `Equipo ${ordered[0].team}`;
    }
    if (player2Name && ordered[1]) {
      player2Name.textContent = idToName[ordered[1].id] || 'Jugador 2';
      const p2TeamEl = player2Name.nextElementSibling;
      if (p2TeamEl) p2TeamEl.textContent = `Equipo ${ordered[1].team}`;
    }
    if (player3Name && ordered[2]) {
      player3Name.textContent = idToName[ordered[2].id] || 'Jugador 3';
      const p3TeamEl = player3Name.nextElementSibling;
      if (p3TeamEl) p3TeamEl.textContent = `Equipo ${ordered[2].team} - Compañero`;
    }
    if (player4Name && ordered[3]) {
      player4Name.textContent = idToName[ordered[3].id] || 'Jugador 4';
      const p4TeamEl = player4Name.nextElementSibling;
      if (p4TeamEl) p4TeamEl.textContent = `Equipo ${ordered[3].team}`;
    }
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

// Función para mostrar notificación cuando es el turno del usuario
function showTurnNotification() {
  // Reproducir sonido
  try {
    turnNotificationAudio.play().catch(() => {});
  } catch (e) {
    console.log("No se pudo reproducir sonido");
  }

  // Notificación del navegador (si está permitida)
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("¡Es tu turno!", {
      body: "Juega una carta",
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text x='50' y='50' font-size='50' text-anchor='middle' dy='0.3em'>🃏</text></svg>"
    });
  }

  // Banner visual
  const banner = document.createElement("div");
  banner.className = "your-turn-banner";
  banner.textContent = "🎮 ¡ES TU TURNO! Juega una carta";
  
  const gameTable = document.querySelector(".game-table");
  if (gameTable) {
    gameTable.insertBefore(banner, gameTable.firstChild);
    
    // Remover el banner después de 3 segundos
    setTimeout(() => {
      banner.style.animation = "turn-slide 0.4s ease-in reverse";
      setTimeout(() => banner.remove(), 400);
    }, 3000);
  }

  // Resaltar panel de cartas
  const player1Cards = document.getElementById("player1Cards");
  if (player1Cards) {
    player1Cards.classList.add("your-turn");
    setTimeout(() => player1Cards.classList.remove("your-turn"), 2000);
  }
}

// Solicitar permiso para notificaciones
if ("Notification" in window && Notification.permission === "default") {
  Notification.requestPermission();
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
      
      // Actualizar indicador de suma
      updateCaptureSumIndicator();
    });

    tableCards.appendChild(element);
  });

  const empty = document.createElement("div");
  empty.className = "card empty";
  empty.textContent = "+";
  tableCards.appendChild(empty);
}

// Función para mostrar la suma de cartas seleccionadas
function updateCaptureSumIndicator() {
  if (selectedCaptureCards.length === 0 || !selectedCard) {
    return;
  }
  
  const captureSum = calculateCardSum(selectedCaptureCards);
  const playedCardValue = CARD_VALUES[selectedCard.rank] || 0;
  
  console.log(`Suma seleccionada: ${captureSum} | Valor carta jugada: ${playedCardValue}`);
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

// ═════════════════════════════════════════════════════════════════
// CAPTURA POR SUMA - FUNCIONES AUXILIARES
// ═════════════════════════════════════════════════════════════════

/**
 * Calcula la suma total del valor de las cartas
 * @param {Array} cards - Array de objetos carta
 * @returns {number} - Suma total de valores
 */
function calculateCardSum(cards) {
  return cards.reduce((sum, card) => {
    return sum + (CARD_VALUES[card.rank] || 0);
  }, 0);
}

/**
 * Valida si la captura es correcta
 * @param {Object} playedCard - Carta jugada
 * @param {Array} captureCards - Cartas seleccionadas para capturar
 * @returns {Object} - { isValid: boolean, message: string, type: 'equal'|'sum'|'none' }
 */
function validateCapture(playedCard, captureCards) {
  if (!playedCard) {
    return { isValid: false, message: "Debes seleccionar una carta de tu mano", type: null };
  }

  if (captureCards.length === 0) {
    return { isValid: true, message: "No capturando", type: "none" };
  }

  const playedValue = CARD_VALUES[playedCard.rank] || 0;
  const captureSum = calculateCardSum(captureCards);

  // Validar captura por igualdad (escalera)
  const hasEqual = captureCards.some(card => card.rank === playedCard.rank);
  if (hasEqual) {
    return { isValid: true, message: `Captura por igualdad (${playedCard.rank})`, type: "equal" };
  }

  // Validar captura por suma
  if (captureSum === playedValue) {
    const cardList = captureCards.map(c => c.rank).join("+");
    return { 
      isValid: true, 
      message: `Captura por suma: ${cardList} = ${playedValue}`, 
      type: "sum" 
    };
  }

  // Captura inválida
  return { 
    isValid: false, 
    message: `La suma (${captureSum}) no coincide con el valor de la carta (${playedValue})`, 
    type: null 
  };
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

    // Validar la captura
    const validation = validateCapture(selectedCard, selectedCaptureCards);
    
    if (!validation.isValid) {
      alert(`❌ ${validation.message}`);
      return;
    }

    // Mostrar confirmación
    console.log(`✅ ${validation.message}`);

    const jugada = {
      userId: currentUser.userId,
      sessionId: currentSessionId,
      card: {
        id: selectedCard.id,
        rank: selectedCard.rank,
        suit: selectedCard.suit
      },
      capture: selectedCaptureCards.map(card => card.id)
    };

    console.log("JUGADA VÁLIDA ENVIADA AL BACKEND:", jugada);
    console.log(`  Carta jugada: ${selectedCard.rank}${formatSuit(selectedCard.suit)}`);
    if (selectedCaptureCards.length > 0) {
      console.log(`  Cartas capturadas: ${selectedCaptureCards.map(c => `${c.rank}${formatSuit(c.suit)}`).join(', ')}`);
      console.log(`  Suma: ${calculateCardSum(selectedCaptureCards)}`);
    }

    socket.emit("jugar_carta", jugada);
    
    // Limpiar selección
    selectedCard = null;
    selectedCaptureCards = [];
  });
}

if (leaveRoomBtn) {
  leaveRoomBtn.addEventListener("click", () => {
    localStorage.removeItem("currentSessionId");
    window.location.href = "lobby.html";
  });
}

// Botón para limpiar selección
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
if (clearSelectionBtn) {
  clearSelectionBtn.addEventListener("click", () => {
    selectedCard = null;
    selectedCaptureCards = [];
    
    // Limpiar estilos
    document.querySelectorAll("#player1Cards .card").forEach(c => {
      c.classList.remove("selected");
    });
    
    document.querySelectorAll("#tableCards .card").forEach(c => {
      c.classList.remove("selected");
    });
    
    console.log("Selección limpiada");
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