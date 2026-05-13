import net from 'net';

const MOTOR_PORT = 5000;
const MOTOR_HOST = '127.0.0.1';

/**
 * Envía datos al Motor de Juego vía TCP y devuelve la respuesta.
 * @param {Object} datosJson  - Objeto con la acción y datos de la partida.
 * @param {import('socket.io').Server} io - Instancia de Socket.IO para reenviar respuestas.
 */
export function enviarAlMotor(datosJson, io) {
    const client = new net.Socket();

    client.connect(MOTOR_PORT, MOTOR_HOST, () => {
        console.log(`[TCP Bridge] Conectado al Motor en ${MOTOR_HOST}:${MOTOR_PORT}`);
        client.write(JSON.stringify(datosJson));
    });

    client.on('data', (data) => {
        console.log('[TCP Bridge] El Motor respondió:', data.toString());

        try {
            const respuesta = JSON.parse(data.toString());

            // El motor manda { action, sessionId, ... }
            // Reenviamos el evento a todos los clientes WebSocket de esa sala
            if (respuesta.sessionId && io) {
                io.emit('evento_motor', respuesta);
            }
        } catch (e) {
            console.error('[TCP Bridge] Respuesta del motor no es JSON válido:', data.toString());
        }

        client.destroy();
    });

    client.on('error', (err) => {
        console.error('[TCP Bridge] Error de conexión con el motor:', err.message);
        console.error('Asegúrate de que engine-server.js esté corriendo en el puerto 5000.');
    });
}