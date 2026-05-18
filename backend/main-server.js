import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import {
    pool,
    registrarUsuario,
    loginUsuario,
    recargarSaldo,
    crearPartida,
    aceptarPartida,
    registrarGanador,
} from './database.js';
import { enviarAlMotor } from './tcp-bridge.js';

const app = express();
app.use('/frontend', express.static('../frontend'));
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});


// ══════════════════════════════════════════════════════════════════════════════
// ESTRUCTURAS EN MEMORIA
// ══════════════════════════════════════════════════════════════════════════════

export const salasPendientes = new Map();   // sessionId -> { jugadores, monto, creadorId, timeoutId }
export const partidasActivas = new Map();   // sessionId -> { jugadores: [userId], monto }
const jugadoresEnPartida = new Map();       // userId -> { sessionId, socketId, timeoutId }
const socketToUser = new Map();             // socketId -> userId
const DESCONEXION_TIMEOUT = 300000;         // 5 minutos

// ══════════════════════════════════════════════════════════════════════════════
// HELPER: Emitir a todos los jugadores de una sesión
// Busca el socketId ACTUAL de cada jugador — no depende de rooms
// ══════════════════════════════════════════════════════════════════════════════

export function emitToSession(ioInstance, sessionId, evento, datos) {
    const activa = partidasActivas.get(sessionId);
    const pendiente = salasPendientes.get(sessionId);
    const jugadores = activa?.jugadores || pendiente?.jugadores || [];

    let enviados = 0;
    for (const userId of jugadores) {
        const info = jugadoresEnPartida.get(userId);
        if (info && info.socketId) {
            const sock = ioInstance.sockets.sockets.get(info.socketId);
            if (sock) {
                sock.emit(evento, datos);
                enviados++;
            }
        }
    }
    console.log(`[emitToSession] ${evento} → sesión ${sessionId} (${enviados}/${jugadores.length} alcanzados)`);
}


io.on('connection', (socket) => {
    console.log('Cliente conectado vía WebSocket:', socket.id);

    // Enviar todas las salas pendientes al conectarse
    const salasArray = Array.from(salasPendientes.entries()).map(([sessionId, sala]) => ({
        sessionId,
        monto: sala.monto
    }));
    socket.emit('salas_pendientes', salasArray);

    // ══════════════════════════════════════════════════════════════════════════
    // 0. IDENTIFICACIÓN — El frontend llama esto al conectar/reconectar
    //    Actualiza el socketId del jugador para que emitToSession lo encuentre.
    // ══════════════════════════════════════════════════════════════════════════

    socket.on('identificar_jugador', ({ userId, sessionId }) => {
        if (!userId || !sessionId) return;

        console.log(`[IDENTIFICAR] Usuario ${userId} en sesión ${sessionId} → socket ${socket.id}`);

        // Verificar que el usuario pertenece a esta sesión
        const activa = partidasActivas.get(sessionId);
        const pendiente = salasPendientes.get(sessionId);
        const jugadores = activa?.jugadores || pendiente?.jugadores || [];

        if (!jugadores.includes(userId)) {
            console.warn(`[IDENTIFICAR] Usuario ${userId} NO pertenece a sesión ${sessionId}`);
            socket.emit('error_notificacion', 'No perteneces a esta sesión.');
            return;
        }

        // Limpiar socket anterior
        const prevInfo = jugadoresEnPartida.get(userId);
        if (prevInfo) {
            socketToUser.delete(prevInfo.socketId);

            // Cancelar timeout de desconexión si existía
            if (prevInfo.timeoutId) {
                clearTimeout(prevInfo.timeoutId);
                console.log(`[IDENTIFICAR] Timeout cancelado para ${userId}`);

                emitToSession(io, sessionId, 'jugador_reconectado', {
                    sessionId,
                    userId,
                    mensaje: `El usuario ${userId} se ha reconectado`
                });
            }

            prevInfo.socketId = socket.id;
            prevInfo.timeoutId = null;
        } else {
            jugadoresEnPartida.set(userId, {
                sessionId,
                socketId: socket.id,
                timeoutId: null
            });
        }

        socketToUser.set(socket.id, userId);
        console.log(`[IDENTIFICAR] ✅ Socket actualizado para ${userId}: ${socket.id}`);
    });

    // 1. REGISTRO

    socket.on('registrar_usuario', async ({ username, password }) => {
        try {
            if (!username || !password) throw new Error('Usuario y contraseña son obligatorios.');
            const resultado = await registrarUsuario(username, password);
            socket.emit('registro_exitoso', resultado);
        } catch (err) {
            socket.emit('error_notificacion', err.message);
        }
    });

    // 2. LOGIN (Y RECONEXIÓN EN PARTIDA EN PROGRESO)

    socket.on('login_usuario', async ({ username, password, sessionId }) => {
        try {
            if (!username || !password) throw new Error('Usuario y contraseña son obligatorios.');
            const resultado = await loginUsuario(username, password);
            const userId = resultado.id;

            socketToUser.set(socket.id, userId);

            // Si el usuario tenía una partida activa, actualizar su socket
            if (sessionId && jugadoresEnPartida.has(userId)) {
                const playerInfo = jugadoresEnPartida.get(userId);
                
                if (playerInfo.timeoutId) {
                    clearTimeout(playerInfo.timeoutId);
                    console.log(`[RECONEXIÓN-LOGIN] Usuario ${userId} se reconectó en sesión ${sessionId}`);

                    emitToSession(io, sessionId, 'jugador_reconectado', {
                        sessionId,
                        userId,
                        mensaje: `El usuario ${userId} se ha reconectado`
                    });
                }

                playerInfo.socketId = socket.id;
                playerInfo.timeoutId = null;
            }

            socket.emit('login_exitoso', resultado);
        } catch (err) {
            socket.emit('error_notificacion', err.message);
        }
    });

    //  3. RECARGAR SALDO 

    socket.on('recargar_saldo', async ({ userId, monto }) => {
        try {
            const resultado = await recargarSaldo(userId, Number(monto));
            socket.emit('saldo_recargado', { nuevoSaldo: resultado.nuevoSaldo });
        } catch (err) {
            socket.emit('error_notificacion', err.message);
        }
    });

    //  4. PEDIR SALDO ACTUAL 

    socket.on('pedir_saldo', async (userId) => {
        try {
            const [rows] = await pool.execute('SELECT balance FROM users WHERE id = ?', [userId]);
            socket.emit('recibir_saldo', rows[0]?.balance ?? 0);
        } catch (err) {
            socket.emit('error_notificacion', 'No se pudo obtener el saldo.');
        }
    });

    // 5. CREAR PARTIDA 

    socket.on('crear_partida', async ({ userId, monto }) => {
        try {
            const resultado = await crearPartida(userId, Number(monto));
            const sessionId = resultado.sessionId;

            const timeoutId = setTimeout(async () => {
                const sala = salasPendientes.get(sessionId);
                if (sala && sala.jugadores.length < 4) {
                    for (const uid of sala.jugadores) {
                        try {
                            await recargarSaldo(uid, sala.monto);
                        } catch (e) {
                            console.error(`[Sala expirada] No se pudo devolver saldo a ${uid}:`, e.message);
                        }
                    }

                    emitToSession(io, sessionId, 'sala_expirada', {
                        sessionId,
                        mensaje: 'La sala expiró por falta de jugadores. Se devolvió el saldo a los participantes.'
                    });

                    salasPendientes.delete(sessionId);
                    io.emit('sala_removida', { sessionId });
                }
            }, 3 * 60 * 1000);

            salasPendientes.set(sessionId, {
                jugadores: [userId],
                monto: Number(monto),
                creadorId: userId,
                timeoutId
            });

            jugadoresEnPartida.set(userId, {
                sessionId,
                socketId: socket.id,
                timeoutId: null
            });
            socketToUser.set(socket.id, userId);

            socket.emit('partida_creada', {
                sessionId,
                mensaje: `Sala creada. Esperando jugadores (1/4) por $${monto}`
            });

            // Global: todos necesitan ver las salas disponibles
            io.emit('nueva_sala_disponible', {
                sessionId,
                monto: Number(monto)
            });
        } catch (err) {
            socket.emit('error_notificacion', err.message);
        }
    });

    // 6. ACEPTAR PARTIDA 

    socket.on('aceptar_partida', async ({ userId, sessionId }) => {
        try {
            const sala = salasPendientes.get(sessionId);
            if (!sala) throw new Error('Sala no encontrada o ya iniciada.');

            if (sala.jugadores.includes(userId)) {
                socket.emit('error_notificacion', 'Ya estás en la sala.');
                return;
            }

            if (sala.jugadores.length >= 4) {
                socket.emit('error_notificacion', 'La sala ya está llena.');
                return;
            }

            const resultado = await aceptarPartida(userId, sessionId);
            if (!resultado.success) throw new Error('No se pudo unir a la sala.');

            sala.jugadores.push(userId);

            jugadoresEnPartida.set(userId, {
                sessionId,
                socketId: socket.id,
                timeoutId: null
            });
            socketToUser.set(socket.id, userId);

            socket.emit('unido_a_sala', {
                sessionId,
                jugadores: sala.jugadores,
                mensaje: `Te uniste a la sala (${sala.jugadores.length}/4)`
            });

            emitToSession(io, sessionId, 'jugador_unido', {
                sessionId,
                jugadores: sala.jugadores,
                mensaje: `Jugador unido (${sala.jugadores.length}/4)`
            });

            if (resultado.salaLlena) {
                console.log(`[aceptar_partida] Partida ${sessionId} lista con 4 jugadores. Enviando al motor...`);
                clearTimeout(sala.timeoutId);

                // Guardar partida activa ANTES de borrar de pendientes
                partidasActivas.set(sessionId, {
                    jugadores: [...sala.jugadores],
                    monto: sala.monto
                });

                enviarAlMotor({
                    action: 'START_GAME',
                    sessionId,
                    players: sala.jugadores,
                    totalPot: sala.monto * 4
                }, io);

                emitToSession(io, sessionId, 'juego_iniciado', {
                    sessionId,
                    mensaje: '¡Partida lista! El motor está barajando...'
                });

                salasPendientes.delete(sessionId);
                io.emit('sala_removida', { sessionId });
            }
        } catch (err) {
            socket.emit('error_notificacion', 'Error al unirse: ' + err.message);
        }
    });

    // 7. JUGAR CARTA

    socket.on('jugar_carta', async ({ userId, sessionId, card, capture }) => {
        try {
            if (!userId || !sessionId || !card) {
                throw new Error('Faltan datos para jugar la carta.');
            }

            enviarAlMotor({
                action: 'PLAY_CARD',
                sessionId,
                playerId: userId,
                card,
                capture: capture || []
            }, io);

        } catch (err) {
            socket.emit('error_notificacion', 'Error al jugar carta: ' + err.message);
        }
    });


    //  8. REGISTRAR GANADOR 

    socket.on('registrar_ganador', async ({ sessionId, winnerId }) => {
        try {
            const resultado = await registrarGanador(sessionId, winnerId);
            emitToSession(io, sessionId, 'partida_finalizada', {
                sessionId,
                winnerId,
                totalPot: resultado.totalPot
            });

            partidasActivas.delete(sessionId);
        } catch (err) {
            socket.emit('error_notificacion', 'Error al registrar ganador: ' + err.message);
        }
    });



    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);

        const desconectadoUserId = socketToUser.get(socket.id);
        socketToUser.delete(socket.id);

        if (!desconectadoUserId || !jugadoresEnPartida.has(desconectadoUserId)) return;

        const playerInfo = jugadoresEnPartida.get(desconectadoUserId);
        const sessionId = playerInfo.sessionId;

        console.log(`[DESCONEXIÓN] Usuario ${desconectadoUserId} desconectado de sesión ${sessionId}`);

        const salaExiste = salasPendientes.has(sessionId);
        
        if (salaExiste) {
            jugadoresEnPartida.delete(desconectadoUserId);
            return;
        }

        emitToSession(io, sessionId, 'jugador_desconectado', {
            sessionId,
            userId: desconectadoUserId,
            mensaje: `El usuario ${desconectadoUserId} se desconectó. Esperando 5 minutos para reintento...`
        });

        const timeoutId = setTimeout(async () => {
            const stillDisconnected = jugadoresEnPartida.get(desconectadoUserId)?.timeoutId === timeoutId;

            if (stillDisconnected) {
                console.log(`[TIMEOUT] Usuario ${desconectadoUserId} no se reconectó en 5 minutos. Cerrando sesión...`);

                emitToSession(io, sessionId, 'sesion_cerrada', {
                    sessionId,
                    razón: `El jugador ${desconectadoUserId} no se reconectó en 5 minutos.`,
                    mensaje: 'La partida ha sido cerrada por inactividad.'
                });

                jugadoresEnPartida.delete(desconectadoUserId);
                salasPendientes.delete(sessionId);
                partidasActivas.delete(sessionId);
            }
        }, DESCONEXION_TIMEOUT);

        playerInfo.timeoutId = timeoutId;
    });
});

// ── INICIO DEL SERVIDOR ───────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`  SERVIDOR ACTIVO   →  Puerto: ${PORT}`);
    console.log(`  BASE DE DATOS     →  ${process.env.DB_NAME}`);
});