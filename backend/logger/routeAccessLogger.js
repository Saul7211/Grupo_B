import logger from './index.js';

/**
 * Middleware para registrar TODOS los accesos a rutas HTTP
 * Registra: usuario, ruta, método, parámetros, código de estado, errores
 */
export function routeAccessLogger(req, res, next) {
    // Guardar la función original de res.json para interceptar respuestas
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    
    // Capturar el momento del inicio
    const startTime = Date.now();
    const usuario = req.userId || req.username || 'ANONIMO';
    const metodo = req.method;
    const ruta = req.originalUrl || req.url;
    
    // Interceptar respuestas JSON
    res.json = function(data) {
        const duracion = Date.now() - startTime;
        const statusCode = res.statusCode;
        
        registrarAcceso({
            usuario,
            metodo,
            ruta,
            statusCode,
            duracion,
            tipoRespuesta: 'JSON',
            exito: statusCode < 400,
            datos: data
        });
        
        return originalJson(data);
    };
    
    // Interceptar respuestas de envío directo
    res.send = function(data) {
        const duracion = Date.now() - startTime;
        const statusCode = res.statusCode;
        
        registrarAcceso({
            usuario,
            metodo,
            ruta,
            statusCode,
            duracion,
            tipoRespuesta: 'TEXT',
            exito: statusCode < 400,
            datos: data
        });
        
        return originalSend(data);
    };
    
    // Capturar errores que se pasen al siguiente middleware
    res.on('finish', () => {
        const duracion = Date.now() - startTime;
        const statusCode = res.statusCode;
        
        // Si no fue registrado por json o send, registrarlo aquí
        if (!res.headersSent && statusCode >= 400) {
            registrarAcceso({
                usuario,
                metodo,
                ruta,
                statusCode,
                duracion,
                tipoRespuesta: 'ERROR',
                exito: false,
                datos: { error: `HTTP ${statusCode}` }
            });
        }
    });
    
    next();
}

/**
 * Registra un acceso a una ruta
 */
function registrarAcceso(datos) {
    const { usuario, metodo, ruta, statusCode, duracion, exito, tipoRespuesta } = datos;
    
    if (exito) {
        logger.info(
            `[ACCESO] Usuario: ${usuario} | Método: ${metodo} | Ruta: ${ruta} | Status: ${statusCode} | ${duracion}ms`
        );
    } else {
        logger.warn(
            `[ERROR_ACCESO] Usuario: ${usuario} | Método: ${metodo} | Ruta: ${ruta} | Status: ${statusCode} | ${duracion}ms`
        );
    }
}

export default routeAccessLogger;
