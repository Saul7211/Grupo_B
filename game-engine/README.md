# Game Engine (Cuarenta)

Este modulo implementa el flujo del Cuarenta ecuatoriano usando TCP y mensajes NDJSON. Incluye mazo de 40 cartas, capturas (igual, suma, escalera), turnos, puntaje y veredicto final.

## Como correr

Desde `game-engine/`:

```bash
node engine-server.js
```

Variables opcionales:

- `TCP_PORT` (default: 9000)
- `MAX_PLAYERS` (default: 4)
- `HAND_SIZE` (default: 5)
- `POINTS_TO_WIN` (default: 40)

## Protocolo (NDJSON)

Cada linea es un objeto JSON.

### Mensajes de cliente a servidor

- `{"type":"hello","name":"Ana"}` asigna nombre.
- `{"type":"start"}` inicia partida si hay 2+ jugadores.
- `{"type":"bet","amount":10}` apuesta (opcional, no afecta puntaje de Cuarenta).
- `{"type":"play","card":{"id":"..."},"capture":["id1","id2"]}` juega carta y captura.
- `{"type":"play","card":{"suit":"oros","rank":"7"}}` juega carta sin captura.
- `{"type":"state"}` pide estado actual.
- `{"type":"ping"}` prueba de conexion.

### Mensajes de servidor a cliente

- `{"type":"welcome","id":"..."}` id del jugador.
- `{"type":"players","players":[...]}` lista de jugadores.
- `{"type":"started"}` partida iniciada.
- `{"type":"state",...}` estado por jugador (incluye su mano y equipo).
- `{"type":"bet", "pot": 20, "bets": {"id": 20}}` apuestas.
- `{"type":"final", "verdict": {...}}` veredicto de ronda.
- `{"type":"error", "message":"..."}` error.

## Reglas configuradas

- Baraja: A, 2, 3, 4, 5, 6, 7, J, Q, K por cada pinta (40 cartas).
- Palos: Corazones (♥️), Diamantes (♦️), Treboles (♣️), Picas (♠️).
- Valores para sumas: A=1, 2-7=2-7, J=8, Q=9, K=10.
- Equipos: jugadores 0 y 2 contra 1 y 3.
- Ronda automatica al repartir: 3 iguales suman 2 puntos; 4 iguales suman 4 puntos.
- Puntos: caida (2), limpia (2), caida+limpia (2), falla (2).
- Captura obligatoria si existe una opcion valida.
- Reparto: 5 cartas por jugador. Si todos quedan sin cartas y hay mazo, se reparten otras 5.
- Turno: juega el jugador a la derecha del repartidor.
- Meta: gana la pareja que llega a 40.
- Regla de 38: si un equipo tiene 38+, solo puede sumar con caida.
- Carton: 20 cartas -> 6 puntos; cada 2 cartas extra suman 2 puntos. Si hay empate 20-20, se da "dos por dar" al equipo del siguiente repartidor.

## Modulos

### rules.js

- `createDeck()` crea un mazo espanol de 40 cartas con ids unicos.
- `shuffle(deck)` baraja con Fisher-Yates.
- `deal(deck, count)` reparte cartas.
- `rankValue(rank)` devuelve el valor numerico para sumas.
- `rankIndex(rank)` devuelve el orden para escalera.

### apuestas.js

- `createBettingState({minBet, maxBet})` crea estado de apuestas.
- `placeBet(state, playerId, amount)` valida min/max y actualiza pozo.
- `resetBets(state)` reinicia apuestas y pozo.

### engine-server.js

- Servidor TCP que recibe NDJSON.
- Mantiene estado de partida, equipos, turnos y mesa.
- Valida capturas por igual, suma o escalera.
- Calcula puntos por ronda, caida, limpia, falla y carton.
- Publica veredicto final cuando se termina el mazo o alguien llega a 40.

## Notas

La captura usa ids de cartas para evitar ambiguedad cuando hay cartas repetidas por rango. Si el cliente solo envia `suit` y `rank`, el servidor buscara esa carta en la mano.
