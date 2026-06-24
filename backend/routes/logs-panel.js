import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();   // ← ESTO FALTABA

const __dirname_logs = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname_logs, '..', 'logs');

// GET /logs/fechas  → días con archivo de log disponible
router.get('/fechas', (_req, res) => {
    try {
        const fechas = fs.readdirSync(LOGS_DIR)
            .filter(f => f.startsWith('application-') && f.endsWith('.log'))
            .map(f => f.replace('application-', '').replace('.log', ''))
            .sort().reverse();
        res.json({ success: true, fechas });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /logs/data?fecha=2026-06-24  → líneas parseadas de ese día
router.get('/data', (req, res) => {
    try {
        const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
        const file = path.join(LOGS_DIR, `application-${fecha}.log`);
        if (!fs.existsSync(file)) return res.json({ success: true, fecha, lineas: [] });

        const regex = /^\[(.+?)\]\s*\[(\w+)\]\s*([\s\S]*)$/;
        const lineas = fs.readFileSync(file, 'utf-8')
            .split('\n').filter(Boolean)
            .map(linea => {
                const m = linea.match(regex);
                return m
                    ? { timestamp: m[1], nivel: m[2].toUpperCase(), mensaje: m[3] }
                    : { timestamp: '', nivel: 'RAW', mensaje: linea };
            });
        res.json({ success: true, fecha, lineas });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;   // ← Y ESTO TAMBIÉN FALTABA