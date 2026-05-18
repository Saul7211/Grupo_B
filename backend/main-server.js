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
app.use(express.static('../frontend'));
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});


// Estructura en memoria para salas y jugadores
export const salasPendientes = new Map(); // sessionId -> { jugadores: [userId], monto, creadorId, timeoutId }
const jugadoresEnPartida = new Map(); // userId -> { sessionId, socketId, timeoutId }
const DESCONEXION_TIMEOUT = 40000; // 40 segundos

io.on('connection', (socket) => {
    console.log('Cliente conectado vía WebSocket:', socket.id);

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

            // Verificar si el usuario tiene una desconexión pendiente en una partida
            if (sessionId && jugadoresEnPartida.has(userId)) {
                const playerInfo = jugadoresEnPartida.get(userId);
                
                // Si hay un timeout pendiente, cancelarlo
                if (playerInfo.timeoutId) {
                    clearTimeout(playerInfo.timeoutId);
                    console.log(`[RECONEXIÓN] Usuario ${userId} se reconectó en sesión ${sessionId}`);

                    // Notificar a otros jugadores sobre la reconexión
                    io.emit('jugador_reconectado', {
                        sessionId,
                        userId,
                        mensaje: `El usuario ${userId} se ha reconectado`
                    });
                }

                // Actualizar el socket ID
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
            // Inicializa la sala en memoria y programa expiración
            const sessionId = resultado.sessionId;
            const timeoutId = setTimeout(async () => {
                const sala = salasPendientes.get(sessionId);
                if (sala && sala.jugadores.length < 4) {
                    // Devolver saldo a los jugadores que ya se unieron
                    for (const uid of sala.jugadores) {
                        try {
                            await recargarSaldo(uid, sala.monto);
                        } catch (e) {
                            console.error(`[Sala expirada] No se pudo devolver saldo a ${uid}:`, e.message);
                        }
                    }
                    salasPendientes.delete(sessionId);
                    io.emit('sala_expirada', {
                        sessionId,
                        mensaje: 'La sala expiró por falta de jugadores. Se devolvió el saldo a los participantes.'
                    });
                }
            }, 3 * 60 * 1000); // 3 minutos

            salasPendientes.set(sessionId, {
                jugadores: [userId],
                monto: Number(monto),
                creadorId: userId,
                timeoutId
            });

            socket.emit('partida_creada', {
                sessionId,
                mensaje: `Sala creada. Esperando jugadores (1/4) por $${monto}`
            });

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
            // Verifica si la sala existe en memoria
            const sala = salasPendientes.get(sessionId);
            if (!sala) throw new Error('Sala no encontrada o ya iniciada.');

            // No permitir que el creador o un usuario repetido se una de nuevo
            if (sala.jugadores.includes(userId)) {
                socket.emit('error_notificacion', 'Ya estás en la sala.');
                return;
            }

            // Limitar a 4 jugadores distintos
            if (sala.jugadores.length >= 4) {
                socket.emit('error_notificacion', 'La sala ya está llena.');
                return;
            }

            // Registrar apuesta y saldo SOLO para este usuario
            const resultado = await aceptarPartida(userId, sessionId);
            if (!resultado.success) throw new Error('No se pudo unir a la sala.');

            sala.jugadores.push(userId);

            // Notificar SOLO a este socket que se unió correctamente
            socket.emit('unido_a_sala', {
                sessionId,
                jugadores: sala.jugadores,
                mensaje: `Te uniste a la sala (${sala.jugadores.length}/4)`
            });

            // Notificar a todos el avance general
            io.emit('jugador_unido', {
                sessionId,
                jugadores: sala.jugadores,
                mensaje: `Jugador unido (${sala.jugadores.length}/4)`
            });

            // Registrar al usuario en la partida
            jugadoresEnPartida.set(userId, {
                sessionId,
                socketId: socket.id,
                timeoutId: null
            });

            // Si ya hay 4 jugadores distintos (salaLlena true), iniciar partida
            if (resultado.salaLlena) {
                console.log(`[aceptar_partida] Partida ${sessionId} lista con 4 jugadores. Enviando al motor...`);
                clearTimeout(sala.timeoutId); // Cancelar expiración
                enviarAlMotor({
                    action: 'START_GAME',
                    sessionId,
                    players: sala.jugadores,
                    totalPot: sala.monto * 4
                }, io);
                io.emit('juego_iniciado', {
                    sessionId,
                    mensaje: '¡Partida lista! El motor está barajando...'
                });
                salasPendientes.delete(sessionId); // Elimimar de la lista de pendientes
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
            io.emit('partida_finalizada', {
                sessionId,
                winnerId,
                totalPot: resultado.totalPot
            });
        } catch (err) {
            socket.emit('error_notificacion', 'Error al registrar ganador: ' + err.message);
        }
    });



    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);

        // Buscar si el usuario estaba en una partida
        let desconectadoUserId = null;
        for (const [userId, info] of jugadoresEnPartida.entries()) {
            if (info.socketId === socket.id) {
                desconectadoUserId = userId;
                break;
            }
        }

        if (desconectadoUserId) {
            const playerInfo = jugadoresEnPartida.get(desconectadoUserId);
            const sessionId = playerInfo.sessionId;

            console.log(`[DESCONEXIÓN] Usuario ${desconectadoUserId} desconectado de sesión ${sessionId}`);

            // Notificar a otros jugadores sobre la desconexión
            io.emit('jugador_desconectado', {
                sessionId,
                userId: desconectadoUserId,
                mensaje: `El usuario ${desconectadoUserId} se desconectó. Esperando 40 segundos para reintento...`
            });

            // Iniciar timeout de 40 segundos
            const timeoutId = setTimeout(async () => {
                // Verificar si el usuario sigue desconectado
                const stillDisconnected = jugadoresEnPartida.get(desconectadoUserId)?.timeoutId === timeoutId;

                if (stillDisconnected) {
                    console.log(`[TIMEOUT] Usuario ${desconectadoUserId} no se reconectó en 40 segundos. Cerrando sesión...`);

                    // Notificar a todos los jugadores que la sesión se cierra
                    io.emit('sesion_cerrada', {
                        sessionId,
                        razón: `El jugador ${desconectadoUserId} no se reconectó en 40 segundos.`,
                        mensaje: 'La partida ha sido cerrada por inactividad.'
                    });

                    // Limpiar la sesión
                    jugadoresEnPartida.delete(desconectadoUserId);
                    salasPendientes.delete(sessionId);

                    // Devolver saldo a todos los jugadores de esa sesión (si es necesario)
                    // Esto se podría implementar consultando a BD si es necesario
                }
            }, DESCONEXION_TIMEOUT);

            // Actualizar la información del usuario con el timeout
            playerInfo.timeoutId = timeoutId;
        }
    });
});

// ── INICIO DEL SERVIDOR ───────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`  SERVIDOR ACTIVO   →  Puerto: ${PORT}`);
    console.log(`  BASE DE DATOS     →  ${process.env.DB_NAME}`);
});