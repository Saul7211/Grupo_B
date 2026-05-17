import net from 'net';

const MOTOR_PORT = 5000;
const MOTOR_HOST = '127.0.0.1';

// Importar la estructura de salas desde main-server.js
import { salasPendientes } from './main-server.js';

/**
 * Envía datos al Motor de Juego vía TCP y devuelve la respuesta.
 * @param {Object} datosJson  - Objeto con la acción y datos de la partida.
 * @param {import('socket.io').Server} io - Instancia de Socket.IO para reenviar respuestas.
 */
export function enviarAlMotor(datosJson, io) {
    const client = new net.Socket();

    client.connect(MOTOR_PORT, MOTOR_HOST, () => {
        console.log(`[TCP Bridge] Conectado al Motor en ${MOTOR_HOST}:${MOTOR_PORT}`);
        client.write(JSON.stringify(datosJson) + "\n");
    });

    client.on('data', async (data) => {
        console.log('[TCP Bridge] El Motor respondió:', data.toString());

        try {
            let respuesta = JSON.parse(data.toString());

            // Buscar nombres de jugadores si hay sessionId
            if (respuesta.sessionId) {
                let jugadoresNombres = {};
                // Buscar en salasPendientes primero
                const sala = salasPendientes.get(respuesta.sessionId);
                if (sala && sala.jugadores) {
                    // Buscar nombres en la base de datos
                    for (const userId of sala.jugadores) {
                        try {
                            const [rows] = await import('./database.js').then(db => db.pool.execute('SELECT username FROM users WHERE id = ?', [userId]));
                            if (rows.length > 0) {
                                jugadoresNombres[userId] = rows[0].username;
                            }
                        } catch {}
                    }
                }
                respuesta.jugadoresNombres = jugadoresNombres;
            }

            // Si falta la propiedad 'hands' pero hay 'sessionId' y 'state', pedimos el estado actualizado
            if (respuesta.sessionId && respuesta.state && !respuesta.hands) {
                // Pedimos el estado completo al motor
                const req = new net.Socket();
                req.connect(MOTOR_PORT, MOTOR_HOST, () => {
                    req.write(JSON.stringify({
                        action: 'GET_STATE',
                        sessionId: respuesta.sessionId
                    }));
                });
                req.on('data', async (d) => {
                    try {
                        const estado = JSON.parse(d.toString());
                        respuesta.hands = estado.hands || {};
                        // Repetir nombres
                        if (respuesta.sessionId) {
                            let jugadoresNombres = {};
                            const sala = salasPendientes.get(respuesta.sessionId);
                            if (sala && sala.jugadores) {
                                for (const userId of sala.jugadores) {
                                    try {
                                        const [rows] = await import('./database.js').then(db => db.pool.execute('SELECT username FROM users WHERE id = ?', [userId]));
                                        if (rows.length > 0) {
                                            jugadoresNombres[userId] = rows[0].username;
                                        }
                                    } catch {}
                                }
                            }
                            respuesta.jugadoresNombres = jugadoresNombres;
                        }
                        if (io) io.emit('evento_motor', respuesta);
                    } catch (e) {
                        console.error('[TCP Bridge] Error parseando estado:', d.toString());
                        if (io) io.emit('evento_motor', respuesta);
                    }
                    req.destroy();
                });
                req.on('error', (err) => {
                    console.error('[TCP Bridge] Error pidiendo estado:', err.message);
                    if (io) io.emit('evento_motor', respuesta);
                });
            } else {
                if (respuesta.sessionId && io) {
                    io.emit('evento_motor', respuesta);
                }
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