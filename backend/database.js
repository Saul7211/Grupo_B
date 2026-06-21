import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import logger from './logger/index.js';

dotenv.config();

// Pool de conexiones a MySQL
export const pool = mysql.createPool({
    host:     process.env.DB_HOST,
    port:     process.env.DB_PORT,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
});

// Verificar conexión al arrancar
pool.getConnection()
    .then(conn => {
        logger.info('[DB] Conexion a MySQL exitosa.');
        conn.release();
    })
    .catch(err => {
        logger.error(`[DB] Error al conectar con MySQL: ${err.message}`);
        process.exit(1);
    });

//AUTENTICACIÓN

 //Registra un usuario nuevo con contraseña hasheada.
 //Lanza error si el username ya existe.

export async function registrarUsuario(username, password) {
    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);

    try {
        await pool.execute(
            'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
            [id, username, passwordHash]
        );
        return { success: true, userId: id, username };
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            throw new Error('El nombre de usuario ya está en uso.');
        }
        throw err;
    }
}


 //Valida credenciales y devuelve el usuario si son correctas.
 //Lanza error si el usuario no existe o la contraseña no coincide.

export async function loginUsuario(username, password) {
    const [rows] = await pool.execute(
        'SELECT id, username, password_hash, balance FROM users WHERE username = ?',
        [username]
    );

    if (rows.length === 0) throw new Error('Usuario no encontrado.');

    const user = rows[0];
    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) throw new Error('Contraseña incorrecta.');

    return {
        success: true,
        userId:  user.id,
        username: user.username,
        balance: user.balance,
    };
}

// SALDO


//Recarga saldo a un usuario y registra la transacción.
// El monto debe ser positivo.

export async function recargarSaldo(userId, monto) {
    if (monto <= 0) throw new Error('El monto de recarga debe ser mayor a 0.');

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        await connection.execute(
            'UPDATE users SET balance = balance + ? WHERE id = ?',
            [monto, userId]
        );

        await connection.execute(
            'INSERT INTO transactions (id, user_id_fk, amount, type) VALUES (UUID(), ?, ?, "deposit")',
            [userId, monto]
        );

        // Devolver el saldo actualizado
        const [rows] = await connection.execute(
            'SELECT balance FROM users WHERE id = ?',
            [userId]
        );

        await connection.commit();
        return { success: true, nuevoSaldo: rows[0].balance };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// APUESTAS 

export async function registrarApuesta(userId, sessionId, monto) {
    await pool.execute(
        'INSERT INTO transactions (id, user_id_fk, game_session_id_fk, amount, type) VALUES (UUID(), ?, ?, ?, "bet")',
        [userId, sessionId, monto]
    );
}

// PARTIDAS

export async function crearPartida(userId, monto) {
    const connection = await pool.getConnection();
    const sessionId = uuidv4();
    try {
        await connection.beginTransaction();

        // 1. Validar saldo y descontarlo al creador
        const [res] = await connection.execute(
            'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
            [monto, userId, monto]
        );
        if (res.affectedRows === 0) throw new Error('Saldo insuficiente.');

        // 2. Crear la sesión guardando quién la creó
        await connection.execute(
            'INSERT INTO game_sessions (id, creator_id_fk, total_pot, status, game_type) VALUES (?, ?, ?, "waiting", "40_classic")',
            [sessionId, userId, monto]
        );

        // 3. Registrar la transacción de apuesta del creador
        await connection.execute(
            'INSERT INTO transactions (id, user_id_fk, game_session_id_fk, amount, type) VALUES (UUID(), ?, ?, ?, "bet")',
            [userId, sessionId, monto]
        );

        await connection.commit();
        return { success: true, sessionId };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

export async function aceptarPartida(userId, sessionId) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Obtener sesión y verificar que el que acepta no sea el mismo creador
        const [session] = await connection.execute(
            'SELECT total_pot, creator_id_fk FROM game_sessions WHERE id = ? AND status = "waiting"',
            [sessionId]
        );
        if (session.length === 0) throw new Error('Partida no encontrada o ya iniciada.');
        if (session[0].creator_id_fk === userId) throw new Error('No puedes unirte a tu propia partida.');

        // 2. Contar cuántos jugadores ya están en la sala (apuestas registradas)
        const [apuestas] = await connection.execute(
            'SELECT COUNT(DISTINCT user_id_fk) as numJugadores FROM transactions WHERE game_session_id_fk = ? AND type = "bet"',
            [sessionId]
        );
        const numJugadores = apuestas[0].numJugadores;
        if (numJugadores >= 4) throw new Error('La sala ya está llena.');

        // 3. Validar saldo y descontarlo al jugador
        const monto = session[0].total_pot;
        const creadorId = session[0].creator_id_fk;
        const [res] = await connection.execute(
            'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
            [monto, userId, monto]
        );
        if (res.affectedRows === 0) throw new Error('Saldo insuficiente.');

        // 4. Sumar al pozo (no cambiar status aún)
        await connection.execute(
            'UPDATE game_sessions SET total_pot = total_pot + ? WHERE id = ?',
            [monto, sessionId]
        );

        // 5. Registrar la transacción de apuesta
        await connection.execute(
            'INSERT INTO transactions (id, user_id_fk, game_session_id_fk, amount, type) VALUES (UUID(), ?, ?, ?, "bet")',
            [userId, sessionId, monto]
        );

        // 6. Si es el cuarto jugador, cambiar status a 'active'
        let salaLlena = false;
        if (numJugadores + 1 === 4) {
            await connection.execute(
                'UPDATE game_sessions SET status = "active" WHERE id = ?',
                [sessionId]
            );
            salaLlena = true;
        }

        await connection.commit();
        return { success: true, montoTotal: monto * (numJugadores + 1), creadorId, salaLlena };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// RESULTADOS 

export async function registrarGanador(sessionId, winnerId) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Obtener el pozo total
        const [session] = await connection.execute(
            'SELECT total_pot FROM game_sessions WHERE id = ? AND status = "active"',
            [sessionId]
        );
        if (session.length === 0) throw new Error('Sesión no encontrada o no está activa.');
        const totalPot = session[0].total_pot;

        // 2. Acreditar el pozo al ganador
        await connection.execute(
            'UPDATE users SET balance = balance + ? WHERE id = ?',
            [totalPot, winnerId]
        );

        // 3. Marcar la sesión como finalizada
        await connection.execute(
            'UPDATE game_sessions SET status = "finished", winner_id_fk = ? WHERE id = ?',
            [winnerId, sessionId]
        );

        // 4. Registrar la transacción de ganancia
        await connection.execute(
            'INSERT INTO transactions (id, user_id_fk, game_session_id_fk, amount, type) VALUES (UUID(), ?, ?, ?, "win")',
            [winnerId, sessionId, totalPot]
        );

        await connection.commit();
        return { success: true, totalPot };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// LOGIN/REGISTRO CON GOOGLE
export async function loginOrRegisterGoogle({ email, displayName, googleId }) {
    const claveUnica    = email || `google_${googleId}`; // llave única (columna username)
    const nombreVisible = displayName || claveUnica;      // lo que se muestra en pantalla

    const [rows] = await pool.execute(
        'SELECT id, balance FROM users WHERE username = ?',
        [claveUnica]
    );
    if (rows.length > 0) {
        const u = rows[0];
        return { success: true, userId: u.id, username: nombreVisible, balance: u.balance };
    }

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(uuidv4(), 10); // aleatorio, nunca se usa
    try {
        await pool.execute(
            'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
            [id, claveUnica, passwordHash]
        );
        return { success: true, userId: id, username: nombreVisible, balance: 0 };
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            const [again] = await pool.execute('SELECT id, balance FROM users WHERE username = ?', [claveUnica]);
            const u = again[0];
            return { success: true, userId: u.id, username: nombreVisible, balance: u.balance };
        }
        throw err;
    }
}