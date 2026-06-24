import logger from './index.js';

/**
 * Middleware para capturar y registrar ERRORES HTTP (4xx y 5xx)
 * Debe estar al final de la cadena de middlewares
 */
export function errorLogger(err, req, res, next) {
    const usuario = req.userId || req.username || 'ANONIMO';
    const metodo = req.method;
    const ruta = req.originalUrl || req.url;
    const statusCode = err.status || err.statusCode || 500;
    const mensaje = err.message || 'Error desconocido';
    const stack = err.stack || '';
    
    // Log detallado del error
    logger.error(
        `[ERROR_HTTP] Usuario: ${usuario} | Método: ${metodo} | Ruta: ${ruta} | Status: ${statusCode} | Mensaje: ${mensaje}`
    );
    
    // Si hay stack trace, registrarlo también
    if (stack) {
        logger.debug(`[ERROR_STACK] ${stack}`);
    }
    
    // Enviar respuesta de error al cliente
    res.status(statusCode).json({
        success: false,
        message: mensaje || 'Error interno del servidor',
        ...(process.env.NODE_ENV === 'development' && { stack })
    });
}

export default errorLogger;
