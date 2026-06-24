import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import {
    pool,
    actualizarContrasenaUsuario,
    buscarUsuarioParaRecuperacion,
    registrarUsuario,
    loginUsuario,
    recargarSaldo,
    crearPartida,
    aceptarPartida,
    registrarGanador,
} from './database.js';
import { enviarAlMotor } from './tcp-bridge.js';
import { startUdpMonitor, sendUdpPing } from './udp-monitor.js';
import passport from './auth.js';
import logger from './logger/index.js';
import morganMiddleware from './logger/morganMiddleware.js';
import routeAccessLogger from './logger/routeAccessLogger.js';
import errorLogger from './logger/errorLogger.js';
import usersRoutes from './routes/users.js';
import logsRoutes from './routes/logs.js';
import {
    authenticateSocketPayload,
    authMiddleware,
    createAuthToken,
    createRecoveryToken,
    verifyRecoveryToken
} from './middleware/authMiddleware.js';

const app = express();
app.use(express.json());
app.use(morganMiddleware);
app.use(routeAccessLogger);
app.use('/frontend', express.static('../frontend'));
app.use(passport.initialize());

// ── OAUTH CON GOOGLE ──────────────────────────────────────────────
app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

app.get('/auth/google/callback',
    passport.authenticate('google', {
        failureRedirect: '/frontend/login.html',
        session: false
    }),
    (req, res) => {
        const u = req.user;
        const token = createAuthToken(u);
        const params = new URLSearchParams({
            userId:   u.userId,
            username: u.username,
            balance:  String(u.balance ?? 0),
            email:    u.email || '',
            photo:    u.photo || '',
            provider: 'google',
            token
        });
        res.redirect(`/frontend/oauth-callback.html?${params.toString()}`);
    }
);

app.get('/', (_req, res) => {
    res.json({
        success: true,
        message: 'Backend del juego activo',
        endpoints: ['/users', '/users/:id', '/logs/resumen']
    });
});

app.use('/users', usersRoutes);
app.use('/logs', logsRoutes);

app.get('/auth/me', authMiddleware, async (req, res) => {
    const [rows] = await pool.execute(
        'SELECT id, username, balance FROM users WHERE id = ?',
        [req.userId]
    );

    if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    return res.json({ success: true, user: rows[0] });
});

app.use((req, res) => {
    logger.warn(`[RUTA_NO_ENCONTRADA] ${req.method} ${req.originalUrl}`);
    res.status(404).json({ success: false, message: 'Ruta no encontrada' });
});

// Middleware de error mejorado (debe ir al final)
app.use(errorLogger);

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
    logger.debug(`[emitToSession] ${evento} -> sesion ${sessionId} (${enviados}/${jugadores.length} alcanzados)`);
}


io.on('connection', (socket) => {
    logger.info(`Cliente conectado via WebSocket: ${socket.id}`);

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

    socket.on('identificar_jugador', (payload = {}) => {
        try {
            const authUser = authenticateSocketPayload(socket, payload);
            const userId = authUser.userId;
            const { sessionId } = payload;

            if (!userId || !sessionId) return;

        logger.info(`[IDENTIFICAR] Usuario ${userId} en sesion ${sessionId} -> socket ${socket.id}`);

        // Verificar que el usuario pertenece a esta sesión
        const activa = partidasActivas.get(sessionId);
        const pendiente = salasPendientes.get(sessionId);
        const jugadores = activa?.jugadores || pendiente?.jugadores || [];

        if (!jugadores.includes(userId)) {
            logger.warn(`[IDENTIFICAR] Usuario ${userId} NO pertenece a sesion ${sessionId}`);
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
                logger.info(`[IDENTIFICAR] Timeout cancelado para ${userId}`);

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
            logger.info(`[IDENTIFICAR] Socket actualizado para ${userId}: ${socket.id}`);
        } catch (err) {
            socket.emit('error_notificacion', err.message);
        }
    });

    // 1. REGISTRO

    socket.on('registrar_usuario', async ({ username, password }) => {
        try {
            if (!username || !password) throw new Error('Usuario y contraseña son obligatorios.');
            const resultado = await registrarUsuario(username, password);
            logger.info(`[WS_REGISTRO_EXITOSO] Usuario registrado: ${username} (ID: ${resultado.userId})`);
            socket.emit('registro_exitoso', resultado);
        } catch (err) {
            logger.warn(`[WS_REGISTRO_ERROR] Intento fallido de registro. Usuario: ${username || 'DESCONOCIDO'} | Error: ${err.message}`);
            socket.emit('error_notificacion', err.message);
        }
    });

    // 2. LOGIN (Y RECONEXIÓN EN PARTIDA EN PROGRESO)

    socket.on('login_usuario', async ({ username, password, sessionId }) => {
        try {
            if (!username || !password) throw new Error('Usuario y contraseña son obligatorios.');
            const resultado = await loginUsuario(username, password);
            const token = createAuthToken(resultado);
            const userId = resultado.userId;

            resultado.token = token;
            socket.data.token = token;
            socket.data.userId = userId;
            socket.data.username = resultado.username;

            socketToUser.set(socket.id, userId);

            logger.info(`[WS_LOGIN_EXITOSO] Usuario: ${resultado.username} (ID: ${userId}) | Socket: ${socket.id}`);

            // Si el usuario tenía una partida activa, actualizar su socket
            if (sessionId && jugadoresEnPartida.has(userId)) {
                const playerInfo = jugadoresEnPartida.get(userId);

                if (playerInfo.timeoutId) {
                    clearTimeout(playerInfo.timeoutId);
                    logger.info(`[RECONEXION-LOGIN] Usuario ${userId} se reconecto en sesion ${sessionId}`);

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
            logger.warn(`[WS_LOGIN_ERROR] Intento fallido de login. Usuario: ${username || 'DESCONOCIDO'} | Socket: ${socket.id} | Error: ${err.message}`);
            socket.emit('error_notificacion', err.message);
        }
    });

    // 2.1 RECUPERACION DE CONTRASENA CON TOKEN TEMPORAL

    socket.on('solicitar_recuperacion', async ({ username }) => {
        try {
            if (!username) throw new Error('El usuario es obligatorio.');

            const user = await buscarUsuarioParaRecuperacion(username);
            const token = createRecoveryToken(user);

            logger.info(`[WS_RECUPERACION_TOKEN] Token temporal generado para usuario: ${user.userId} (${username})`);

            socket.emit('recuperacion_token_generado', {
                msg: 'Token temporal generado. Usalo para restablecer tu contrasena.',
                token,
                expiresIn: process.env.RECOVERY_TOKEN_EXPIRES_IN || '15m'
            });
        } catch (err) {
            logger.warn(`[WS_RECUPERACION_ERROR] Error en solicitud de recuperación. Usuario: ${username || 'DESCONOCIDO'} | Error: ${err.message}`);
            socket.emit('error_notificacion', err.message);
        }
    });

    socket.on('restablecer_contrasena', async ({ token, nuevaPassword }) => {
        try {
            if (!token || !nuevaPassword) {
                throw new Error('Token y nueva contrasena son obligatorios.');
            }

            const decoded = verifyRecoveryToken(token);
            await actualizarContrasenaUsuario(decoded.userId, nuevaPassword);

            logger.info(`[WS_CONTRASENA_RESTABLECIDA] Usuario: ${decoded.userId} ha actualizado su contraseña`);
            socket.emit('contrasena_restablecida', {
                msg: 'Contrasena actualizada correctamente. Ya puedes iniciar sesion.'
            });
        } catch (err) {
            logger.warn(`[WS_RESTABLECER_ERROR] Error al restablecer contraseña. Error: ${err.message}`);
            socket.emit('error_notificacion', err.message);
        }
    });

    //  3. RECARGAR SALDO 

    socket.on('recargar_saldo', async (payload = {}) => {
        try {
            const { userId } = authenticateSocketPayload(socket, payload);
            const { monto } = payload;
            const resultado = await recargarSaldo(userId, Number(monto));
            logger.info(`[WS_SALDO_RECARGADO] Usuario: ${userId} | Monto: ${monto} | Nuevo saldo: ${resultado.nuevoSaldo}`);
            socket.emit('saldo_recargado', { nuevoSaldo: resultado.nuevoSaldo });
        } catch (err) {
            logger.warn(`[WS_SALDO_ERROR] Error al recargar saldo. Error: ${err.message}`);
        }
    });

    //  4. PEDIR SALDO ACTUAL 

    socket.on('pedir_saldo', async (payload = {}) => {
        try {
            if (typeof payload === 'string') payload = { userId: payload };
            const { userId } = authenticateSocketPayload(socket, payload);
            const [rows] = await pool.execute('SELECT balance FROM users WHERE id = ?', [userId]);
            socket.emit('recibir_saldo', rows[0]?.balance ?? 0);
        } catch (err) {
            socket.emit('error_notificacion', 'No se pudo obtener el saldo.');
        }
    });

    // 5. CREAR PARTIDA 

    socket.on('crear_partida', async (payload = {}) => {
        try {
            const { userId } = authenticateSocketPayload(socket, payload);
            const { monto } = payload;
            const resultado = await crearPartida(userId, Number(monto));
            const sessionId = resultado.sessionId;

            logger.info(`[WS_PARTIDA_CREADA] Usuario: ${userId} | SessionID: ${sessionId} | Monto: ${monto}`);

            const timeoutId = setTimeout(async () => {
                const sala = salasPendientes.get(sessionId);
                if (sala && sala.jugadores.length < 4) {
                    logger.warn(`[WS_SALA_EXPIRADA] SessionID: ${sessionId} | Razón: Menos de 4 jugadores | Jugadores: ${sala.jugadores.length}`);
                    for (const uid of sala.jugadores) {
                        try {
                            await recargarSaldo(uid, sala.monto);
                        } catch (e) {
                            logger.error(`[Sala expirada] No se pudo devolver saldo a ${uid}: ${e.message}`);
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
            logger.error(`[WS_CREAR_PARTIDA_ERROR] Usuario: ${payload.userId || 'DESCONOCIDO'} | Monto: ${payload.monto} | Error: ${err.message}`);
            socket.emit('error_notificacion', err.message);
        }
    });

    // 6. ACEPTAR PARTIDA 

    socket.on('aceptar_partida', async (payload = {}) => {
        try {
            const { userId } = authenticateSocketPayload(socket, payload);
            const { sessionId } = payload;
            const sala = salasPendientes.get(sessionId);
            if (!sala) throw new Error('Sala no encontrada o ya iniciada.');

            if (sala.jugadores.includes(userId)) {
                logger.warn(`[WS_ACEPTAR_PARTIDA_DUPLICATE] Usuario: ${userId} | SessionID: ${sessionId} | Razón: Ya está en la sala`);
                socket.emit('error_notificacion', 'Ya estás en la sala.');
                return;
            }

            if (sala.jugadores.length >= 4) {
                logger.warn(`[WS_ACEPTAR_PARTIDA_LLENA] Usuario: ${userId} | SessionID: ${sessionId} | Razón: Sala llena`);
                socket.emit('error_notificacion', 'La sala ya está llena.');
                return;
            }

            const resultado = await aceptarPartida(userId, sessionId);
            if (!resultado.success) throw new Error('No se pudo unir a la sala.');

            sala.jugadores.push(userId);
            logger.info(`[WS_USUARIO_UNIDO_SALA] Usuario: ${userId} | SessionID: ${sessionId} | Jugadores: ${sala.jugadores.length}/4`);

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
                logger.info(`[WS_JUEGO_INICIADO] SessionID: ${sessionId} | Jugadores: ${sala.jugadores.length} | Monto total: ${sala.monto * 4}`);
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
            logger.error(`[WS_ACEPTAR_PARTIDA_ERROR] Usuario: ${payload.userId || 'DESCONOCIDO'} | SessionID: ${payload.sessionId} | Error: ${err.message}`);
            socket.emit('error_notificacion', 'Error al unirse: ' + err.message);
        }
    });

    // 7. JUGAR CARTA

    socket.on('jugar_carta', async (payload = {}) => {
        try {
            const { userId } = authenticateSocketPayload(socket, payload);
            const { sessionId, card, capture } = payload;
            if (!userId || !sessionId || !card) {
                throw new Error('Faltan datos para jugar la carta.');
            }

            logger.debug(`[WS_JUGAR_CARTA] Usuario: ${userId} | SessionID: ${sessionId} | Carta: ${card}`);

            enviarAlMotor({
                action: 'PLAY_CARD',
                sessionId,
                playerId: userId,
                card,
                capture: capture || []
            }, io);

        } catch (err) {
            logger.warn(`[WS_JUGAR_CARTA_ERROR] Usuario: ${payload.userId || 'DESCONOCIDO'} | Error: ${err.message}`);
            socket.emit('error_notificacion', 'Error al jugar carta: ' + err.message);
        }
    });


    //  8. REGISTRAR GANADOR 

    socket.on('registrar_ganador', async (payload = {}) => {
        try {
            authenticateSocketPayload(socket, payload);
            const { sessionId, winnerId } = payload;
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

    // MONITOREO UDP DE LATENCIA

    socket.on('udp_ping_jugador', (payload = {}) => {
        let authUser;
        try {
            authUser = authenticateSocketPayload(socket, payload);
        } catch {
            return;
        }

        const userId = authUser.userId;
        const username = authUser.username || payload.username;
        const { sessionId } = payload;

        if (!userId || !sessionId) return;

        sendUdpPing({
            socketId: socket.id,
            userId,
            username,
            sessionId
        });
    });

    socket.on('disconnect', () => {
        logger.info(`Cliente desconectado: ${socket.id}`);

        const desconectadoUserId = socketToUser.get(socket.id);
        socketToUser.delete(socket.id);

        if (!desconectadoUserId || !jugadoresEnPartida.has(desconectadoUserId)) return;

        const playerInfo = jugadoresEnPartida.get(desconectadoUserId);
        const sessionId = playerInfo.sessionId;

        logger.warn(`[DESCONEXION] Usuario ${desconectadoUserId} desconectado de sesion ${sessionId}`);

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
                logger.error(`[TIMEOUT] Usuario ${desconectadoUserId} no se reconecto en 5 minutos. Cerrando sesion...`);

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
    logger.info(`SERVIDOR ACTIVO -> Puerto: ${PORT}`);
    logger.info(`BASE DE DATOS -> ${process.env.DB_NAME}`);
    startUdpMonitor(io);
});
