# Guía Completa: Sistema de Logs Implementado

## 🏗️ Arquitectura del Sistema de Logs

```
┌─────────────────────────────────────────────────────────────────┐
│                    SERVIDOR BACKEND                            │
│                  (main-server.js)                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  EXPRESS APP                                             │  │
│  │  ├─ morgan (Middleware HTTP)                             │  │
│  │  │   ↓ Captura: [método] [ruta] [status] [tiempo]       │  │
│  │  │   ↓ Envía a Winston logger.http()                     │  │
│  │  │                                                        │  │
│  │  ├─ GET /                    → Respuesta JSON            │  │
│  │  ├─ GET /users              → Genera log INFO            │  │
│  │  ├─ GET /users/:id          → Genera log DEBUG/WARN      │  │
│  │  ├─ GET /logs/resumen       → Lee y resume logs          │  │
│  │  │                                                        │  │
│  │  ├─ Rutas OAuth (Google)    → Logs INFO en socket.io    │  │
│  │  ├─ WebSocket (Socket.IO)   → Logs INFO/WARN/ERROR      │  │
│  │  │                                                        │  │
│  │  └─ Error handlers (404/500) → Logs WARN/ERROR          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  WINSTON LOGGER                                          │  │
│  │  ├─ Console (colorizado)                                 │  │
│  │  ├─ DailyRotateFile → application-YYYY-MM-DD.log        │  │
│  │  │   ├─ Niveles: INFO, DEBUG, HTTP                       │  │
│  │  │   ├─ Máx 20MB por archivo                             │  │
│  │  │   └─ Retiene 14 días                                  │  │
│  │  └─ DailyRotateFile → errors-YYYY-MM-DD.log             │  │
│  │      ├─ Niveles: ERROR, WARN                             │  │
│  │      ├─ Máx 20MB por archivo                             │  │
│  │      └─ Retiene 30 días                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Carpeta: backend/logs/                                  │  │
│  │  └─ Archivos .log con timestamp [HH:MM:SS]              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📋 Niveles de Log Usados

| Nivel  | Color   | Archivo               | Casos de Uso                           |
|--------|---------|----------------------|----------------------------------------|
| INFO   | Azul    | application-*.log    | Conexiones WebSocket, usuarios OK      |
| DEBUG  | Gris    | application-*.log    | Detalles de emisión a sesiones         |
| HTTP   | Verde   | application-*.log    | Requests HTTP (Morgan)                 |
| WARN   | Amarillo| application-*.log    | Usuario no válido, 404, socket inválido|
| ERROR  | Rojo    | errors-*.log         | Errores de BD, conexión motor, timeout |

---

## 🚀 Paso 1: Arrancar el Proyecto Completo

### Terminal 1: Backend con Logs
```bash
cd backend
npm install              # Solo si es primera vez
npm start               # O: node main-server.js
```

**Esperado en consola:**
```
[2026-06-21 14:30:45] [INFO] Conexion a MySQL exitosa.
[2026-06-21 14:30:46] [INFO] [UDP Monitor] Servidor UDP activo en 127.0.0.1:54322
[2026-06-21 14:30:46] [INFO] SERVIDOR ACTIVO -> Puerto: 3000
[2026-06-21 14:30:46] [INFO] BASE DE DATOS -> juego_40
```

**Archivo de log generado:** `backend/logs/application-2026-06-21.log`

### Terminal 2: Motor de Juego (como siempre)
```bash
cd game-engine
npm install              # Solo si es primera vez
node engine-server.js
```

**Esperado:**
```
Game engine listening on port 5000
```

### Terminal 3: Frontend (servidor web)
```bash
cd frontend
python -m http.server 8000
# o: npx http-server . -p 8000
```

**Abrir navegador:** http://localhost:8000/login.html

---

## 🧪 Paso 2: Probar Rutas de Logs del Laboratorio

### Abrir Postman o usar curl en una 4ª Terminal

**2.1 - Listar usuarios (genera log INFO)**
```bash
curl -X GET http://localhost:3000/users
```

**Respuesta esperada:**
```json
{
  "success": true,
  "message": "Ruta de prueba de usuarios",
  "users": [
    { "id": 1, "username": "alice" },
    { "id": 2, "username": "bob" }
  ]
}
```

**Log generado en console:**
```
[2026-06-21 14:31:12] [HTTP] GET /users 200 2.5 ms
[2026-06-21 14:31:12] [INFO] Consulta general de usuarios
```

**En archivo `backend/logs/application-2026-06-21.log`:**
```
[2026-06-21 14:31:12] [HTTP] GET /users 200 2.5 ms
[2026-06-21 14:31:12] [INFO] Consulta general de usuarios
```

---

### 2.2 - Obtener usuario por ID válido (genera log DEBUG)
```bash
curl -X GET http://localhost:3000/users/5
```

**Respuesta:**
```json
{
  "success": true,
  "user": { "id": 5, "username": "user_5" }
}
```

**Logs generados:**
```
[2026-06-21 14:31:15] [HTTP] GET /users/5 200 1.2 ms
[2026-06-21 14:31:15] [DEBUG] Consulta de usuario por id: 5
```

---

### 2.3 - ID inválido (genera log WARN)
```bash
curl -X GET http://localhost:3000/users/abc
```

**Respuesta:**
```json
{ "success": false, "message": "ID invalido" }
```

**Logs:**
```
[2026-06-21 14:31:18] [HTTP] GET /users/abc 400 0.8 ms
[2026-06-21 14:31:18] [WARN] ID invalido recibido en /users/:id -> abc
```

---

### 2.4 - ID prohibido 99 (genera log ERROR)
```bash
curl -X GET http://localhost:3000/users/99
```

**Respuesta:**
```json
{ "success": false, "message": "Error simulado para laboratorio" }
```

**Logs:**
```
[2026-06-21 14:31:21] [HTTP] GET /users/99 500 0.6 ms
[2026-06-21 14:31:21] [ERROR] Error simulado para ID prohibido 99
```

**También se registra en `backend/logs/errors-2026-06-21.log`:**
```
[2026-06-21 14:31:21] [ERROR] Error simulado para ID prohibido 99
```

---

### 2.5 - Ruta no encontrada (genera log WARN)
```bash
curl -X GET http://localhost:3000/ruta-inexistente
```

**Respuesta:**
```json
{ "success": false, "message": "Ruta no encontrada" }
```

**Logs:**
```
[2026-06-21 14:31:24] [HTTP] GET /ruta-inexistente 404 0.5 ms
[2026-06-21 14:31:24] [WARN] Ruta no encontrada: GET /ruta-inexistente
```

---

## 📊 Paso 3: Ver Resumen de Logs

### 3.1 - Endpoint /logs/resumen
```bash
curl -X GET http://localhost:3000/logs/resumen
```

**Respuesta (después de hacer varias requests):**
```json
{
  "success": true,
  "source": "application-2026-06-21.log",
  "summary": {
    "HTTP": 7,
    "INFO": 5,
    "DEBUG": 1,
    "WARN": 2,
    "ERROR": 1
  }
}
```

**Explicación:**
- HTTP: 7 requests HTTP procesados por Morgan
- INFO: 5 eventos de conexión/consulta
- DEBUG: 1 consulta de detalle
- WARN: 2 advertencias (ID inválido, ruta no encontrada)
- ERROR: 1 error simulado

---

### 3.2 - Script de lectura local
```bash
npm run logs:read
```

**Salida en consola:**
```
Archivo analizado: application-2026-06-21.log

HTTP  │ 7
INFO  │ 5
DEBUG │ 1
WARN  │ 2
ERROR │ 1
```

---

## 🎮 Paso 4: Juego Normal + Logs en Segundo Plano

### 4.1 - Registrar usuario (genera logs INFO)
En navegador http://localhost:8000/register.html:
- Username: `player1`
- Password: `pass1`
- Click "Registrarse"

**Logs en backend:**
```
[2026-06-21 14:32:00] [HTTP] POST /frontend/register.html 200 0.5 ms
[2026-06-21 14:32:05] [INFO] Cliente conectado via WebSocket: ...
```

### 4.2 - Login (genera logs INFO)
En navegador http://localhost:8000/login.html:
- Username: `player1`
- Password: `pass1`
- Click "Iniciar Sesión"

**Logs:**
```
[2026-06-21 14:32:10] [HTTP] POST /frontend/login.html 200 0.5 ms
[2026-06-21 14:32:15] [INFO] [IDENTIFICAR] Usuario xxxx en sesion yyyy -> socket zzz
```

### 4.3 - Crear partida (genera logs INFO)
En lobby.html:
- Apuesta: 10
- Click "Crear Partida"

**Logs:**
```
[2026-06-21 14:32:20] [INFO] [aceptar_partida] Partida yyy lista con 4 jugadores. Enviando al motor...
[2026-06-21 14:32:20] [INFO] [TCP Bridge] Conectado al Motor en 127.0.0.1:5000
[2026-06-21 14:32:20] [DEBUG] [TCP Bridge] El Motor respondio: {...}
```

### 4.4 - Desconexión (genera logs WARN/ERROR)
Cerrar navegador o desconectar red:

**Logs:**
```
[2026-06-21 14:32:25] [WARN] Cliente desconectado: socket_id_xxxx
[2026-06-21 14:32:25] [WARN] [DESCONEXION] Usuario yyyy desconectado de sesion zzz
[2026-06-21 14:32:30] [ERROR] [TIMEOUT] Usuario yyyy no se reconecto en 5 minutos. Cerrando sesion...
```

---

## 📁 Estructura de Carpetas Generada

```
backend/
├── logs/
│   ├── application-2026-06-21.log      ← INFO, DEBUG, HTTP, WARN
│   ├── errors-2026-06-21.log           ← ERROR, WARN (críticos)
│   ├── application-2026-06-20.log      ← Archivos de días anteriores
│   └── errors-2026-06-20.log
├── logger/
│   ├── index.js                        ← Logger central Winston
│   └── morganMiddleware.js             ← Middleware Morgan
├── routes/
│   ├── users.js                        ← Rutas de prueba
│   └── logs.js                         ← Endpoint /logs/resumen
├── utils/
│   └── logReader.js                    ← Script análisis local
├── main-server.js                      ← Servidor con logs integrados
├── database.js                         ← Logs de conexión BD
├── tcp-bridge.js                       ← Logs de conexión motor
├── udp-monitor.js                      ← Logs de monitoreo UDP
└── package.json                        ← Con scripts npm
```

---

## 🔍 Cómo Ver Logs en Tiempo Real

### Opción 1: En la consola del terminal
Simplemente ejecuta `npm start` y verás todos los logs coloreados en vivo.

### Opción 2: Leer archivo de log
```bash
# En Windows (PowerShell)
Get-Content backend/logs/application-2026-06-21.log -Tail 20 -Wait

# En Linux/Mac
tail -f backend/logs/application-2026-06-21.log
```

### Opción 3: Endpoint JSON
```bash
curl http://localhost:3000/logs/resumen
```

### Opción 4: Script local
```bash
npm run logs:read
```

---

## ✅ Checklist de Prueba Completo

- [ ] Terminal 1: Backend levantado sin errores
- [ ] Terminal 2: Motor levantado en puerto 5000
- [ ] Terminal 3: Frontend accesible en localhost:8000
- [ ] GET /users retorna datos y genera logs
- [ ] GET /users/5 genera DEBUG
- [ ] GET /users/abc genera WARN
- [ ] GET /users/99 genera ERROR
- [ ] GET /logs/resumen muestra resumen correcto
- [ ] npm run logs:read muestra tabla de conteos
- [ ] Archivo application-YYYY-MM-DD.log existe y tiene contenido
- [ ] Archivo errors-YYYY-MM-DD.log existe con errores
- [ ] Juego de cartas funciona normalmente sin interrupciones
- [ ] Logs de socket.io (WebSocket) aparecen al conectarse/jugar
- [ ] Al desconectarse, aparecen logs WARN/ERROR

---

## 🐛 Troubleshooting

### Problema: "No hay archivos de log disponibles"
**Causa:** El backend aún no generó logs.  
**Solución:** Haz al menos una request a /users para generar logs.

### Problema: "Error de conexión a MySQL"
**Causa:** BD no está ejecutándose.  
**Solución:** Inicia MySQL y verifica .env en backend/.

### Problema: "Error de conexión al Motor"
**Causa:** Engine-server.js no está corriendo en puerto 5000.  
**Solución:** Inicia game-engine/engine-server.js en Terminal 2.

### Problema: Logs no se ven en consola pero sí en archivo
**Causa:** Winston escribe primero a archivo, luego a consola.  
**Solución:** Es comportamiento normal. Espera 1-2 segundos o redirige stderr.

### Problema: El juego no responde
**Causa:** Logs están generando I/O masivo.  
**Solución:** Normal en desarrollo. En producción usa rotación más agresiva (10MB/día).

---

## 🎯 Resumen de Cambios Integrados

✅ Logger Winston + rotación diaria  
✅ Middleware Morgan para HTTP  
✅ Rutas de laboratorio (/users, /users/:id)  
✅ Endpoint /logs/resumen  
✅ Script análisis local (npm run logs:read)  
✅ Logs en socket.io/desconexiones  
✅ Logs en BD/TCP/UDP  
✅ Manejo de errores 404/500  
✅ **Todo sin romper el juego existente**  

