import { Router } from 'express';
import logger from '../logger/index.js';

const router = Router();

router.get('/', (req, res) => {
    logger.info('Consulta general de usuarios');

    res.json({
        success: true,
        message: 'Ruta de prueba de usuarios',
        users: [
            { id: 1, username: 'alice' },
            { id: 2, username: 'bob' }
        ]
    });
});

router.get('/:id', (req, res) => {
    const id = Number(req.params.id);

    logger.debug(`Consulta de usuario por id: ${req.params.id}`);

    if (!Number.isInteger(id) || id <= 0) {
        logger.warn(`ID invalido recibido en /users/:id -> ${req.params.id}`);
        return res.status(400).json({ success: false, message: 'ID invalido' });
    }

    if (id === 99) {
        logger.error('Error simulado para ID prohibido 99');
        return res.status(500).json({ success: false, message: 'Error simulado para laboratorio' });
    }

    return res.json({
        success: true,
        user: { id, username: `user_${id}` }
    });
});

export default router;
