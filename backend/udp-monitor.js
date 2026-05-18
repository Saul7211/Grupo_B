import dgram from "dgram";
import crypto from "crypto";

// Configuración de red para el servidor y cliente UDP
const UDP_PORT = 54322;
const UDP_HOST = "127.0.0.1";

// Creación de los sockets UDP (IPv4)
const udpServer = dgram.createSocket("udp4"); // Actuará como el servidor que escucha los mensajes
const udpClient = dgram.createSocket("udp4"); // Actuará como el cliente que envía los pings

// Mapa para almacenar los pings enviados que aún no han recibido respuesta.
// Esto es vital para calcular el RTT (Round-Trip Time) y evitar pérdida de contexto.
// Clave: pingId (UUID), Valor: Metadatos del usuario y timestamp de envío.
const pendingPings = new Map();

/**
 * Inicializa el servidor UDP y configura el manejador de eventos para procesar los pings recibidos.
 * @param {Object} io - Instancia de Socket.io para emitir los resultados de latencia al cliente frontend.
 */
export function startUdpMonitor(io) {
    // Evento que se dispara cada vez que el servidor UDP recibe un paquete
    udpServer.on("message", (msg) => {
        try {
            // Decodifica el buffer del mensaje recibido a una cadena y luego a formato JSON
            const data = JSON.parse(msg.toString());

            const simulatedDelay = Math.floor(Math.random() * 180);

            // Filtro de seguridad: ignora cualquier mensaje que no sea del tipo esperado
            if (data.type !== "PING") return;

            // Busca si el ping recibido está registrado en el mapa de pings en espera
            const pending = pendingPings.get(data.pingId);
            if (!pending) return; // Si no existe (ej. expiró por timeout y fue borrado), se ignora

            // Calcula la latencia (RTT) en milisegundos restando el tiempo de envío al tiempo actual
            const latency = Date.now() - pending.sentAt + simulatedDelay;

            // Valores por defecto para el estado de la conexión
            let status = "activo";
            let quality = "buena";

            // Clasificación de la calidad de red basada en los umbrales de latencia
            if (latency > 250) quality = "débil";
            else if (latency > 120) quality = "media";

            console.log(
                `[UDP Monitor] Usuario: ${pending.username || pending.userId} | Sala: ${pending.sessionId} | Latencia: ${latency} ms | Estado: ${status} | Calidad: ${quality}`
            );

            // Emite el resultado a través de WebSocket (Socket.io) 
            // Se usa io.to() para enviar el evento únicamente a la sesión/socket de este usuario específico
            io.to(pending.socketId).emit("udp_estado_jugador", {
                userId: pending.userId,
                username: pending.username,
                sessionId: pending.sessionId,
                latency,
                status,
                quality
            });

            // Limpia el registro del mapa ya que fue procesado exitosamente (previene fugas de memoria)
            pendingPings.delete(data.pingId);

        } catch (error) {
            // Manejo de excepciones (ej. si msg no es un JSON válido) para evitar que el servidor colapse
            console.error("[UDP Monitor] Error procesando mensaje:", error.message);
        }
    });

    // Inicia el servidor UDP en el puerto y host especificados para que empiece a escuchar
    udpServer.bind(UDP_PORT, UDP_HOST, () => {
        console.log(`[UDP Monitor] Servidor UDP activo en ${UDP_HOST}:${UDP_PORT}`);
    });

    console.log("[UDP Monitor] Monitor iniciado");
}

/**
 * Genera y envía un paquete UDP de tipo PING, registrando sus metadatos para calcular la latencia a su regreso.
 * @param {Object} params - Objeto con los datos de identificación del cliente y del socket.
 */
export function sendUdpPing({ socketId, userId, username, sessionId }) {
    // Genera un identificador único universal (UUID) para rastrear este paquete específico
    const pingId = crypto.randomUUID();

    // Estructura de la carga útil (payload) que viajará por la red
    const payload = {
        type: "PING",
        pingId,
        userId,
        username,
        sessionId,
        timestamp: Date.now()
    };

    // Guarda los datos del envío en el mapa para su posterior validación en la función startUdpMonitor
    pendingPings.set(pingId, {
        socketId,
        userId,
        username,
        sessionId,
        sentAt: Date.now() // Momento exacto de envío para el cálculo preciso de latencia
    });

    // Envía el mensaje UDP hacia el servidor configurado
    udpClient.send(
        Buffer.from(JSON.stringify(payload)), // Convierte el objeto JSON en un buffer de bytes
        UDP_PORT,
        UDP_HOST
    );

    // Dado que el protocolo UDP no garantiza la entrega de paquetes, se configura un recolector de basura (Timeout).
    // Si después de 3000ms (3 segundos) no hay respuesta, se asume paquete perdido y se borra del mapa.
    setTimeout(() => {
        if (pendingPings.has(pingId)) {
            pendingPings.delete(pingId);
        }
    }, 3000);
}