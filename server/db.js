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

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Initialize tables
db.exec(`
    CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
    );
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
    CREATE TABLE IF NOT EXISTS album_spines (
        spotify_id TEXT PRIMARY KEY,
        spine_url TEXT,
        last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// ---------------------------------------------------------------------------
// Config management (Spotify credentials, session secret, base URL)
// These are entered by the user via the setup/settings UI.
// ---------------------------------------------------------------------------

// Auto-generate a session secret on first run
const existingSecret = db.prepare('SELECT value FROM config WHERE key = ?').get('sessionSecret');
if (!existingSecret) {
    const generated = crypto.randomBytes(48).toString('hex');
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('sessionSecret', generated);
    console.log('[CD-Display] Generated new session secret');
}

function getConfig(key) {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    return row ? row.value : null;
}

function setConfig(key, value) {
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
}

function getAllConfig() {
    const rows = db.prepare('SELECT key, value FROM config').all();
    const config = {};
    rows.forEach(row => {
        // Don't expose the session secret to the frontend
        if (row.key !== 'sessionSecret') {
            // Mask the client secret for display
            if (row.key === 'spotifyClientSecret' && row.value) {
                config[row.key] = row.value.substring(0, 4) + '••••••••' + row.value.substring(row.value.length - 4);
            } else {
                config[row.key] = row.value;
            }
        }
    });
    return config;
}

function isSetupComplete() {
    const clientId = getConfig('spotifyClientId');
    const clientSecret = getConfig('spotifyClientSecret');
    return !!(clientId && clientSecret);
}

function getSessionSecret() {
    return getConfig('sessionSecret');
}

function getSpotifyCredentials() {
    return {
        clientId: getConfig('spotifyClientId'),
        clientSecret: getConfig('spotifyClientSecret'),
        baseUrl: getConfig('baseUrl') || 'http://localhost:3000'
    };
}

// ---------------------------------------------------------------------------
// Encryption helpers for token storage
// ---------------------------------------------------------------------------
const algorithm = 'aes-256-cbc';

function getEncryptionKey() {
    const secret = getSessionSecret() || 'fallback-key';
    return crypto.createHash('sha256').update(String(secret)).digest('base64').substring(0, 32);
}

function encrypt(text) {
    if (!text) return text;
    const secretKey = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, Buffer.from(secretKey), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    if (!text) return text;
    try {
        const secretKey = getEncryptionKey();
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv(algorithm, Buffer.from(secretKey), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        console.error('[CD-Display] Token decryption failed — tokens may need to be re-created');
        return null;
    }
}

// ---------------------------------------------------------------------------
// Display settings (display mode, sort order, theme, etc.)
// ---------------------------------------------------------------------------
const defaultSettings = {
    displayMode: 'covers',
    sortOrder: 'added',
    theme: 'dark',
    autoScroll: 'false',
    screenSleepMinutes: '30'
};

const stmtInsertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultSettings)) {
    stmtInsertSetting.run(key, value);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
    // Config
    getConfig,
    setConfig,
    getAllConfig,
    isSetupComplete,
    getSessionSecret,
    getSpotifyCredentials,

    // Display settings
    getSettings: () => {
        const rows = db.prepare('SELECT key, value FROM settings').all();
        const settings = {};
        rows.forEach(row => {
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

    // Album cache
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

    // Spine cache
    getSpineCache: (spotifyId) => {
        const row = db.prepare('SELECT spine_url FROM album_spines WHERE spotify_id = ?').get(spotifyId);
        return row ? { spineUrl: row.spine_url } : null;
    },
    setSpineCache: (spotifyId, spineUrl) => {
        db.prepare('INSERT OR REPLACE INTO album_spines (spotify_id, spine_url, last_checked) VALUES (?, ?, CURRENT_TIMESTAMP)').run(spotifyId, spineUrl || '');
    },

    // Token storage (encrypted)
    saveTokens: (accessToken, refreshToken, expiresInSeconds) => {
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
        db.prepare('INSERT OR REPLACE INTO tokens (id, access_token, refresh_token, expires_at) VALUES (1, ?, ?, ?)')
            .run(encrypt(accessToken), encrypt(refreshToken), expiresAt);
    },
    getTokens: () => {
        const row = db.prepare('SELECT access_token, refresh_token, expires_at FROM tokens WHERE id = 1').get();
        if (row) {
            const accessToken = decrypt(row.access_token);
            const refreshToken = decrypt(row.refresh_token);
            if (!accessToken || !refreshToken) return null;
            return {
                accessToken,
                refreshToken,
                expiresAt: new Date(row.expires_at)
            };
        }
        return null;
    },
    clearTokens: () => {
        db.prepare('DELETE FROM tokens WHERE id = 1').run();
    }
};
