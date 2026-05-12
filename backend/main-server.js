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
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// EVENTOS SOCKET.IO

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

    // 2. LOGIN 

    socket.on('login_usuario', async ({ username, password }) => {
        try {
            if (!username || !password) throw new Error('Usuario y contraseña son obligatorios.');
            const resultado = await loginUsuario(username, password);
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

            socket.emit('partida_creada', {
                sessionId: resultado.sessionId,
                mensaje: `Sala creada. Esperando oponente por $${monto}`
            });

            io.emit('nueva_sala_disponible', {
                sessionId: resultado.sessionId,
                monto: Number(monto)
            });
        } catch (err) {
            socket.emit('error_notificacion', err.message);
        }
    });

    // 6. ACEPTAR PARTIDA 

    socket.on('aceptar_partida', async ({ userId, sessionId }) => {
        try {
            const resultado = await aceptarPartida(userId, sessionId);

            if (resultado.success) {
                console.log(`[aceptar_partida] Partida ${sessionId} iniciada. Enviando al motor...`);

                enviarAlMotor({
                    action: 'START_GAME',
                    sessionId,
                    players: [resultado.creadorId, userId],
                    totalPot: resultado.montoTotal
                }, io);

                io.emit('juego_iniciado', {
                    sessionId,
                    mensaje: '¡Ambos jugadores listos! El motor está barajando...'
                });
            }
        } catch (err) {
            socket.emit('error_notificacion', 'Error al unirse: ' + err.message);
        }
    });

    //  7. REGISTRAR GANADOR 

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
    });
});

// ── INICIO DEL SERVIDOR ───────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`  SERVIDOR ACTIVO   →  Puerto: ${PORT}`);
    console.log(`  BASE DE DATOS     →  ${process.env.DB_NAME}`);
});