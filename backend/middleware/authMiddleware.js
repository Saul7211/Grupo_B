import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'juego40-dev-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';
const RECOVERY_TOKEN_EXPIRES_IN = process.env.RECOVERY_TOKEN_EXPIRES_IN || '15m';

//Genera un token JWT para autenticación del usuario.
export function createAuthToken(user) {
    return jwt.sign(
        {
            userId: user.userId,
            username: user.username
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

//Verifica que un token JWT sea válido.
export function verifyAuthToken(token) {
    if (!token) {
        throw new Error('Token de autenticacion requerido.');
    }

    return jwt.verify(token, JWT_SECRET);
}

//Genera un token especial para recuperación de contraseña.
export function createRecoveryToken(user) {
    return jwt.sign(
        {
            userId: user.userId,
            username: user.username,
            tipo: 'recuperacion'
        },
        JWT_SECRET,
        { expiresIn: RECOVERY_TOKEN_EXPIRES_IN }
    );
}

export function verifyRecoveryToken(token) {
    const decoded = verifyAuthToken(token);

    if (decoded.tipo !== 'recuperacion') {
        throw new Error('Token no valido para recuperacion.');
    }

    return decoded;
}

export function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];

    try {
        const decoded = verifyAuthToken(token);
        req.userId = decoded.userId;
        req.username = decoded.username;
        next();
    } catch {
        res.status(403).json({ success: false, message: 'Token no valido o expirado' });
    }
}

export function authenticateSocketPayload(socket, payload = {}) {
    const token = payload.token || socket.data.token;
    const decoded = verifyAuthToken(token);

    if (payload.userId && payload.userId !== decoded.userId) {
        throw new Error('El token no corresponde al usuario solicitado.');
    }

    socket.data.token = token;
    socket.data.userId = decoded.userId;
    socket.data.username = decoded.username;

    return decoded;
}
