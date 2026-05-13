# Game Engine (Cuarenta)

Este modulo implementa un motor de juego basico con TCP y mensajes JSON por linea (NDJSON). Incluye mazo, barajar, turnos, apuestas y un veredicto final simple.

## Como correr

Desde `game-engine/`:

```bash
node engine-server.js
```

Variables opcionales:

- `TCP_PORT` (default: 9000)
- `MAX_PLAYERS` (default: 4)
- `HAND_SIZE` (default: 5)

## Protocolo (NDJSON)

Cada linea es un objeto JSON.

### Mensajes de cliente a servidor

- `{"type":"hello","name":"Ana"}` asigna nombre.
- `{"type":"start"}` inicia partida si hay 2+ jugadores.
- `{"type":"bet","amount":10}` apuesta y actualiza pozo.
- `{"type":"play","card":{"suit":"oros","rank":7}}` juega carta.
- `{"type":"state"}` pide estado actual.
- `{"type":"ping"}` prueba de conexion.

### Mensajes de servidor a cliente

- `{"type":"welcome","id":"..."}` id del jugador.
- `{"type":"players","players":[...]}` lista de jugadores.
- `{"type":"started"}` partida iniciada.
- `{"type":"state",...}` estado por jugador (incluye su mano).
- `{"type":"bet", "pot": 20, "bets": {"id": 20}}` apuestas.
- `{"type":"final", "verdict": {...}}` veredicto de ronda.
- `{"type":"error", "message":"..."}` error.

## Modulos

### rules.js

- `createDeck()` crea un mazo espanol de 40 cartas.
- `shuffle(deck)` baraja con Fisher-Yates.
- `deal(deck, count)` reparte cartas.
- `compareCards(a, b)` compara cartas por rank y palo.
- `evaluateHand(hand)` puntaje simple por suma de ranks.

### apuestas.js

- `createBettingState({minBet, maxBet})` crea estado de apuestas.
- `placeBet(state, playerId, amount)` valida min/max y actualiza pozo.
- `resetBets(state)` reinicia apuestas y pozo.

### engine-server.js

- Servidor TCP que recibe NDJSON.
- Mantiene estado de partida, turnos y mesa.
- Resuelve baza por carta mas alta y publica veredicto final.

## Notas

Este motor es basico y sirve como esqueleto. Las reglas reales de Cuarenta pueden reemplazar la resolucion de baza y el puntaje en `engine-server.js` y `rules.js`.
