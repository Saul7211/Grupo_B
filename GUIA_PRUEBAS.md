# Guía de Pruebas - Juego 40

## 🚀 ANTES DE EMPEZAR

### Requisitos:
- [x] Node.js instalado
- [x] MySQL ejecutándose en localhost:3306
- [x] Base de datos `juego_40` creada
- [x] Todas las dependencias instaladas

### Arrancar el proyecto:

**Terminal 1 - Backend**
```bash
cd backend
npm install  # Si no está instalado
node main-server.js
# Esperado: "SERVIDOR ACTIVO → Puerto: 3000"
```

**Terminal 2 - Game Engine**
```bash
cd game-engine
npm install  # Si no está instalado
node engine-server.js
# Esperado: "Game engine listening on port 5000"
```

**Terminal 3 - Frontend (Servidor web)**
```bash
cd frontend
# Opción A: Python
python -m http.server 8000

# Opción B: Node http-server
npx http-server . -p 8000
```

Luego abrir: http://localhost:8000/login.html

---

## ✅ PRUEBA 1: CAPTURA POR SUMA

### Escenario: Dos jugadores, captura 3+4=7

**Preparación:**
1. Abrir 2 navegadores (o 2 pestañas incógnito)
2. Registrar 2 usuarios:
   - Usuario 1: `player1` / `pass1`
   - Usuario 2: `player2` / `pass2`
3. Crear una partida con $10 en el Usuario 1
4. Unirse con el Usuario 2
5. Esperar a que 3 usuarios más se unan (si es necesario, usar 2 jugadores para prueba simplificada)

**Prueba:**

**Paso 1: Juegue Usuario 1**
- Selecciona cualquier carta
- No selecciona nada de la mesa
- Presiona "Jugar carta"
- ✅ La carta debe colocarse en la mesa

**Paso 2: Mesa debería tener al menos [3, 4]**
- Si no, continue jugando hasta tener estas cartas en la mesa

**Paso 3: Jugada de captura**
- Usuario con carta 7 en mano:
  - Selecciona 7
  - Selecciona las cartas 3 y 4 de la mesa
  - Presiona "Jugar carta"
  - ✅ Debe capturar las 3 cartas
  - ✅ Mensaje en consola: `Captura por suma: 3+4 = 7`

**Validaciones:**
```javascript
// Abrir consola del navegador (F12 → Console)
// Debería ver:
✅ Captura por suma: 3+4 = 7
JUGADA VÁLIDA ENVIADA AL BACKEND:
  Carta jugada: 7♥
  Cartas capturadas: 3♦, 4♠
  Suma: 7
```

**Resultado esperado:**
- ✅ Las 3 cartas desaparecen de la mesa
- ✅ El contador de "Perros" aumenta para el equipo
- ✅ El turno pasa al siguiente jugador

---

## ✅ PRUEBA 2: CAPTURA POR IGUALDAD

### Escenario: Capturar cartas del mismo rango

**Paso 1: Poner cartas en la mesa**
- Juegue hasta que haya al menos 2 cartas del mismo rango en la mesa
- Ej: [5♦, 5♠]

**Paso 2: Captura por igualdad**
- Jugador con 5 en mano:
  - Selecciona 5
  - Selecciona 5♦ y 5♠ de la mesa
  - Presiona "Jugar carta"
  - ✅ Debe mostrar: `Captura por igualdad (5)`

**Resultado esperado:**
- ✅ Las 3 cartas se capturan
- ✅ Se asignan puntos por "CAÍDA"

---

## ✅ PRUEBA 3: CAPTURA INVÁLIDA

### Escenario: Intentar capturar con suma incorrecta

**Paso 1: En la mesa hay [3♦, 4♠]**

**Paso 2: Intenta captura inválida**
- Selecciona 8 (J)
- Selecciona 3♦ + 4♠
- Presiona "Jugar carta"
- ✅ Debe mostrar error: `La suma (7) no coincide con el valor de la carta (8)`

**Resultado esperado:**
- ❌ No se envía la jugada
- ✅ Se muestra alerta explicando el error
- ✅ Las cartas siguen seleccionadas para reintentarlas

---

## ⚠️ PRUEBA 4: DESCONEXIÓN Y RECONEXIÓN

### Escenario: Jugador se desconecta y reconecta

**Paso 1: Simular desconexión**
- En navegador del Usuario 1:
  - Abrir DevTools (F12)
  - Tab "Network"
  - Hacer click en el icono de stop para desconectar red
  - O simplemente cerrar la pestaña

**Resultado esperado en Browser del Usuario 2:**
```
⚠️ Notificación roja: "El usuario se desconectó. Esperando 40 segundos..."
Countdown: 40, 39, 38...
```

**Verificaciones:**
- ✅ Notificación aparece en la parte superior
- ✅ Countdown decrementa cada segundo
- ✅ Otros jugadores pueden seguir jugando
- ✅ Turno no cambia si es del usuario desconectado

**Paso 2: Reconectar antes de 40 segundos**
- Usuario 1 se refresca o reconecta
- Ingresa login nuevamente
- ✅ Debe ver la sesión activa

**Resultado esperado en Browser del Usuario 2:**
```
✅ Notificación verde: "El usuario se reconectó"
(La notificación desaparece después de 2 segundos)
```

**Verificaciones:**
- ✅ Notificación roja desaparece
- ✅ Notificación verde aparece
- ✅ Usuario 1 se reintegra con su estado
- ✅ La partida continúa normalmente

---

## 🔴 PRUEBA 5: TIMEOUT DE 40 SEGUNDOS

### Escenario: Jugador NO se reconecta en 40 segundos

**Paso 1: Simular desconexión (igual que Prueba 4)**

**Paso 2: Esperar 40 segundos**
- NO reconectar al Usuario 1
- Dejar que pasen los 40 segundos completos

**Resultado esperado en Browser del Usuario 2:**
```
ALERT: "La partida ha finalizado
El jugador X no se reconectó en 40 segundos.
La partida ha sido cerrada por inactividad."

Redirección a: lobby.html (automática)
```

**Verificaciones:**
- ✅ Countdown llega a 0
- ✅ Alerta se muestra
- ✅ Se limpia localStorage
- ✅ Se redirige a lobby.html
- ✅ Todos los jugadores ven el mensaje

---

## 🧪 PRUEBA 6: BOTÓN "LIMPIAR SELECCIÓN"

**Paso 1: Seleccionar carta y capturas**
- Selecciona una carta de tu mano
- Selecciona 2-3 cartas de la mesa

**Paso 2: Presiona "Limpiar selección"**
- ✅ La carta ya no está resaltada
- ✅ Las cartas de la mesa ya no están seleccionadas
- ✅ `console.log` muestra: "Selección limpiada"

**Resultado esperado:**
- ✅ Puedes hacer nueva selección
- ✅ Los estilos de selección se removen

---

## 📊 PRUEBA 7: VALIDACIÓN ANTES DE ENVIAR

**Paso 1: Sin carta seleccionada**
- Intenta presionar "Jugar carta" sin seleccionar nada
- ✅ Debe mostrar: "Selecciona una carta de tu mano"

**Paso 2: Con captura inválida**
- Selecciona carta
- Selecciona cartas que no suman igual
- ✅ Debe mostrar error de suma

**Resultado esperado:**
- ✅ Se valida ANTES de enviar al backend
- ✅ Mensajes claros en español
- ✅ No se gasta tiempo de servidor en validaciones inválidas

---

## 🔍 DEBUGGING - CONSOLE LOGS

### Abrir la consola del navegador:
```
F12 → Tab "Console"
```

### Logs esperados al jugar:

**Jugada válida:**
```javascript
Suma seleccionada: 7 | Valor carta jugada: 7
✅ Captura por suma: 3+4 = 7
JUGADA VÁLIDA ENVIADA AL BACKEND:
  Carta jugada: 7♥
  Cartas capturadas: 3♦, 4♠
  Suma: 7
```

**Desconexión:**
```javascript
⚠️ [DESCONEXIÓN] El usuario se desconectó. Esperando...
```

**Reconexión:**
```javascript
✅ [RECONEXIÓN] El usuario se ha reconectado
```

---

## ⚡ ATAJOS ÚTILES

### Para crear usuarios rápido en consola:
```javascript
registrar("player1", "pass1")
registrar("player2", "pass2")
registrar("player3", "pass3")
registrar("player4", "pass4")
```

### Para hacer login:
```javascript
login("player1", "pass1")
```

### Para crear partida:
```javascript
crearPartida(10)  // Apuesta de $10
```

### Para unirse a partida:
```javascript
aceptarPartida("CODIGO_SALA")
```

---

## ✅ CHECKLIST FINAL

### Captura por Suma
- [ ] Sumar 2 cartas correctamente (3+4=7)
- [ ] Sumar 3+ cartas correctamente (2+3+2=7)
- [ ] Mostrar error si suma no coincide
- [ ] Capturar 1 carta si su valor coincide (7=7)
- [ ] Mostrar mensaje claro en consola

### Desconexión/Reconexión
- [ ] Notificación roja al desconectar
- [ ] Countdown de 40 segundos funciona
- [ ] Reconexión antes de 40s funciona
- [ ] Notificación verde muestra reconexión
- [ ] Sesión cierra después de 40s si no reconecta
- [ ] Todos ven las notificaciones

### UI/UX
- [ ] Botón "Limpiar selección" funciona
- [ ] Cartas resaltadas visiblemente
- [ ] Mensajes de error son claros
- [ ] Animaciones son suaves

---

## 🚨 POSIBLES PROBLEMAS Y SOLUCIONES

**Problema:** "Conexión rechazada al puerto 3000"
- Solución: Verificar que el backend esté ejecutándose

**Problema:** "Sesión no encontrada"
- Solución: Asegurarse de crear la sala antes de unirse

**Problema:** "La suma no se valida correctamente"
- Solución: Verificar que los valores de CARD_VALUES sean correctos

**Problema:** "No aparece la notificación de desconexión"
- Solución: Abrir consola para verificar eventos de Socket.io

---

## 📞 CONTACTO PARA PROBLEMAS

Si hay problemas:
1. Abrir consola del navegador (F12)
2. Ir a tab "Console" y buscar errores
3. Ir a tab "Network" → "WS" para ver eventos Socket.io
4. Revisar logs del servidor en la terminal
