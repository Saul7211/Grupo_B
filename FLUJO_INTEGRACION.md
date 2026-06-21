# 🔗 Integración de Logs en el Proyecto Existente

## Sin Logs (Antes)
```
Navegador (Frontend)
    ↓ HTTP/WebSocket
Express Backend
    ├─ Socket.IO (Juego)
    ├─ OAuth Google
    ├─ MySQL (Usuarios/Partidas)
    └─ TCP Bridge → Motor
    
Consola: console.log(...) → Solo salida a pantalla
```

## Con Logs (Ahora)
```
Navegador (Frontend)
    ↓ HTTP/WebSocket
Express Backend + Morgan Middleware
    ├─ Rutas HTTP normales (/ , /auth/google, /frontend/...)
    │   └─ Morgan captura: [método] [ruta] [status] [tiempo]
    │
    ├─ Rutas del Laboratorio (NUEVAS)
    │   ├─ GET /users              → Logger.info()
    │   ├─ GET /users/:id          → Logger.debug/warn/error()
    │   └─ GET /logs/resumen       → Lee último log, resume
    │
    ├─ Socket.IO (Juego SIN CAMBIOS)
    │   ├─ Conexiones    → Logger.info()
    │   ├─ Eventos       → Logger.info/debug()
    │   └─ Desconexiones → Logger.warn/error()
    │
    ├─ OAuth Google (SIN CAMBIOS)
    │   └─ Eventos       → Logger.info()
    │
    ├─ MySQL (SIN CAMBIOS)
    │   └─ Conexión      → Logger.info/error()
    │
    └─ TCP Bridge → Motor (SIN CAMBIOS)
        └─ Eventos       → Logger.info/debug/error()
    
Winston Logger (3 salidas)
    ├─ Console (coloreado, en tiempo real)
    ├─ application-YYYY-MM-DD.log (INFO, DEBUG, HTTP, WARN)
    └─ errors-YYYY-MM-DD.log (ERROR, WARN críticos)

npm run logs:read
    └─ Lee último archivo y muestra tabla de conteos
```

---

## 🚀 Flujo Completo: Usuario Registra → Crea Partida → Juega

### 1. Usuario Abre localhost:8000/login.html
```
Frontend HTTP Request:
    GET /frontend/login.html 200
    
Winston Logs:
    [HTTP] GET /frontend/login.html 200 1.2 ms
```

### 2. Usuario Hace Click en "Registrarse"
```
Frontend Event:
    socket.emit('registrar_usuario', { username, password })
    
Backend Socket.IO:
    socket.on('registrar_usuario') → logger.info()
    
Winston Logs:
    [INFO] Cliente conectado via WebSocket: socket_xxx
    [DEBUG] Registrando usuario: alice
    
Base de Datos:
    INSERT INTO users...
    
Winston Logs:
    [INFO] Usuario alice registrado exitosamente
```

### 3. Usuario Hace Login
```
Frontend Event:
    socket.emit('login_usuario', { username, password })
    
Backend Socket.IO:
    socket.on('login_usuario') → 
        1. Valida credenciales (MySQL query)
        2. Emite 'login_exitoso'
        3. logger.info('Usuario xxx logueado')
    
Winston Logs:
    [INFO] [IDENTIFICAR] Usuario user_xxx en sesion sess_yyy -> socket abc
    [INFO] Login exitoso para alice
```

### 4. Usuario Ve Salas y Crea Partida
```
Frontend Event:
    socket.emit('crear_partida', { userId, monto })
    
Backend Socket.IO:
    socket.on('crear_partida') →
        1. Valida saldo (MySQL query)
        2. Crea sesión (INSERT game_sessions)
        3. Descuenta saldo (UPDATE users)
        4. Emite 'partida_creada'
        5. Emite a TODOS: 'nueva_sala_disponible'
    
Winston Logs:
    [INFO] Partida creada: sess_yyy
    [DEBUG] Sala enviada a todos los conectados
```

### 5. Otros Usuarios Se Unen (aceptar_partida × 3)
```
Para cada usuario que se une:
    socket.emit('aceptar_partida', { userId, sessionId })
    
Backend Socket.IO:
    socket.on('aceptar_partida') →
        1. Valida sesión existe
        2. Valida saldo
        3. Descuenta saldo
        4. Suma a sesión
        5. Si es 4to jugador: START_GAME
    
Winston Logs:
    [DEBUG] Jugador 2 unido a sesion
    [DEBUG] Jugador 3 unido a sesion
    [INFO] Jugador 4 unido. PARTIDA LISTA. Enviando al motor...
```

### 6. Backend Conecta con Motor (TCP Bridge)
```
Backend Code:
    enviarAlMotor({
        action: 'START_GAME',
        sessionId: sess_yyy,
        players: [user1, user2, user3, user4],
        totalPot: 40
    })
    
TCP Connection:
    new Socket() → connect to 127.0.0.1:5000
    
Winston Logs:
    [INFO] [TCP Bridge] Conectado al Motor en 127.0.0.1:5000
    [DEBUG] [TCP Bridge] El Motor respondio: {"action":"GAME_STARTED",...}
```

### 7. Motor Reparte Cartas y Envía Estado
```
Motor (TCP Response):
    { action: 'GAME_STARTED', sessionId, hands: {...}, state: {...} }
    
Backend Socket.IO:
    socket.on('data') [TCP] →
        Parse JSON response
        emitToSession(io, sessionId, 'evento_motor', respuesta)
    
Winston Logs:
    [DEBUG] [emitToSession] evento_motor -> sesion sess_yyy (4/4 alcanzados)
```

### 8. Jugador Juega Carta
```
Frontend Event:
    socket.emit('jugar_carta', { userId, sessionId, card, capture })
    
Backend Socket.IO:
    socket.on('jugar_carta') →
        enviarAlMotor({
            action: 'PLAY_CARD',
            sessionId,
            playerId: user_xxx,
            card: '7♥',
            capture: ['3♦', '4♠']
        })
    
Winston Logs:
    [DEBUG] Enviando PLAY_CARD al motor para user_xxx
    [INFO] [TCP Bridge] Conectado al Motor en 127.0.0.1:5000
    [DEBUG] [TCP Bridge] El Motor respondio: {"action":"STATE_UPDATE",...}
```

### 9. Partida Finaliza
```
Motor (TCP Response):
    { action: 'FINAL', verdict: 'TeamA wins', winnerId: user_xxx }
    
Backend Socket.IO:
    socket.on('registrar_ganador') →
        1. Acredita pozo a ganador
        2. Marca sesión como 'finished'
        3. emitToSession(io, sessionId, 'partida_finalizada', ...)
    
Winston Logs:
    [INFO] Partida sess_yyy finalizada. Ganador: user_xxx. Pozo: 40
    [DEBUG] [emitToSession] partida_finalizada -> sesion sess_yyy (4/4 alcanzados)
```

### 10. Usuario Se Desconecta
```
Frontend Event:
    window.close() o cierre de navegador
    
Backend Socket.IO:
    socket.on('disconnect') →
        1. Busca usuario en jugadoresEnPartida
        2. Emite a otros: 'jugador_desconectado'
        3. Inicia timeout de 5 minutos
    
Winston Logs:
    [WARN] [DESCONEXION] Usuario user_xxx desconectado de sesion sess_yyy
    [INFO] Timeout iniciado. Esperando reconexión...
```

### 11. Usuario Reconecta
```
Frontend Event:
    Navega a game.html → socket reconecta
    socket.emit('identificar_jugador', { userId, sessionId })
    
Backend Socket.IO:
    socket.on('identificar_jugador') →
        1. Cancela timeout
        2. Actualiza socketId
        3. emitToSession: 'jugador_reconectado'
    
Winston Logs:
    [INFO] Cliente conectado via WebSocket: socket_zzz
    [INFO] [IDENTIFICAR] Socket actualizado para user_xxx
    [DEBUG] [emitToSession] jugador_reconectado -> sesion sess_yyy (4/4 alcanzados)
```

### 12. Si NO reconecta en 5 minutos
```
Backend Timeout Handler:
    setTimeout(() => {
        emitToSession(io, sessionId, 'sesion_cerrada', ...)
        Limpia sesión
    }, 5 minutos)
    
Winston Logs:
    [ERROR] [TIMEOUT] Usuario user_xxx no se reconecto en 5 minutos. Cerrando sesion...
    [WARN] Sesion sess_yyy cerrada por inactividad
```

---

## 📊 Mapa de Logs por Módulo

| Módulo           | Archivo          | Niveles            | Eventos                                  |
|------------------|------------------|--------------------|------------------------------------------|
| morgan           | application      | HTTP               | Todas las requests                       |
| Socket.IO        | application      | INFO, DEBUG, WARN  | Conexión, desconexión, eventos           |
| TCP Bridge       | application      | INFO, DEBUG, ERROR | Conexión motor, respuestas               |
| UDP Monitor      | application      | INFO, ERROR        | Medición de latencia                     |
| Database.js      | application      | INFO, ERROR        | Conexión MySQL                           |
| Rutas /users     | application      | INFO, DEBUG, WARN  | Consultas de laboratorio                 |
| Error Handlers   | application/errors| WARN, ERROR        | 404, 500                                 |

---

## 🧪 Matriz de Pruebas Funcionales

| Test                          | Acción                              | Log Esperado            | Ubicación |
|-------------------------------|-------------------------------------|-------------------------|-----------|
| Servidor levanta              | npm start                           | SERVIDOR ACTIVO         | Console   |
| GET /users                    | curl localhost:3000/users           | HTTP 200, INFO          | App log   |
| GET /users/5                  | curl localhost:3000/users/5         | HTTP 200, DEBUG         | App log   |
| GET /users/abc                | curl localhost:3000/users/abc       | HTTP 400, WARN          | App log   |
| GET /users/99                 | curl localhost:3000/users/99        | HTTP 500, ERROR         | Error log |
| GET /logs/resumen             | curl localhost:3000/logs/resumen    | JSON con conteos        | Console   |
| npm run logs:read             | npm run logs:read                   | Tabla console.table     | Console   |
| Conectar WebSocket            | Navegador a localhost:8000          | INFO socket connect     | App log   |
| Crear partida                 | Click "Crear" en lobby              | INFO partida creada     | App log   |
| Desconectar durante partida   | Cerrar navegador                    | WARN desconexión        | App log   |
| Reconectar dentro de 5 min    | Recargar página                     | DEBUG socket update     | App log   |
| Timeout 5 minutos sin reconec | Esperar 5 min sin hacer login       | ERROR timeout           | Error log |

---

## ✅ Checklist: Todo Funciona Sin Interrupciones

- [x] Logs no ralentizan el servidor
- [x] Socket.IO continúa emitiendo eventos en tiempo real
- [x] MySQL sigue respondiendo como antes
- [x] TCP Bridge sigue comunicando con Motor
- [x] Rutas OAuth de Google sin cambios
- [x] Archivos de log se crean automáticamente
- [x] Rotación diaria funciona
- [x] Morgan captura HTTP sin latencia
- [x] Endpoint /logs/resumen devuelve JSON correcto
- [x] Script logReader muestra tabla
- [x] Niveles de log están bien clasificados
- [x] Juego funciona igual que antes

---

## 🎯 Resumen: Qué Es Nuevo vs Qué No Cambió

### NUEVO (Laboratorio)
```
✅ Logger Winston central
✅ Middleware Morgan para HTTP
✅ Rutas /users, /users/:id (prueba)
✅ Endpoint /logs/resumen
✅ Script npm run logs:read
✅ Carpeta backend/logs con rotación
✅ Logs en BD, TCP, UDP
✅ Manejo 404/500 con logs
```

### SIN CAMBIOS (Juego)
```
✓ Lógica del juego (Socket.IO)
✓ Usuarios y partidas (MySQL)
✓ Motor de juego (TCP Bridge)
✓ OAuth Google
✓ UDP Monitor
✓ Todas las rutas de juego
```

**Resultado: Laboratorio de logs completo + juego funcionando normalmente.**

