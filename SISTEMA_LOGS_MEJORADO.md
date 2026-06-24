# 📊 Sistema Mejorado de Logs

## Cambios Implementados

### 1. **Logging de Acceso a Rutas HTTP**
Ahora TODOS los accesos a rutas HTTP se registran automáticamente con:
- ✅ Usuario autenticado (o "ANONIMO")
- ✅ Método HTTP (GET, POST, PUT, DELETE, etc.)
- ✅ Ruta completa accedida
- ✅ Código de estado HTTP (200, 404, 500, etc.)
- ✅ Duración de la solicitud (en ms)
- ✅ Éxito o error

**Archivos modificados:**
- `backend/logger/routeAccessLogger.js` (NUEVO)
- `backend/logger/morganMiddleware.js` (MEJORADO)
- `backend/main-server.js` (Integración)

### 2. **Logging de Errores HTTP (4xx, 5xx)**
Middleware dedicado que captura y registra todos los errores con:
- ✅ Usuario asociado
- ✅ Ruta donde ocurrió el error
- ✅ Método HTTP
- ✅ Código de estado
- ✅ Mensaje de error
- ✅ Stack trace (en desarrollo)

**Archivo nuevo:**
- `backend/logger/errorLogger.js`

### 3. **Eventos WebSocket Mejorados**
Se han mejorado los logs de eventos críticos:
- ✅ `[WS_REGISTRO_EXITOSO]` - Registro exitoso
- ✅ `[WS_REGISTRO_ERROR]` - Intento fallido de registro
- ✅ `[WS_LOGIN_EXITOSO]` - Login exitoso
- ✅ `[WS_LOGIN_ERROR]` - Intento fallido de login
- ✅ `[WS_SALDO_RECARGADO]` - Recarga de saldo exitosa
- ✅ `[WS_SALDO_ERROR]` - Error al recargar saldo
- ✅ `[WS_PARTIDA_CREADA]` - Partida creada exitosamente
- ✅ `[WS_CREAR_PARTIDA_ERROR]` - Error al crear partida
- ✅ `[WS_USUARIO_UNIDO_SALA]` - Usuario se unió a sala
- ✅ `[WS_ACEPTAR_PARTIDA_ERROR]` - Error al aceptar partida
- ✅ `[WS_JUEGO_INICIADO]` - Juego iniciado con 4 jugadores
- ✅ `[WS_JUGAR_CARTA_ERROR]` - Error al jugar carta

### 4. **Rutas Nuevas para Consultar Logs**

#### `GET /logs/resumen`
Resumen general de todos los logs (niveles: INFO, WARN, ERROR, DEBUG, HTTP)

```bash
curl http://localhost:3000/logs/resumen
```

Respuesta:
```json
{
  "success": true,
  "source": "application-2026-06-24.log",
  "summary": {
    "INFO": 45,
    "WARN": 12,
    "ERROR": 3,
    "HTTP": 78,
    "DEBUG": 5
  }
}
```

---

#### `GET /logs/accesos?usuario=USERNAME&tipo=exitoso`
Todos los accesos a rutas (exitosos, errores, todos)

**Parámetros:**
- `usuario` (opcional): Filtrar por usuario específico
- `tipo` (opcional): `exitoso` | `error` | `todos` (default: `todos`)

```bash
# Todos los accesos
curl http://localhost:3000/logs/accesos

# Accesos de un usuario específico
curl "http://localhost:3000/logs/accesos?usuario=USUARIO:123"

# Solo errores
curl "http://localhost:3000/logs/accesos?tipo=error"

# Accesos exitosos de un usuario
curl "http://localhost:3000/logs/accesos?usuario=USUARIO:123&tipo=exitoso"
```

Respuesta:
```json
{
  "success": true,
  "filtros": {
    "usuario": "USUARIO:123",
    "tipo": "todos"
  },
  "total": 42,
  "accesos": [
    {
      "timestamp": "2026-06-24 14:30:45",
      "usuario": "USUARIO:123",
      "metodo": "POST",
      "ruta": "/users/123",
      "status": 200,
      "duracion": 45,
      "exito": true,
      "error": false
    },
    {
      "timestamp": "2026-06-24 14:31:12",
      "usuario": "USUARIO:123",
      "metodo": "GET",
      "ruta": "/logs/accesos",
      "status": 200,
      "duracion": 120,
      "exito": true,
      "error": false
    },
    {
      "timestamp": "2026-06-24 14:32:55",
      "usuario": "USUARIO:123",
      "metodo": "POST",
      "ruta": "/auth/me",
      "status": 401,
      "duracion": 8,
      "exito": false,
      "error": true
    }
  ]
}
```

---

#### `GET /logs/errores?usuario=USERNAME`
Solo errores y accesos fallidos (últimos 50)

**Parámetros:**
- `usuario` (opcional): Filtrar por usuario específico

```bash
# Todos los errores
curl http://localhost:3000/logs/errores

# Errores de un usuario específico
curl "http://localhost:3000/logs/errores?usuario=USUARIO:123"
```

Respuesta:
```json
{
  "success": true,
  "usuario_filtro": "TODOS",
  "total": 3,
  "errores": [
    {
      "timestamp": "2026-06-24 14:32:55",
      "usuario": "USUARIO:123",
      "ruta": "/auth/me",
      "status": 401,
      "mensaje": "[ERROR_ACCESO] Usuario: USUARIO:123 | Método: POST | Ruta: /auth/me | Status: 401 | 8ms"
    },
    {
      "timestamp": "2026-06-24 14:35:20",
      "usuario": "USUARIO:456",
      "ruta": "/users/invalidid",
      "status": 400,
      "mensaje": "[ERROR_ACCESO] Usuario: USUARIO:456 | Método: GET | Ruta: /users/invalidid | Status: 400 | 15ms"
    }
  ]
}
```

---

#### `GET /logs/usuario/:username`
Todos los accesos y errores de un usuario específico

```bash
curl http://localhost:3000/logs/usuario/USUARIO:123
```

Respuesta:
```json
{
  "success": true,
  "usuario": "USUARIO:123",
  "resumen": {
    "total_accesos": 42,
    "total_errores": 3
  },
  "accesos": [
    {
      "timestamp": "2026-06-24 14:30:45",
      "nivel": "INFO",
      "detalles": "[ACCESO] Usuario: USUARIO:123 | Método: POST | Ruta: /users/123 | Status: 200 | 45ms"
    }
  ],
  "errores": [
    {
      "timestamp": "2026-06-24 14:32:55",
      "nivel": "ERROR",
      "mensaje": "[ERROR_ACCESO] Usuario: USUARIO:123 | Método: POST | Ruta: /auth/me | Status: 401 | 8ms"
    }
  ]
}
```

---

## 📁 Archivos de Logs

Los logs se guardan en: `backend/logs/`

### Archivos generados:
- **application-YYYY-MM-DD.log** - Logs de la aplicación (rotación diaria, máx 14 días)
- **errors-YYYY-MM-DD.log** - Solo errores (rotación diaria, máx 30 días)

Cada archivo es comprimido automáticamente después de 20MB.

---

## 📌 Formatos de Log

### Acceso Exitoso:
```
[2026-06-24 14:30:45] [INFO] [ACCESO] Usuario: USUARIO:123 | Método: POST | Ruta: /users/123 | Status: 200 | 45ms
```

### Acceso Fallido (Error):
```
[2026-06-24 14:32:55] [ERROR] [ERROR_ACCESO] Usuario: USUARIO:123 | Método: POST | Ruta: /auth/me | Status: 401 | 8ms
```

### Evento WebSocket - Login Exitoso:
```
[2026-06-24 14:35:20] [INFO] [WS_LOGIN_EXITOSO] Usuario: alice (ID: 5) | Socket: abc123def
```

### Evento WebSocket - Login Error:
```
[2026-06-24 14:36:10] [WARN] [WS_LOGIN_ERROR] Intento fallido de login. Usuario: bob | Socket: xyz789 | Error: Usuario o contraseña incorrectos
```

### Evento WebSocket - Partida Creada:
```
[2026-06-24 14:40:15] [INFO] [WS_PARTIDA_CREADA] Usuario: alice | SessionID: sess_12345 | Monto: 100
```

---

## 🔍 Ejemplos de Uso

### Analizar actividad de un usuario:
```bash
curl "http://localhost:3000/logs/usuario/USUARIO:123"
```

### Ver solo intentos fallidos:
```bash
curl "http://localhost:3000/logs/errores"
```

### Monitorear errores en tiempo real:
```bash
# Ver errores cada 5 segundos
watch -n 5 'curl http://localhost:3000/logs/errores'
```

### Obtener estadísticas:
```bash
curl http://localhost:3000/logs/resumen | jq '.summary'
```

---

## ✨ Beneficios

✅ **Auditoría completa**: Todos los accesos quedan registrados  
✅ **Detección de errores**: Errores capturados automáticamente  
✅ **Trazabilidad de usuario**: Seguir actividad por usuario  
✅ **Seguridad**: Registrar intentos fallidos de acceso  
✅ **Performance**: Ver duración de cada solicitud  
✅ **Debugging**: Identificar rápidamente problemas  
✅ **Cumplimiento**: Auditoría para requisitos regulatorios  

---

## 🛠 Mantenimiento

Los logs rotan automáticamente:
- **application-*.log**: Se crea uno nuevo cada día, se comprimen después de 14 días
- **errors-*.log**: Se crea uno nuevo cada día, se comprimen después de 30 días

Para limpiar logs antiguos:
```bash
# Ver tamaño de logs
du -sh backend/logs/

# Los archivos .gz se eliminan automáticamente después del período configurado
```
