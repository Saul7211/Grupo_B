import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Router } from 'express';
import logger from '../logger/index.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '..', 'logs');

/**
 * Obtiene el archivo de log más reciente
 */
function pickLatestLogFile(directory) {
    if (!fs.existsSync(directory)) return null;

    const files = fs.readdirSync(directory)
        .filter((name) => name.startsWith('application-') && name.endsWith('.log'))
        .map((name) => ({
            name,
            fullPath: path.join(directory, name),
            mtime: fs.statSync(path.join(directory, name)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime);

    return files[0]?.fullPath || null;
}

/**
 * GET /logs/resumen - Resumen general de logs
 */
router.get('/resumen', (req, res) => {
    try {
        const latestFile = pickLatestLogFile(logsDir);

        if (!latestFile) {
            return res.json({
                success: true,
                source: null,
                summary: {}
            });
        }

        const content = fs.readFileSync(latestFile, 'utf8');
        const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);

        const summary = {};
        for (const line of lines) {
            const levelMatch = line.match(/\[([A-Z]+)\]/);
            if (!levelMatch) continue;

            const levelToken = levelMatch[1];
            summary[levelToken] = (summary[levelToken] || 0) + 1;
        }

        logger.info(`Resumen de logs solicitado. Archivo analizado: ${path.basename(latestFile)}`);

        return res.json({
            success: true,
            source: path.basename(latestFile),
            summary
        });
    } catch (error) {
        logger.error(`Fallo al construir resumen de logs: ${error.message}`);
        return res.status(500).json({ success: false, message: 'No se pudo leer el resumen de logs' });
    }
});

/**
 * GET /logs/accesos - Todos los accesos a rutas (exitosos y errores)
 */
router.get('/accesos', (req, res) => {
    try {
        const latestFile = pickLatestLogFile(logsDir);
        const usuario = req.query.usuario || null;
        const tipo = req.query.tipo || null; // 'exitoso', 'error', 'todos'

        if (!latestFile) {
            return res.json({
                success: true,
                accesos: []
            });
        }

        const content = fs.readFileSync(latestFile, 'utf8');
        const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);

        const accesos = [];
        
        for (const line of lines) {
            // Buscar líneas de acceso a rutas
            const accesoMatch = line.match(/\[(.*?)\] \[(WARN|INFO|ERROR)\] \[(ACCESO|ERROR_ACCESO)\](.*)/);
            
            if (accesoMatch) {
                const timestamp = accesoMatch[1];
                const nivel = accesoMatch[2];
                const tipo_acceso = accesoMatch[3];
                const detalles = accesoMatch[4];
                
                // Extraer usuario, método, ruta, status
                const usuarioMatch = detalles.match(/Usuario:\s*(\S+)/);
                const metodoMatch = detalles.match(/Método:\s*(\w+)/);
                const rutaMatch = detalles.match(/Ruta:\s*(\S+)/);
                const statusMatch = detalles.match(/Status:\s*(\d+)/);
                const duracionMatch = detalles.match(/(\d+)ms/);
                
                const acceso = {
                    timestamp,
                    usuario: usuarioMatch ? usuarioMatch[1] : 'DESCONOCIDO',
                    metodo: metodoMatch ? metodoMatch[1] : 'N/A',
                    ruta: rutaMatch ? rutaMatch[1] : 'N/A',
                    status: statusMatch ? parseInt(statusMatch[1]) : 0,
                    duracion: duracionMatch ? parseInt(duracionMatch[1]) : 0,
                    exito: tipo_acceso === 'ACCESO' && nivel !== 'ERROR',
                    error: tipo_acceso === 'ERROR_ACCESO' || nivel === 'ERROR'
                };
                
                // Filtrar por usuario si se especifica
                if (usuario && acceso.usuario.toLowerCase() !== usuario.toLowerCase()) {
                    continue;
                }
                
                // Filtrar por tipo de acceso
                if (tipo === 'exitoso' && acceso.error) continue;
                if (tipo === 'error' && acceso.exito) continue;
                
                accesos.push(acceso);
            }
        }

        logger.info(`Accesos solicitados. Filtro usuario: ${usuario || 'TODOS'}, tipo: ${tipo || 'TODOS'}`);

        return res.json({
            success: true,
            filtros: {
                usuario: usuario || 'TODOS',
                tipo: tipo || 'TODOS'
            },
            total: accesos.length,
            accesos: accesos.slice(-100) // Últimos 100 accesos
        });
    } catch (error) {
        logger.error(`Fallo al obtener accesos: ${error.message}`);
        return res.status(500).json({ success: false, message: 'No se pudo leer los accesos' });
    }
});

/**
 * GET /logs/errores - Solo errores y accesos fallidos
 */
router.get('/errores', (req, res) => {
    try {
        const latestFile = pickLatestLogFile(logsDir);
        const usuario = req.query.usuario || null;

        if (!latestFile) {
            return res.json({
                success: true,
                errores: []
            });
        }

        const content = fs.readFileSync(latestFile, 'utf8');
        const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);

        const errores = [];
        
        for (const line of lines) {
            // Buscar líneas de ERROR
            if (!line.includes('[ERROR]') && !line.includes('[ERROR_ACCESO]')) {
                continue;
            }
            
            const errorMatch = line.match(/\[(.*?)\] \[(ERROR[^\]]*)\](.*)/);
            
            if (errorMatch) {
                const timestamp = errorMatch[1];
                const nivel = errorMatch[2];
                const mensaje = errorMatch[3];
                
                // Extraer usuario si está disponible
                const usuarioMatch = mensaje.match(/Usuario:\s*(\S+)/);
                const rutaMatch = mensaje.match(/Ruta:\s*(\S+)/);
                const statusMatch = mensaje.match(/Status:\s*(\d+)/);
                
                const error_obj = {
                    timestamp,
                    usuario: usuarioMatch ? usuarioMatch[1] : 'DESCONOCIDO',
                    ruta: rutaMatch ? rutaMatch[1] : 'N/A',
                    status: statusMatch ? parseInt(statusMatch[1]) : 0,
                    mensaje: mensaje.trim()
                };
                
                // Filtrar por usuario si se especifica
                if (usuario && error_obj.usuario.toLowerCase() !== usuario.toLowerCase()) {
                    continue;
                }
                
                errores.push(error_obj);
            }
        }

        logger.info(`Errores solicitados. Filtro usuario: ${usuario || 'TODOS'}`);

        return res.json({
            success: true,
            usuario_filtro: usuario || 'TODOS',
            total: errores.length,
            errores: errores.slice(-50) // Últimos 50 errores
        });
    } catch (error) {
        logger.error(`Fallo al obtener errores: ${error.message}`);
        return res.status(500).json({ success: false, message: 'No se pudo leer los errores' });
    }
});

/**
 * GET /logs/usuario/:username - Todos los accesos y errores de un usuario específico
 */
router.get('/usuario/:username', (req, res) => {
    try {
        const latestFile = pickLatestLogFile(logsDir);
        const username = req.params.username.toUpperCase();

        if (!latestFile) {
            return res.json({
                success: true,
                usuario: username,
                accesos: [],
                errores: []
            });
        }

        const content = fs.readFileSync(latestFile, 'utf8');
        const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);

        const accesos = [];
        const errores = [];
        
        for (const line of lines) {
            const usuarioMatch = line.match(/Usuario:\s*(\S+)/);
            if (!usuarioMatch) continue;
            
            const usuario = usuarioMatch[1].toUpperCase();
            if (usuario !== username) continue;
            
            // Procesar líneas de este usuario
            if (line.includes('[ERROR]') || line.includes('[ERROR_ACCESO]')) {
                const errorMatch = line.match(/\[(.*?)\] \[(ERROR[^\]]*)\](.*)/);
                if (errorMatch) {
                    errores.push({
                        timestamp: errorMatch[1],
                        nivel: errorMatch[2],
                        mensaje: errorMatch[3].trim()
                    });
                }
            } else if (line.includes('[ACCESO]')) {
                const accesoMatch = line.match(/\[(.*?)\] \[(.*?)\] \[(ACCESO)\](.*)/);
                if (accesoMatch) {
                    accesos.push({
                        timestamp: accesoMatch[1],
                        nivel: accesoMatch[2],
                        detalles: accesoMatch[4].trim()
                    });
                }
            }
        }

        logger.info(`Logs del usuario ${username} solicitados. Accesos: ${accesos.length}, Errores: ${errores.length}`);

        return res.json({
            success: true,
            usuario: username,
            resumen: {
                total_accesos: accesos.length,
                total_errores: errores.length
            },
            accesos: accesos.slice(-50),
            errores: errores.slice(-20)
        });
    } catch (error) {
        logger.error(`Fallo al obtener logs de usuario: ${error.message}`);
        return res.status(500).json({ success: false, message: 'No se pudo leer los logs del usuario' });
    }
});

export default router;
