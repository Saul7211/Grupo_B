const socket = io("http://localhost:3000");

let currentUser = null;
let currentSessionId = null;
let selectedCard = null;

// ELEMENTOS DEL HTML
const statusText = document.getElementById("statusText");
const balanceText = document.getElementById("balanceText");
const potText = document.getElementById("potText");
const turnText = document.getElementById("turnText");
const tableCards = document.getElementById("tableCards");

const deckCount = document.getElementById("deckCount");
const teamAScore = document.getElementById("teamAScore");
const teamBScore = document.getElementById("teamBScore");

const player1Cards = document.getElementById("player1Cards");
const playCardBtn = document.getElementById("playCardBtn");
const declareRoundBtn = document.getElementById("declareRoundBtn");
const passTurnBtn = document.getElementById("passTurnBtn");
const leaveRoomBtn = document.getElementById("leaveRoomBtn");

// CONEXIÓN
socket.on("connect", () => {
  console.log("Conectado al backend:", socket.id);

  if (statusText) {
    statusText.textContent = "Conectado";
  }
});

socket.on("disconnect", () => {
  console.log("Desconectado del backend");

  if (statusText) {
    statusText.textContent = "Desconectado";
  }
});

// ERRORES
socket.on("error_notificacion", (message) => {
  console.error("Error:", message);
  alert(message);
});

// REGISTRO
function registrar(username, password) {
  socket.emit("registrar_usuario", {
    username,
    password
  });
}

socket.on("registro_exitoso", (data) => {
  console.log("Registro exitoso:", data);
  alert("Usuario registrado correctamente");
});

// LOGIN
function login(username, password) {
  socket.emit("login_usuario", {
    username,
    password
  });
}

socket.on("login_exitoso", (data) => {
  console.log("Login exitoso:", data);

  currentUser = data;

  if (statusText) {
    statusText.textContent = `Conectado: ${data.username}`;
  }

  if (balanceText) {
    balanceText.textContent = `$${Number(data.balance).toFixed(2)}`;
  }

  alert(`Bienvenido ${data.username}`);
});

// RECARGAR SALDO
function recargarSaldo(monto) {
  if (!currentUser) {
    alert("Primero debes iniciar sesión");
    return;
  }

  socket.emit("recargar_saldo", {
    userId: currentUser.userId,
    monto: Number(monto)
  });
}

socket.on("saldo_recargado", (data) => {
  console.log("Saldo recargado:", data);

  if (currentUser) {
    currentUser.balance = data.nuevoSaldo;
  }

  if (balanceText) {
    balanceText.textContent = `$${Number(data.nuevoSaldo).toFixed(2)}`;
  }

  alert("Saldo recargado correctamente");
});

// PEDIR SALDO
function pedirSaldo() {
  if (!currentUser) return;

  socket.emit("pedir_saldo", currentUser.userId);
}

socket.on("recibir_saldo", (balance) => {
  console.log("Saldo recibido:", balance);

  if (currentUser) {
    currentUser.balance = balance;
  }

  if (balanceText) {
    balanceText.textContent = `$${Number(balance).toFixed(2)}`;
  }
});

// CREAR PARTIDA / APUESTA
function crearPartida(monto) {
  if (!currentUser) {
    alert("Primero debes iniciar sesión");
    return;
  }

  socket.emit("crear_partida", {
    userId: currentUser.userId,
    monto: Number(monto)
  });
}

socket.on("partida_creada", (data) => {
  console.log("Partida creada:", data);

  currentSessionId = data.sessionId;

  alert(data.mensaje);
});

// NUEVA SALA DISPONIBLE
socket.on("nueva_sala_disponible", (data) => {
  console.log("Nueva sala disponible:", data);

  alert(`Nueva sala disponible por $${Number(data.monto).toFixed(2)}`);
});

// ACEPTAR PARTIDA
function aceptarPartida(sessionId) {
  if (!currentUser) {
    alert("Primero debes iniciar sesión");
    return;
  }

  socket.emit("aceptar_partida", {
    userId: currentUser.userId,
    sessionId
  });
}

// JUEGO INICIADO
socket.on("juego_iniciado", (data) => {
  console.log("Juego iniciado:", data);

  currentSessionId = data.sessionId;

  if (statusText) {
    statusText.textContent = data.mensaje;
  }

  if (turnText) {
    turnText.textContent = "Jugador 1";
  }

  alert(data.mensaje);
});

// EVENTOS DEL MOTOR TCP
socket.on("evento_motor", (event) => {
  console.log("Evento del motor:", event);

  if (event.totalPot && potText) {
    potText.textContent = `$${Number(event.totalPot).toFixed(2)}`;
  }

  if (event.currentTurn && turnText) {
    turnText.textContent = event.currentTurn;
  }

  if (event.remainingCards && deckCount) {
    deckCount.textContent = event.remainingCards;
  }

  if (event.teamAScore !== undefined && teamAScore) {
    teamAScore.textContent = event.teamAScore;
  }

  if (event.teamBScore !== undefined && teamBScore) {
    teamBScore.textContent = event.teamBScore;
  }

  if (event.card && tableCards) {
    renderCardOnTable(event.card);
  }

  if (event.action === "GAME_FINISHED") {
    alert(`Juego finalizado. Ganador: ${event.winnerId}`);
  }
});

// PARTIDA FINALIZADA
socket.on("partida_finalizada", (data) => {
  console.log("Partida finalizada:", data);

  if (potText) {
    potText.textContent = `$${Number(data.totalPot).toFixed(2)}`;
  }

  alert(`Partida finalizada. Ganador: ${data.winnerId}`);
});

// SELECCIONAR CARTA
if (player1Cards) {
  player1Cards.addEventListener("click", (event) => {
    const cardButton = event.target.closest(".card");

    if (!cardButton) return;

    selectedCard = cardButton.dataset.card;

    document.querySelectorAll("#player1Cards .card").forEach(card => {
      card.classList.remove("selected");
    });

    cardButton.classList.add("selected");

    console.log("Carta seleccionada:", selectedCard);
  });
}

// BOTÓN JUGAR CARTA
if (playCardBtn) {
  playCardBtn.addEventListener("click", () => {
    if (!currentUser) {
      alert("Primero debes iniciar sesión");
      return;
    }

    if (!currentSessionId) {
      alert("No hay una partida activa");
      return;
    }

    if (!selectedCard) {
      alert("Selecciona una carta");
      return;
    }

    socket.emit("jugar_carta", {
      userId: currentUser.userId,
      sessionId: currentSessionId,
      card: selectedCard
    });

    console.log("Carta enviada:", selectedCard);
  });
}

// BOTÓN DECLARAR RONDA
if (declareRoundBtn) {
  declareRoundBtn.addEventListener("click", () => {
    if (!currentUser || !currentSessionId) {
      alert("Primero debes estar en una partida");
      return;
    }

    socket.emit("declarar_ronda", {
      userId: currentUser.userId,
      sessionId: currentSessionId
    });
  });
}

// BOTÓN PASAR TURNO
if (passTurnBtn) {
  passTurnBtn.addEventListener("click", () => {
    if (!currentUser || !currentSessionId) {
      alert("Primero debes estar en una partida");
      return;
    }

    socket.emit("pasar_turno", {
      userId: currentUser.userId,
      sessionId: currentSessionId
    });
  });
}

// BOTÓN SALIR
if (leaveRoomBtn) {
  leaveRoomBtn.addEventListener("click", () => {
    currentSessionId = null;
    selectedCard = null;

    alert("Saliste de la sala");

    if (statusText) {
      statusText.textContent = "Conectado";
    }
  });
}

// FUNCIONES DE RENDERIZADO

function renderCardOnTable(card) {
  const emptyCard = tableCards.querySelector(".empty");

  const cardElement = document.createElement("div");
  cardElement.className = "card";

  if (typeof card === "string") {
    const parts = card.split("-");

    cardElement.innerHTML = `
      ${parts[0] || card}
      <span>${formatSuit(parts[1])}</span>
    `;
  } else {
    cardElement.innerHTML = `
      ${card.value || ""}
      <span>${formatSuit(card.suit)}</span>
    `;
  }

  if (emptyCard) {
    tableCards.insertBefore(cardElement, emptyCard);
  } else {
    tableCards.appendChild(cardElement);
  }
}

function formatSuit(suit) {
  const suits = {
    spade: "♠",
    heart: "♥",
    diamond: "♦",
    club: "♣",
    espada: "♠",
    corazon: "♥",
    diamante: "♦",
    trebol: "♣"
  };

  return suits[suit] || suit || "";
}

// FUNCIONES PARA PROBAR DESDE CONSOLA
window.registrar = registrar;
window.login = login;
window.recargarSaldo = recargarSaldo;
window.pedirSaldo = pedirSaldo;
window.crearPartida = crearPartida;
window.aceptarPartida = aceptarPartida;