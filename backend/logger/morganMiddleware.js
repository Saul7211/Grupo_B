import morgan from 'morgan';
import logger from './index.js';

const stream = {
    write: (message) => {
        logger.http(message.trim());
    }
};

const morganMiddleware = morgan(':method :url :status :response-time ms', { stream });

export default morganMiddleware;
