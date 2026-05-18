# Juego del 40 — Plataforma de Apuestas en Línea

Plataforma multijugador en tiempo real para jugar al Cuarenta (40), el juego de cartas ecuatoriano, con sistema de apuestas integrado. Cuatro jugadores forman dos equipos (A y B) y se enfrentan apostando un monto acordado; el equipo ganador se lleva el pozo completo.

---

## Sobre el juego

El Cuarenta es un juego de cartas de origen ecuatoriano que se juega entre cuatro jugadores repartidos en dos equipos. Cada partida en esta plataforma funciona así:

1. Un jugador crea una sala y define el monto a apostar.
2. Tres jugadores más aceptan la apuesta poniendo el mismo monto cada uno.
3. Los cuatro montos se descuentan del saldo al instante y se acumulan en el pozo de la sesión.
4. El motor del juego reparte las cartas, valida cada jugada y lleva la puntuación por equipos.
5. El primer equipo en llegar a 40 puntos gana y el pozo completo se acredita a los miembros del equipo ganador.

---

## Arquitectura y protocolos

La plataforma utiliza tres protocolos de comunicación en capas:

```
  Navegador          main-server.js          engine-server.js
  (Frontend)           (Backend)              (Motor de Juego)
      │                    │                        │
      │◄── HTTP ──────────►│                        │
      │  Archivos estáticos│                        │
      │  (Express)         │                        │
      │                    │                        │
      │◄── WebSocket ─────►│                        │
      │  Socket.IO         │                        │
      │  (eventos en       │◄────── TCP ───────────►│
      │   tiempo real)     │   tcp-bridge.js        │
      │                    │   (net.Socket)         │
      └────────────────────┴────────────────────────┘
```

**HTTP** — Express sirve los archivos estáticos del frontend (HTML, CSS, JS). Los navegadores cargan las páginas por HTTP convencional.

**WebSocket** — Socket.IO gestiona toda la comunicación en tiempo real entre el navegador y el backend. Eventos como crear partidas, jugar cartas y recibir actualizaciones del estado viajan por WebSocket. Socket.IO inicia la conexión con un handshake HTTP y luego hace upgrade a WebSocket.

**TCP** — El módulo `tcp-bridge.js` usa `net.Socket` de Node.js para conectarse al motor de juego en el puerto 5000. Cada acción de juego (iniciar partida, jugar carta) abre una conexión TCP al motor, envía un JSON, recibe la respuesta y la cierra. TCP garantiza la entrega ordenada y confiable que necesitan las operaciones de juego (cartas, puntuaciones, apuestas).

---

## Estructura del proyecto

```
GRUPO_B/
│
├── frontend/
│   ├── login.html          # Página de inicio de sesión
│   ├── register.html        # Página de registro
│   ├── lobby.html           # Lobby: ver salas, crear/unirse a partidas
│   ├── game.html            # Mesa de juego en tiempo real
│   ├── socket-client.js     # Lógica WebSocket del navegador
│   └── style.css            # Estilos (dark mode, cartas, animaciones)
│
├── backend/
│   ├── main-server.js       # Servidor principal (Express + Socket.IO)
│   ├── database.js          # Operaciones con MySQL (usuarios, partidas, transacciones)
│   ├── tcp-bridge.js        # Puente TCP hacia el motor del juego
│   ├── package.json         # Dependencias del backend
│   ├── package-lock.json
│   ├── juego40.sql          # Schema de la base de datos
│   └── .env                 # Variables de entorno (no commitear)
│
├── game-engine/
│   ├── engine-server.js     # Servidor TCP autoritativo del juego
│   ├── rules.js             # Lógica del juego: reparto, turnos, puntuación
│   ├── apuestas.js          # Control de saldos en el motor
│   └── package.json
│
└── README.md
```

---

## Flujo completo del juego

### 1. Registro e inicio de sesión

El usuario accede al frontend, ingresa nombre de usuario y contraseña. Si no tiene cuenta, se registra en `register.html`; si ya tiene, inicia sesión en `login.html`. El backend devuelve el `userId` y el saldo actual, que el frontend guarda en `sessionStorage` (por pestaña, para permitir múltiples jugadores en el mismo navegador).

```
Frontend                         Backend
   │                                │
   │── registrar_usuario ─────────►│  Hashea password con bcrypt, inserta en users
   │◄── registro_exitoso ──────────│  { userId, username }
   │                                │
   │── login_usuario ─────────────►│  Valida credenciales con bcrypt
   │◄── login_exitoso ────────────│  { userId, username, balance }
```

### 2. Recarga de saldo

El usuario recarga dinero desde el lobby. El backend suma el monto al balance y registra la transacción.

```
Frontend                         Backend
   │                                │
   │── recargar_saldo ────────────►│  Suma monto al balance, registra depósito
   │◄── saldo_recargado ──────────│  { nuevoSaldo }
```

### 3. Crear una partida

Un jugador define cuánto quiere apostar y crea una sala. El monto se descuenta de su saldo inmediatamente. La sala queda en estado `waiting` y visible para todos los usuarios conectados. La sala expira automáticamente después de 3 minutos si no se llena, devolviendo el saldo a los participantes.

```
Frontend                         Backend                       Todos los clientes
   │                                │                                │
   │── crear_partida ──────────────►│  Descuenta saldo, crea sesión  │
   │◄── partida_creada ────────────│  { sessionId, mensaje }        │
   │                                │── nueva_sala_disponible ──────►│
   │                                │   { sessionId, monto }         │
```

### 4. Unirse a una partida

Otros jugadores ven la sala disponible en el lobby y se unen uno a uno. Cada vez que alguien se une, el backend descuenta su saldo y notifica el avance. Cuando se completan 4 jugadores, el backend envía `START_GAME` al motor vía TCP y guarda la partida en `partidasActivas`.

```
Frontend                         Backend                       Motor (TCP)
   │                                │                                │
   │── aceptar_partida ───────────►│  Descuenta saldo               │
   │◄── unido_a_sala ─────────────│  { jugadores, mensaje }        │
   │                                │                                │
   │  (cuando hay 4 jugadores)      │                                │
   │                                │── START_GAME ────────────────►│
   │                                │   { sessionId, players,        │
   │                                │     totalPot }                 │
   │◄── juego_iniciado ───────────│                                │
   │  (navega a game.html)          │                                │
```

### 5. Identificación al reconectar

Al navegar de `lobby.html` a `game.html`, el socket se destruye y se crea uno nuevo. El frontend se identifica automáticamente al conectar emitiendo `identificar_jugador` con su userId y sessionId (guardados en `sessionStorage`). El backend actualiza el mapeo de sockets y cancela cualquier timeout de desconexión.

```
Frontend (game.html)             Backend
   │                                │
   │── (socket se conecta) ────────│
   │── identificar_jugador ───────►│  Actualiza socketId en jugadoresEnPartida
   │                                │  Cancela timeout de desconexión si había
   │◄── jugador_reconectado ──────│  (notifica a los demás)
```

### 6. Desarrollo del juego

El motor corre de forma autoritativa: reparte 5 cartas a cada jugador, valida jugadas (capturas por igualdad o por suma), controla turnos y lleva la puntuación por equipos. Los eventos del motor llegan al backend vía TCP y se reenvían únicamente a los 4 jugadores de esa sesión mediante `emitToSession`.

```
Motor (TCP)                      Backend                       Jugadores de la sesión
   │                                │                                │
   │── GAME_STARTED ──────────────►│                                │
   │   { state, hands }            │── evento_motor ───────────────►│
   │                                │   (solo a los 4 jugadores)     │
   │                                │                                │
   │◄── PLAY_CARD ─────────────────│◄── jugar_carta ───────────────│
   │   { playerId, card, capture } │                                │
   │                                │                                │
   │── STATE_UPDATE ──────────────►│── evento_motor ───────────────►│
   │   { state, hands, verdict }   │   (solo a los 4 jugadores)     │
```

### 7. Fin de la partida

Cuando un equipo alcanza 40 puntos, el motor envía un evento `FINAL` con el veredicto. El backend acredita el pozo al equipo ganador, notifica a los jugadores y limpia la sesión.

```
Motor (TCP)                      Backend                       Jugadores de la sesión
   │                                │                                │
   │── FINAL ─────────────────────►│  Acredita pozo, cierra sesión  │
   │   { verdict, winnerTeam }     │── evento_motor ───────────────►│
   │                                │   { verdict, winnerTeam }      │
```

---

## Gestión de sesiones y reconexión

### Estructuras en memoria del backend

| Estructura          | Tipo                | Descripción                                                    |
|---------------------|---------------------|----------------------------------------------------------------|
| `salasPendientes`   | `Map<sessionId, …>` | Salas en espera de jugadores (estado `waiting`)               |
| `partidasActivas`   | `Map<sessionId, …>` | Partidas en progreso (persiste después de borrar de pendientes)|
| `jugadoresEnPartida`| `Map<userId, …>`    | Mapea cada jugador a su sesión, socketId actual y timeout      |
| `socketToUser`      | `Map<socketId, …>`  | Mapeo inverso para encontrar al usuario en desconexiones       |

### emitToSession

Todos los eventos dirigidos a una partida se envían con `emitToSession()`, que busca el socketId actual de cada jugador en `jugadoresEnPartida` y emite directamente a ese socket. Esto es más robusto que usar rooms de Socket.IO, ya que los rooms se pierden cuando el socket se destruye al navegar entre páginas.

### Desconexión y timeout

Cuando un jugador se desconecta durante una partida activa, el servidor inicia un timeout de 5 minutos. Si el jugador reconecta antes (vía `identificar_jugador`), el timeout se cancela y el juego continúa. Si no reconecta, la sesión se cierra y se notifica a los demás jugadores.

### sessionStorage

El frontend usa `sessionStorage` en vez de `localStorage` para guardar `currentUser`, `currentSessionId` y `lastGameState`. Esto permite abrir múltiples pestañas del mismo navegador con diferentes cuentas de usuario sin que se sobreescriban entre sí.

---

## Referencia de eventos Socket.IO

### Cliente → Servidor

| Evento                 | Payload                                    | Descripción                                    |
|------------------------|--------------------------------------------|------------------------------------------------|
| `registrar_usuario`    | `{ username, password }`                   | Crear cuenta nueva                             |
| `login_usuario`        | `{ username, password, sessionId? }`       | Iniciar sesión (con reconexión opcional)        |
| `identificar_jugador`  | `{ userId, sessionId }`                    | Identificar socket al navegar/reconectar        |
| `recargar_saldo`       | `{ userId, monto }`                        | Recargar dinero                                |
| `pedir_saldo`          | `userId`                                   | Consultar saldo actual                         |
| `crear_partida`        | `{ userId, monto }`                        | Crear sala con apuesta                         |
| `aceptar_partida`      | `{ userId, sessionId }`                    | Unirse a una sala existente                    |
| `jugar_carta`          | `{ userId, sessionId, card, capture }`     | Jugar una carta (con captura opcional)         |
| `registrar_ganador`    | `{ sessionId, winnerId }`                  | Registrar ganador (llamado por el motor)        |

### Servidor → Cliente

| Evento                  | Payload                                   | Alcance              |
|-------------------------|-------------------------------------------|----------------------|
| `registro_exitoso`      | `{ userId, username }`                    | Solo al emisor       |
| `login_exitoso`         | `{ userId, username, balance }`           | Solo al emisor       |
| `saldo_recargado`       | `{ nuevoSaldo }`                          | Solo al emisor       |
| `recibir_saldo`         | `balance`                                 | Solo al emisor       |
| `partida_creada`        | `{ sessionId, mensaje }`                  | Solo al emisor       |
| `nueva_sala_disponible` | `{ sessionId, monto }`                    | Global (todos)       |
| `sala_removida`         | `{ sessionId }`                           | Global (todos)       |
| `salas_pendientes`      | `[{ sessionId, monto }]`                  | Al conectarse        |
| `unido_a_sala`          | `{ sessionId, jugadores, mensaje }`       | Solo al que se unió  |
| `jugador_unido`         | `{ sessionId, jugadores, mensaje }`       | Jugadores de la sala |
| `juego_iniciado`        | `{ sessionId, mensaje }`                  | Jugadores de la sala |
| `evento_motor`          | `{ action, state, hands, … }`             | Jugadores de la sesión|
| `jugador_desconectado`  | `{ sessionId, userId, mensaje }`          | Jugadores de la sesión|
| `jugador_reconectado`   | `{ sessionId, userId, mensaje }`          | Jugadores de la sesión|
| `sesion_cerrada`        | `{ sessionId, razón, mensaje }`           | Jugadores de la sesión|
| `sala_expirada`         | `{ sessionId, mensaje }`                  | Jugadores de la sala |
| `partida_finalizada`    | `{ sessionId, winnerId, totalPot }`       | Jugadores de la sesión|
| `error_notificacion`    | `message`                                 | Solo al emisor       |

---

## Base de datos

Tres tablas en MySQL:

**`users`** — Perfil y saldo de cada jugador. El saldo se modifica directamente con cada apuesta, recarga o ganancia.

**`game_sessions`** — Representa una partida. Guarda quién la creó (`creator_id_fk`), el pozo acumulado, el estado (`waiting` / `active` / `finished`) y quién ganó.

**`transactions`** — Historial de todos los movimientos de dinero. Cada apuesta, depósito y ganancia queda registrada con su tipo (`bet`, `win`, `deposit`).

---

## Instalación y arranque

**Requisitos:** Node.js 18+, MySQL 8+

```bash
# 1. Crear la base de datos
mysql -u root -p < backend/juego40.sql

# 2. Configurar variables de entorno
cd backend
cp .env.example .env
# Editar .env con tus credenciales de MySQL

# 3. Instalar dependencias del backend
npm install

# 4. Instalar dependencias del motor (en otra terminal)
cd ../game-engine
npm install

# 5. Arrancar el motor del juego
node engine-server.js
# Motor escuchando en puerto 5000

# 6. Arrancar el backend (en otra terminal)
cd ../backend
node main-server.js
# Servidor activo en http://localhost:3000
```

Acceder al frontend en `http://localhost:3000/frontend/login.html`.

Para probar con 4 jugadores en la misma máquina, abrir 4 pestañas separadas (cada una mantiene su propia sesión gracias a `sessionStorage`), registrar/logear un usuario diferente en cada pestaña, y crear/unirse a la sala.

---

## Variables de entorno

```
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=juego_40
```

---

## Dependencias principales

| Paquete      | Uso                                                        |
|--------------|------------------------------------------------------------|
| `express`    | Servidor HTTP y archivos estáticos del frontend            |
| `socket.io`  | Comunicación WebSocket en tiempo real con el navegador     |
| `mysql2`     | Conexión y queries a MySQL con soporte async/await         |
| `bcrypt`     | Hash seguro de contraseñas                                 |
| `uuid`       | Generación de IDs únicos para sesiones y transacciones     |
| `dotenvx`    | Carga de variables de entorno desde `.env`                 |