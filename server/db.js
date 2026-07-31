const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'cd-music-display.db'));

// Encryption configuration for tokens
const algorithm = 'aes-256-cbc';
// Pad or truncate secret to 32 bytes for AES-256
const rawSecret = process.env.SESSION_SECRET || 'fallback-secret-key-change-in-production';
const secretKey = crypto.createHash('sha256').update(String(rawSecret)).digest('base64').substring(0, 32);

function encrypt(text) {
    if (!text) return text;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, Buffer.from(secretKey), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    if (!text) return text;
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(algorithm, Buffer.from(secretKey), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

// Initialize tables
db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );
    CREATE TABLE IF NOT EXISTS albums_cache (
        id INTEGER PRIMARY KEY DEFAULT 1,
        data TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY DEFAULT 1,
        access_token TEXT,
        refresh_token TEXT,
        expires_at DATETIME
    );
`);

const defaultSettings = {
    displayMode: 'covers',
    sortOrder: 'added',
    theme: 'dark',
    autoScroll: 'false',
    screenSleepMinutes: '30'
};

// Insert defaults if not present
const stmtInsertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultSettings)) {
    stmtInsertSetting.run(key, value);
}

module.exports = {
    getSettings: () => {
        const rows = db.prepare('SELECT key, value FROM settings').all();
        const settings = {};
        rows.forEach(row => {
            // Parse boolean/number strings for convenience
            let val = row.value;
            if (val === 'true') val = true;
            else if (val === 'false') val = false;
            else if (!isNaN(val) && val !== '') val = Number(val);
            settings[row.key] = val;
        });
        return settings;
    },
    saveSetting: (key, value) => {
        const valStr = String(value);
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, valStr);
    },
    getCachedAlbums: () => {
        const row = db.prepare('SELECT data, updated_at FROM albums_cache WHERE id = 1').get();
        if (row) {
            return { albums: JSON.parse(row.data), updatedAt: new Date(row.updated_at) };
        }
        return null;
    },
    cacheAlbums: (albums) => {
        db.prepare('INSERT OR REPLACE INTO albums_cache (id, data, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)').run(JSON.stringify(albums));
    },
    saveTokens: (accessToken, refreshToken, expiresInSeconds) => {
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
        db.prepare('INSERT OR REPLACE INTO tokens (id, access_token, refresh_token, expires_at) VALUES (1, ?, ?, ?)')
            .run(encrypt(accessToken), encrypt(refreshToken), expiresAt);
    },
    getTokens: () => {
        const row = db.prepare('SELECT access_token, refresh_token, expires_at FROM tokens WHERE id = 1').get();
        if (row) {
            return {
                accessToken: decrypt(row.access_token),
                refreshToken: decrypt(row.refresh_token),
                expiresAt: new Date(row.expires_at)
            };
        }
        return null;
    },
    clearTokens: () => {
        db.prepare('DELETE FROM tokens WHERE id = 1').run();
    }
};
