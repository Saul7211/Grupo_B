import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

function main() {
    const latestFile = pickLatestLogFile(logsDir);

    if (!latestFile) {
        console.log('No hay archivos de log disponibles en backend/logs');
        return;
    }

    const content = fs.readFileSync(latestFile, 'utf8');
    const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
    const counters = {};

    for (const line of lines) {
        const levelMatch = line.match(/\[([A-Z]+)\]/);
        if (!levelMatch) continue;

        const levelToken = levelMatch[1];
        counters[levelToken] = (counters[levelToken] || 0) + 1;
    }

    console.log(`Archivo analizado: ${path.basename(latestFile)}`);
    console.table(counters);
}

main();
