# Juego del 40 — Plataforma de Apuestas en Línea

Plataforma multijugador en tiempo real para jugar al Cuarenta (40), el juego de cartas ecuatoriano, con sistema de apuestas integrado. Dos jugadores se enfrentan apostando un monto acordado; el ganador se lleva el pozo completo.

---

## Sobre el juego

El Cuarenta es un juego de cartas de origen ecuatoriano que se juega entre dos jugadores. Cada partida en esta plataforma funciona así: un jugador crea una sala y define el monto a apostar; otro jugador acepta la apuesta poniendo el mismo monto; ambos montos se descuentan del saldo al instante y se acumulan en el pozo de la sesión; al finalizar la partida, el motor del juego determina al ganador y el pozo completo se acredita a su cuenta.

---

## Estructura del proyecto

```
juego-cartas-apuestas/
│
├── frontend/
│   ├── index.html          # Interfaz de la mesa de juego
│   ├── style.css           # Estilos (dark mode, UI de apuestas)
│   └── socket-client.js    # Lógica de WebSockets del navegador
│
├── backend-server/
│   ├── main-server.js      # Servidor principal (Socket.IO)
│   ├── database.js         # Todas las operaciones con MySQL
│   ├── tcp-bridge.js       # Puente TCP hacia el motor del juego
│   ├── package.json        # Dependencias del backend
│   └── .env                # Variables de entorno (no commitear)
│
├── game-engine/
│   ├── engine-server.js    # Servidor TCP autoritativo
│   ├── rules.js            # Lógica del juego: reparto y ganador
│   └── apuestas.js         # Control de saldos en el motor
│
└── juego40.sql             # Schema de la base de datos
```

---

## Flujo completo del juego

### 1. Registro e inicio de sesión

El usuario llega al frontend, ingresa un nombre de usuario y contraseña. Si no tiene cuenta, se registra; si ya tiene, inicia sesión. El backend devuelve el `userId` y el saldo actual, que el frontend debe guardar en memoria para todas las operaciones siguientes.

```
Frontend                        Backend
   |                               |
   |-- registrar_usuario --------> |  Hashea password, inserta en users
   |<-- registro_exitoso --------- |  { userId, username }
   |                               |
   |-- login_usuario ------------> |  Valida credenciales con bcrypt
   |<-- login_exitoso ------------ |  { userId, username, balance }
```

### 2. Recarga de saldo

El usuario recarga dinero desde su perfil. Por ahora acepta el monto directamente.

```
Frontend                        Backend
   |                               |
   |-- recargar_saldo -----------> |  Suma monto al balance, registra depósito
   |<-- saldo_recargado ---------- |  { nuevoSaldo }
```

### 3. Crear una partida

El jugador define cuánto quiere apostar y crea una sala. El monto se descuenta de su saldo inmediatamente y la sala queda en estado `waiting` visible para todos los usuarios conectados.

```
Frontend                        Backend                      Todos los clientes
   |                               |                               |
   |-- crear_partida -----------> |  Descuenta saldo, crea sesión  |
   |<-- partida_creada ---------- |  { sessionId, mensaje }        |
   |                               |-- nueva_sala_disponible ----> |
   |                               |   { sessionId, monto }        |
```

### 4. Aceptar una partida

Otro jugador ve la sala disponible y decide unirse. El backend descuenta su saldo, acumula el pozo y cambia el estado de la sesión a `active`. Luego notifica al motor del juego vía TCP para que arranque la partida.

```
Frontend                        Backend                      Motor (TCP)
   |                               |                               |
   |-- aceptar_partida ----------> |  Descuenta saldo, activa sesión
   |                               |-- START_GAME --------------> |
   |                               |   { sessionId, players,       |
   |                               |     totalPot }                |
   |<-- juego_iniciado ----------- |                               |
   (a todos los clientes)
```

### 5. Desarrollo del juego

El motor corre de forma autoritativa: reparte cartas, valida jugadas y determina quién gana. Durante la partida el motor puede emitir eventos hacia el backend (via TCP), que los reenvía a los clientes como `evento_motor`.

### 6. Fin de la partida

Al terminar, el motor envía al backend el `winnerId`. El backend acredita el pozo completo al ganador y notifica a todos los clientes.

```
Motor (TCP)                     Backend                      Todos los clientes
   |                               |                               |
   |-- { winnerId, sessionId } --> |  Acredita pozo, cierra sesión |
   |                               |-- partida_finalizada -------> |
   |                               |   { sessionId, winnerId,      |
   |                               |     totalPot }                |
```

---

## Referencia de eventos Socket.IO

| Evento (cliente → server)  | Payload                          | Respuesta del server          |
|----------------------------|----------------------------------|-------------------------------|
| `registrar_usuario`        | `{ username, password }`         | `registro_exitoso` / `error_notificacion` |
| `login_usuario`            | `{ username, password }`         | `login_exitoso` / `error_notificacion` |
| `recargar_saldo`           | `{ userId, monto }`              | `saldo_recargado` / `error_notificacion` |
| `pedir_saldo`              | `userId`                         | `recibir_saldo`               |
| `crear_partida`            | `{ userId, monto }`              | `partida_creada` + broadcast `nueva_sala_disponible` |
| `aceptar_partida`          | `{ userId, sessionId }`          | broadcast `juego_iniciado`    |
| `registrar_ganador`        | `{ sessionId, winnerId }`        | broadcast `partida_finalizada` |

---

## Base de datos

Tres tablas en MySQL:

**`users`** — Guarda el perfil y saldo de cada jugador. El saldo se modifica directamente con cada apuesta, recarga o ganancia.

**`game_sessions`** — Representa una partida. Guarda quién la creó (`creator_id_fk`), el pozo acumulado, el estado (`waiting` / `active` / `finished`) y quién ganó.

**`transactions`** — Historial de todos los movimientos de dinero. Cada apuesta, depósito y ganancia queda registrada con su tipo (`bet`, `win`, `deposit`).

---

## Instalación y arranque

**Requisitos:** Node.js 18+, MySQL 8+

```bash
# 1. Crear la base de datos
mysql -u root -p < juego40.sql

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales de MySQL

# 3. Instalar dependencias del backend
cd backend-server
npm install

# 4. Arrancar el motor del juego (en otra terminal)
cd game-engine
node engine-server.js

# 5. Arrancar el backend
cd backend-server
npm start
```

El servidor quedará activo en `http://localhost:3000`.

---

## Variables de entorno

```
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=
DB_PASSWORD=
DB_NAME=juego_40
```

---

## Dependencias principales

| Paquete      | Uso                                              |
|--------------|--------------------------------------------------|
| `express`    | Servidor HTTP base                               |
| `socket.io`  | Comunicación en tiempo real con el frontend      |
| `mysql2`     | Conexión y queries a MySQL con soporte async     |
| `bcrypt`     | Hash seguro de contraseñas                       |
| `uuid`       | Generación de IDs únicos para sesiones y transacciones |
| `dotenv`     | Carga de variables de entorno desde `.env`       |
