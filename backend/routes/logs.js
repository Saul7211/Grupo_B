import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Router } from 'express';
import logger from '../logger/index.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '..', 'logs');

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

export default router;
