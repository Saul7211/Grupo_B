# Features Implementadas - Juego 40

## ✅ 1. CAPTURA POR SUMA (Cartas)

### Funcionamiento:
- Cuando un jugador lanza una carta, puede capturar cartas de la mesa cuyo **valor sumado sea igual** al valor de su carta jugada.

### Ejemplo:
```
Mesa tiene: [3♦, 4♠]
Jugador tiene: 7♥
Acción: Selecciona 3♦ + 4♠ (suma = 7) y lanza 7♥
Resultado: ✅ Captura exitosa → Las 3 cartas (3, 4, 7) van al cartón del equipo
```

### Valores de cartas:
- A = 1
- 2 = 2
- 3 = 3
- 4 = 4
- 5 = 5
- 6 = 6
- 7 = 7
- J = 8
- Q = 9
- K = 10

### Implementación en Backend (main-server.js):
El evento `jugar_carta` envía los datos al motor:
```javascript
socket.on('jugar_carta', async ({ userId, sessionId, card, capture }) => {
    enviarAlMotor({
        action: 'PLAY_CARD',
        sessionId,
        playerId: userId,
        card,
        capture: capture || []  // Array de IDs de cartas seleccionadas
    }, io);
});
```

### Implementación en Game Engine (engine-server.js):
1. **Validación**: Verifica que la suma de las cartas seleccionadas = valor de la carta jugada
2. **Captura**: Remueve las cartas de la mesa y las suma al "cartón" del equipo
3. **Puntos**: 
   - Caída (por igualdad): 2 puntos (si todas son del mismo rango)
   - Limpia (mesa vacía): 2 puntos
   - Caída + Limpia: 2 puntos

---

## ✅ 2. TIMEOUT DE 40 SEGUNDOS (Desconexión)

### Funcionamiento:
Cuando un jugador se desconecta o cierra sesión:
1. Se inicia un contador de **40 segundos**
2. Se notifica a otros jugadores sobre la desconexión
3. Si el jugador **se reconecta dentro de 40 segundos**: Se cancela el timeout ✅
4. Si **pasan los 40 segundos sin reconexión**: Se cierra la sesión para TODOS 🔴

### Eventos emitidos:

#### Desconexión:
```json
{
  "event": "jugador_desconectado",
  "data": {
    "sessionId": "xxxxx",
    "userId": "user123",
    "mensaje": "El usuario user123 se desconectó. Esperando 40 segundos para reintento..."
  }
}
```

#### Reconexión exitosa:
```json
{
  "event": "jugador_reconectado",
  "data": {
    "sessionId": "xxxxx",
    "userId": "user123",
    "mensaje": "El usuario user123 se ha reconectado"
  }
}
```

#### Timeout (Sesión cerrada):
```json
{
  "event": "sesion_cerrada",
  "data": {
    "sessionId": "xxxxx",
    "razón": "El jugador user123 no se reconectó en 40 segundos.",
    "mensaje": "La partida ha sido cerrada por inactividad."
  }
}
```

### Implementación en Backend (main-server.js):

#### En `aceptar_partida`:
- Se registra al usuario en `jugadoresEnPartida` Map
- Se almacena sessionId y socketId

#### En `login_usuario`:
- Se verifica si hay un timeout pendiente
- Si existe: Se cancela y se reconecta al jugador ✅

#### En evento `disconnect`:
- Se inicia un timeout de 40 segundos (DESCONEXION_TIMEOUT)
- Si se agota: Se cierra la sesión para todos

### Variables globales:
```javascript
const jugadoresEnPartida = new Map(); // userId → { sessionId, socketId, timeoutId }
const DESCONEXION_TIMEOUT = 40000; // 40 segundos en milisegundos
```

---

## 📋 Checklist para el Frontend

### Para Captura por Suma:
- [ ] Permitir selección múltiple de cartas en la mesa
- [ ] Validar suma antes de enviar al servidor
- [ ] Mostrar suma en tiempo real mientras se seleccionan cartas
- [ ] Enviar solo los IDs de las cartas seleccionadas

### Para Reconexión:
- [ ] Guardar sessionId y userId en localStorage
- [ ] En login, enviar sessionId para reconectar
- [ ] Escuchar evento `jugador_desconectado`
- [ ] Escuchar evento `jugador_reconectado`
- [ ] Escuchar evento `sesion_cerrada`
- [ ] Mostrar contador de 40 segundos si se desconecta

---

## 🚀 Próximas mejoras (Opcionales):
- [ ] Animación de captura de cartas
- [ ] Sonido de captura
- [ ] Estadísticas de capturas por tipo
- [ ] Replay de la sesión después de cierre por timeout

---

## ✅ 3. IMPLEMENTACIÓN EN FRONTEND (socket-client.js)

### Captura por Suma - UI

**Funciones implementadas:**
```javascript
calculateCardSum(cards)
  → Calcula la suma total del valor de las cartas

validateCapture(playedCard, captureCards)
  → Valida si la captura es correcta
  → Retorna: { isValid, message, type }

updateCaptureSumIndicator()
  → Actualiza el indicador de suma en tiempo real
```

**Flujo en la UI:**
1. Usuario selecciona una carta de su mano → Se resalta en amarillo
2. Usuario selecciona cartas de la mesa → Se amplifican y resaltan
3. Usuario presiona "Jugar carta"
4. Se valida la captura automáticamente:
   - Si suma es correcta ✅ → Se envía al backend
   - Si suma es incorrecta ❌ → Muestra error con la suma correcta esperada
5. Se limpian las selecciones después de jugar

**Botón "Limpiar selección":**
- Limpia la carta seleccionada y las capturas
- Remueve los estilos de selección
- Permite reintentar

### Reconexión con Timeout - UI

**Eventos escuchados:**
```javascript
socket.on("jugador_desconectado", (data) => {
  // Mostrar notificación roja
  // Iniciar countdown de 40 segundos
  // Otros jugadores ven la advertencia
})

socket.on("jugador_reconectado", (data) => {
  // Remover notificación roja
  // Mostrar notificación verde
  // Continuar partida normalmente
})

socket.on("sesion_cerrada", (data) => {
  // Limpiar localStorage
  // Mostrar alert
  // Redirigir a lobby.html
})
```

**Notificaciones visuales:**
- **Roja (Desconexión)**: Muestra nombre del jugador + countdown
- **Verde (Reconexión)**: Confirma que el jugador volvió
- **Cierre**: Alert + redirección automática

**Reconexión mejorada:**
- Al hacer login, se envía `sessionId` automáticamente
- Backend valida y permite reconectar
- Timeout se cancela automáticamente
- Usuario se reintegra a la partida sin perder el estado

### Estilos CSS agregados:

```css
.disconnection-warning      /* Notificación de desconexión (rojo) */
.reconnection-success       /* Notificación de reconexión (verde) */
.your-turn-banner           /* Banner de turno (púrpura) */

@keyframes slide-down        /* Animar entrada suave */
@keyframes pulse-turn        /* Pulso en indicador de turno */
@keyframes turn-slide        /* Deslizamiento de banner */
@keyframes highlight-hand    /* Resaltar mano del usuario */
```

### Variables globales:

```javascript
let disconnectionTimeout = null;      // Timer principal de 40s
let disconnectionCountdown = null;    // Intervalo del countdown
const CARD_VALUES = {                 // Valores para cálculo de suma
  'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, 
  '7': 7, 'J': 8, 'Q': 9, 'K': 10
}
```

---

## 📋 STATUS DE IMPLEMENTACIÓN

### Backend ✅ Completado
- [x] Timeout de 40 segundos en desconexión
- [x] Reconexión inteligente
- [x] Validación de captura por suma
- [x] Eventos broadcast a jugadores
- [x] Cierre automático de sesión

### Frontend ✅ Completado
- [x] Validación visual de captura
- [x] Cálculo de suma en tiempo real
- [x] Listeners para eventos de desconexión
- [x] Notificaciones visuales con countdown
- [x] Reconexión automática en login
- [x] Estilos CSS para notificaciones
- [x] Botón "Limpiar selección"
- [x] Mensajes de error descriptivos

### Documentación ✅ Completada
- [x] FEATURES_IMPLEMENTADAS.md
- [x] FRONTEND_GUIA.md (completa con ejemplos)

---

## 🎯 PRÓXIMOS PASOS (Opcionales)

1. **Testing real:**
   - Probar captura por suma con diferentes combinaciones
   - Simular desconexión real
   - Verificar cierre de sesión después de 40s

2. **Mejoras visuales:**
   - Animación de cartas siendo capturadas
   - Sonido al capturar
   - Indicador visual de suma sobre las cartas

3. **Estadísticas:**
   - Contar capturas por tipo (suma vs igualdad)
   - Mostrar en partida y al final
