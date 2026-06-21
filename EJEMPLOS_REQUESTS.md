# Ejemplos de Requests Listos para Copiar/Pegar

Usa cualquiera de estos en Postman, curl, o navegador.

---

## 🧪 PRUEBAS DE RUTAS DEL LABORATORIO

### 1️⃣ GET /users - Lista de usuarios (INFO)
```
GET http://localhost:3000/users
```

**Respuesta esperada:**
```json
{
  "success": true,
  "message": "Ruta de prueba de usuarios",
  "users": [
    {"id": 1, "username": "alice"},
    {"id": 2, "username": "bob"}
  ]
}
```

**Logs generados:**
```
[HTTP] GET /users 200 2.5 ms
[INFO] Consulta general de usuarios
```

---

### 2️⃣ GET /users/5 - Usuario válido (DEBUG)
```
GET http://localhost:3000/users/5
```

**Respuesta:**
```json
{
  "success": true,
  "user": {"id": 5, "username": "user_5"}
}
```

**Logs:**
```
[HTTP] GET /users/5 200 1.2 ms
[DEBUG] Consulta de usuario por id: 5
```

---

### 3️⃣ GET /users/abc - ID inválido (WARN)
```
GET http://localhost:3000/users/abc
```

**Respuesta:**
```json
{"success": false, "message": "ID invalido"}
```

**Logs:**
```
[HTTP] GET /users/abc 400 0.8 ms
[WARN] ID invalido recibido en /users/:id -> abc
```

---

### 4️⃣ GET /users/99 - Error simulado (ERROR)
```
GET http://localhost:3000/users/99
```

**Respuesta:**
```json
{"success": false, "message": "Error simulado para laboratorio"}
```

**Logs:**
```
[HTTP] GET /users/99 500 0.6 ms
[ERROR] Error simulado para ID prohibido 99
```

**También se escribe en:** `backend/logs/errors-YYYY-MM-DD.log`

---

### 5️⃣ GET / - Endpoint raíz
```
GET http://localhost:3000/
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Backend del juego activo",
  "endpoints": ["/users", "/users/:id", "/logs/resumen"]
}
```

---

### 6️⃣ GET /logs/resumen - Resumen de logs (después de hacer requests)
```
GET http://localhost:3000/logs/resumen
```

**Respuesta esperada (después de hacer todas las requests arriba):**
```json
{
  "success": true,
  "source": "application-2026-06-21.log",
  "summary": {
    "HTTP": 5,
    "INFO": 1,
    "DEBUG": 1,
    "WARN": 1,
    "ERROR": 1
  }
}
```

**Explicación del resumen:**
- `HTTP: 5` → Morgan capturó 5 requests HTTP
- `INFO: 1` → 1 consulta general
- `DEBUG: 1` → 1 consulta de detalle
- `WARN: 1` → 1 ID inválido
- `ERROR: 1` → 1 error simulado

---

## 📝 Secuencia Recomendada de Prueba

1. **Abre Postman** (o usar curl)
2. **Haz estas requests en este orden:**
   ```
   ① GET /users
   ② GET /users/5
   ③ GET /users/10
   ④ GET /users/abc
   ⑤ GET /users/99
   ⑥ GET /logs/resumen  ← Verás el conteo final
   ```
3. **Abre otra terminal y ejecuta:**
   ```
   npm run logs:read
   ```
4. **Verifica los archivos de log:**
   ```
   backend/logs/application-YYYY-MM-DD.log
   backend/logs/errors-YYYY-MM-DD.log
   ```

---

## 🎮 Prueba Completa: Logs del Juego

Cuando juegues normalmente, se generan estos logs:

### Al conectar (Websocket)
```bash
# Request HTTP para cargar frontend
GET /frontend/login.html 200

# Evento Socket.IO
[INFO] Cliente conectado via WebSocket: socket_abc123
```

### Al hacer login
```
[HTTP] POST /api/login 200
[INFO] [IDENTIFICAR] Usuario user123 en sesion sess456 -> socket abc123
```

### Al crear partida
```
[INFO] [aceptar_partida] Partida sess456 lista con 4 jugadores. Enviando al motor...
[INFO] [TCP Bridge] Conectado al Motor en 127.0.0.1:5000
[DEBUG] [TCP Bridge] El Motor respondio: {...}
```

### Al desconectarse
```
[INFO] Cliente desconectado: socket_abc123
[WARN] [DESCONEXION] Usuario user123 desconectado de sesion sess456
```

### Si no reconecta en 5 minutos
```
[ERROR] [TIMEOUT] Usuario user123 no se reconecto en 5 minutos. Cerrando sesion...
```

---

## 🔧 Comandos Útiles

### Ver logs en tiempo real
```bash
# Windows PowerShell
Get-Content backend/logs/application-2026-06-21.log -Tail 20 -Wait

# Linux/Mac
tail -f backend/logs/application-2026-06-21.log
```

### Analizar logs localmente
```bash
npm run logs:read
```

### Reiniciar el servidor (Ctrl+C en terminal del backend, luego)
```bash
npm start
```

### Ver solo errores
```bash
# Windows
Select-String "\[ERROR\]" backend/logs/errors-*.log

# Linux/Mac
grep "\[ERROR\]" backend/logs/errors-*.log
```

---

## 📊 Estructura del Log Individual

Cada línea de log tiene este formato:

```
[TIMESTAMP] [LEVEL] Mensaje
```

Ejemplo real:
```
[2026-06-21 14:31:12] [HTTP] GET /users 200 2.5 ms
[2026-06-21 14:31:12] [INFO] Consulta general de usuarios
[2026-06-21 14:31:15] [DEBUG] Consulta de usuario por id: 5
[2026-06-21 14:31:18] [WARN] ID invalido recibido en /users/:id -> abc
[2026-06-21 14:31:21] [ERROR] Error simulado para ID prohibido 99
```

---

## ✅ Validación Final

Después de todas las pruebas, verifica:

- [ ] Archivo `backend/logs/application-2026-06-21.log` existe
- [ ] Archivo `backend/logs/errors-2026-06-21.log` existe y contiene errores
- [ ] `GET /logs/resumen` devuelve `summary` con conteos correctos
- [ ] `npm run logs:read` muestra tabla de conteos
- [ ] Console del backend muestra logs coloreados en vivo
- [ ] Juego sigue funcionando sin interrupciones
- [ ] WebSocket (Socket.IO) genera logs al conectarse/desconectarse

---

## 🎯 Qué Probaste

✅ Rutas REST del laboratorio  
✅ Generación de logs INFO/DEBUG/WARN/ERROR  
✅ Rotación diaria de archivos  
✅ Endpoint de resumen JSON  
✅ Script de análisis local  
✅ Morgan capturando HTTP  
✅ Winston escribiendo a 2 archivos  
✅ Todo integrado sin romper el juego  

