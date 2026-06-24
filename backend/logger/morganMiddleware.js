import morgan from 'morgan';
import logger from './index.js';

const stream = {
    write: (message) => {
        logger.http(message.trim());
    }
};

// Formato mejorado: Método | URL | Status | Tiempo | Usuario
morgan.token('usuario', (req) => {
    return req.userId ? `Usuario:${req.userId}` : 'ANONIMO';
});

morgan.token('parametros', (req) => {
    const params = req.params ? Object.keys(req.params).length : 0;
    const query = req.query ? Object.keys(req.query).length : 0;
    return params > 0 || query > 0 ? `[${params}params,${query}query]` : '';
});

const morganMiddleware = morgan(
    ':usuario | :method :url :status :parametros | :response-time ms',
    { stream }
);

export default morganMiddleware;
