# Frontend - Guía de Uso e Implementación

## 🎮 CARACTERÍSTICAS IMPLEMENTADAS

### 1️⃣ CAPTURA POR SUMA (Sistema mejorado)

#### ¿Cómo funciona en la UI?

**Paso 1: Selecciona una carta de tu mano**
```
Haz clic en una de tus cartas (abajo)
La carta seleccionada brilla en amarillo
```

**Paso 2: Selecciona cartas de la mesa para capturar (Opcional)**
```
Haz clic en las cartas de la mesa que deseas capturar
Las cartas se amplifican y se resaltan
La suma se calcula automáticamente (visible en consola)
```

**Paso 3: Valida y juega**
```
Presiona "Jugar carta"
El sistema valida:
  ✅ Si no hay captura = Se coloca en la mesa
  ✅ Si suma = cartas capturadas → suma de la carta jugada
  ✅ Si igualdad = todas las cartas son del mismo rango
  ❌ Si no coinciden las sumas → Muestra error
```

#### Valores de cartas para la suma:
```
A  = 1     | 4  = 4     | 7  = 7     | Q  = 9
2  = 2     | 5  = 5     | J  = 8     | K  = 10
3  = 3     | 6  = 6     |
```

#### Ejemplos de capturas válidas:

```
EJEMPLO 1: Captura por suma
┌─────────────────────────────────────┐
│ Mesa: [3♦] [4♠]                     │
│ Juegas: 7♥                          │
│ Acción: Selecciona 3♦ + 4♠          │
│ Resultado: ✅ Suma = 3+4 = 7        │
│ → Las 3 cartas van al cartón        │
└─────────────────────────────────────┘

EJEMPLO 2: Captura por igualdad
┌─────────────────────────────────────┐
│ Mesa: [5♦] [5♣]                     │
│ Juegas: 5♥                          │
│ Acción: Selecciona 5♦ + 5♣          │
│ Resultado: ✅ CAÍDA - Igualdad      │
│ → Las 3 cartas van al cartón        │
└─────────────────────────────────────┘

EJEMPLO 3: Combinación compleja
┌─────────────────────────────────────┐
│ Mesa: [A♦] [2♠] [4♥] [K♣]           │
│ Juegas: 7♣                          │
│ Acción: Selecciona A♦ + 2♠ + 4♥     │
│ Cálculo: 1 + 2 + 4 = 7              │
│ Resultado: ✅ Captura por suma      │
│ → Las 4 cartas van al cartón        │
└─────────────────────────────────────┘
```

#### Funciones en JS (socket-client.js):

```javascript
// Calcular suma de cartas
calculateCardSum(cards) → number

// Validar captura
validateCapture(playedCard, captureCards) → {
  isValid: boolean,
  message: string,
  type: 'equal' | 'sum' | 'none'
}

// Actualizar indicador de suma (automático al seleccionar)
updateCaptureSumIndicator()
```

---

### 2️⃣ RECONEXIÓN CON TIMEOUT (40 segundos)

#### Flujo de desconexión/reconexión:

```
┌──────────────────────────────────────────────────────┐
│ USUARIO EN PARTIDA                                   │
└──────────────────────────────────────────────────────┘
                        │
                        ↓
        ⚠️ USUARIO SE DESCONECTA (disconnect)
                        │
                        ↓
┌──────────────────────────────────────────────────────┐
│ EVENTO: "jugador_desconectado"                       │
│ - Mostrar notificación roja en pantalla              │
│ - Iniciar countdown de 40 segundos                   │
│ - Otros jugadores ven la advertencia                 │
└──────────────────────────────────────────────────────┘
                        │
                ┌───────┴───────┐
                ↓               ↓
         ✅ RECONECTA    ❌ 40s VENCIDO
         dentro de 40s   sin reconectar
                ↓               ↓
      ┌─────────────┐   ┌──────────────┐
      │ RECONEXIÓN  │   │ SESIÓN       │
      │ EXITOSA     │   │ CERRADA      │
      │             │   │              │
      │ - Cancelar  │   │ - Alertar    │
      │   timeout   │   │   todos      │
      │ - Notif     │   │ - Limpiar    │
      │   verde     │   │   sesión     │
      │ - Continuar │   │ - Ir a lobby │
      │   partida   │   │              │
      └─────────────┘   └──────────────┘
```

#### Eventos escuchados:

**1. `jugador_desconectado`**
```javascript
{
  sessionId: "xxx",
  userId: "user123",
  mensaje: "El usuario X se desconectó. Esperando 40 segundos..."
}

UI Response:
- Mostrar notificación roja en parte superior
- Mostrar countdown 40, 39, 38... 1
- Otros jugadores pueden seguir jugando
```

**2. `jugador_reconectado`**
```javascript
{
  sessionId: "xxx",
  userId: "user123",
  mensaje: "El usuario X se ha reconectado"
}

UI Response:
- Remover notificación roja
- Mostrar notificación verde "✅ Jugador reconectado"
- Desaparecer después de 2 segundos
- Continuar partida normalmente
```

**3. `sesion_cerrada`**
```javascript
{
  sessionId: "xxx",
  razón: "El jugador X no se reconectó en 40 segundos.",
  mensaje: "La partida ha sido cerrada por inactividad."
}

UI Response:
- Mostrar alert al usuario
- Limpiar localStorage (sessionId)
- Redirigir a lobby.html automáticamente
- Toda la partida termina para todos
```

#### Variables globales para desconexión:
```javascript
let disconnectionTimeout = null;      // Timer de 40 segundos
let disconnectionCountdown = null;    // Intervalo del countdown
const DESCONEXION_TIMEOUT = 40000;    // 40 segundos en ms
```

#### Implementación en HTML:

Mostrar cuando se desconecta:
```html
<div class="disconnection-warning">
  <strong>⚠️ Jugador desconectado</strong>
  <p>El usuario se desconectó. Esperando 40 segundos...</p>
  <p>Esperando reconexión... <span id="countdownTimer">40</span>s</p>
</div>
```

---

## 🎨 ESTILOS CSS AGREGADOS

### Notificaciones
```css
.disconnection-warning     /* Notificación roja de desconexión */
.reconnection-success      /* Notificación verde de reconexión */
.your-turn-banner          /* Banner morado de turno */

@keyframes slide-down       /* Animar entrada de notificaciones */
@keyframes pulse-turn       /* Pulso del indicador de turno */
@keyframes turn-slide       /* Deslizamiento del banner */
@keyframes highlight-hand   /* Resaltar mano cuando es el turno */
```

---

## 🔧 FUNCIONES PRINCIPALES

### Captura
```javascript
calculateCardSum(cards: Array) → number
  Suma los valores de todas las cartas

validateCapture(playedCard: Object, captureCards: Array) → Object
  Valida si la captura es correcta
  Retorna: { isValid, message, type }

updateCaptureSumIndicator()
  Actualiza automáticamente la suma visible
```

### Desconexión
```javascript
socket.on("jugador_desconectado", handler)
socket.on("jugador_reconectado", handler)
socket.on("sesion_cerrada", handler)
```

---

## 📱 ARCHIVOS MODIFICADOS

1. **socket-client.js**
   - Agregadas funciones de validación de captura
   - Agregados listeners para desconexión/reconexión
   - Mejorado evento de login con sessionId
   - Agregado botón "Limpiar selección"

2. **style.css**
   - Estilos para notificaciones de desconexión
   - Estilos para notificaciones de reconexión
   - Animaciones smooth
   - Clases para feedback visual

3. **game.html**
   - Sin cambios principales (ya tiene botones necesarios)

---

## ✅ CHECKLIST DE PRUEBAS

- [ ] Capturar cartas por suma (3+4=7)
- [ ] Capturar cartas por igualdad (5+5+5)
- [ ] Ver error si suma no coincide
- [ ] Simular desconexión
- [ ] Ver countdown de 40 segundos
- [ ] Reconectar antes de 40 segundos
- [ ] Ver que sesión cierre después de 40 segundos
- [ ] Verificar que otros jugadores vean notificaciones
- [ ] Limpiar selección funciona
- [ ] Mensajes de validación son claros

---

## 🐛 DEBUGGING

### Console Logs para desarrollo:
```javascript
// Mostrar suma y valores
console.log(`Suma seleccionada: ${captureSum} | Valor carta jugada: ${playedValue}`);

// Mostrar validación
console.log(`✅ ${validation.message}`);

// Mostrar jugada
console.log("JUGADA VÁLIDA ENVIADA AL BACKEND:", jugada);
```

### Abrir DevTools:
```
F12 en el navegador
Tab "Console" para ver logs
Tab "Network" para ver eventos Socket.io
```

---

## 🚀 PRÓXIMAS MEJORAS (Opcionales)

- [ ] Animación de cartas siendo capturadas
- [ ] Sonido cuando se capturan cartas
- [ ] Mostrar suma en tiempo real sobre las cartas
- [ ] Historial de capturas en la partida
- [ ] Sugerir automáticamente capturas válidas
- [ ] Animación de "espera de reconexión"
