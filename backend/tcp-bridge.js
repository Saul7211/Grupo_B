import net from 'net';

const MOTOR_PORT = 5000;
const MOTOR_HOST = '127.0.0.1';

import { salasPendientes, partidasActivas, emitToSession } from './main-server.js';

/**
 * Busca los jugadores de una sesión (primero activas, luego pendientes).
 */
function getJugadoresDeSesion(sessionId) {
    const activa = partidasActivas.get(sessionId);
    if (activa && activa.jugadores) return activa.jugadores;

    const pendiente = salasPendientes.get(sessionId);
    if (pendiente && pendiente.jugadores) return pendiente.jugadores;

    return [];
}

/**
 * Busca los nombres de usuario para una lista de IDs.
 */
async function buscarNombresJugadores(jugadorIds) {
    const nombres = {};
    for (const userId of jugadorIds) {
        try {
            const [rows] = await import('./database.js').then(db =>
                db.pool.execute('SELECT username FROM users WHERE id = ?', [userId])
            );
            if (rows.length > 0) {
                nombres[userId] = rows[0].username;
            }
        } catch {}
    }
    return nombres;
}

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
            const sessionId = respuesta.sessionId;

            // Buscar nombres de jugadores
            if (sessionId) {
                const jugadores = getJugadoresDeSesion(sessionId);
                respuesta.jugadoresNombres = await buscarNombresJugadores(jugadores);
            }

            // Si falta 'hands' pero hay 'state', pedir estado completo
            if (sessionId && respuesta.state && !respuesta.hands) {
                const req = new net.Socket();
                req.connect(MOTOR_PORT, MOTOR_HOST, () => {
                    req.write(JSON.stringify({
                        action: 'GET_STATE',
                        sessionId
                    }) + "\n");
                });
                req.on('data', async (d) => {
                    try {
                        const estado = JSON.parse(d.toString());
                        respuesta.hands = estado.hands || {};

                        if (sessionId) {
                            const jugadores = getJugadoresDeSesion(sessionId);
                            respuesta.jugadoresNombres = await buscarNombresJugadores(jugadores);
                        }

                        if (io && sessionId) {
                            emitToSession(io, sessionId, 'evento_motor', respuesta);
                        }
                    } catch (e) {
                        console.error('[TCP Bridge] Error parseando estado:', d.toString());
                        if (io && sessionId) {
                            emitToSession(io, sessionId, 'evento_motor', respuesta);
                        }
                    }
                    req.destroy();
                });
                req.on('error', (err) => {
                    console.error('[TCP Bridge] Error pidiendo estado:', err.message);
                    if (io && sessionId) {
                        emitToSession(io, sessionId, 'evento_motor', respuesta);
                    }
                });
            } else {
                if (io && sessionId) {
                    emitToSession(io, sessionId, 'evento_motor', respuesta);
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