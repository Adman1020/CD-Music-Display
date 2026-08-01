const express = require('express');
const db = require('../db');
const spotify = require('../spotify');
const router = express.Router();

// ---------------------------------------------------------------------------
// Config endpoints (no auth required — needed before Spotify login)
// ---------------------------------------------------------------------------

// GET /api/setup — Check if initial setup is complete
router.get('/setup', (req, res) => {
    res.json({
        complete: db.isSetupComplete(),
        config: db.getAllConfig()
    });
});

// GET /api/config — Get current config (secrets masked)
router.get('/config', (req, res) => {
    res.json(db.getAllConfig());
});

// PUT /api/config — Save a config value
router.put('/config', (req, res) => {
    try {
        const { key, value } = req.body;
        const allowedKeys = ['spotifyClientId', 'spotifyClientSecret', 'baseUrl', 'aiProvider', 'aiApiKey', 'aiModel', 'aiRateLimit'];
        
        if (!key || !allowedKeys.includes(key)) {
            return res.status(400).json({ error: `Invalid config key. Allowed: ${allowedKeys.join(', ')}` });
        }
        if (value === undefined || value === null) {
            return res.status(400).json({ error: 'Missing value' });
        }

        db.setConfig(key, value.trim());
        
        // When credentials change, clear existing tokens (they're now invalid)
        if (key === 'spotifyClientId' || key === 'spotifyClientSecret') {
            db.clearTokens();
        }
        
        console.log(`[CD-Display] Config updated: ${key}`);
        res.json({ success: true, setupComplete: db.isSetupComplete() });
    } catch (error) {
        console.error('[CD-Display] Error saving config:', error);
        res.status(500).json({ error: 'Failed to save config' });
    }
});

// POST /api/config/save — Bulk save all config at once (for setup form)
router.post('/config/save', (req, res) => {
    try {
        const { spotifyClientId, spotifyClientSecret, baseUrl } = req.body;
        
        if (!spotifyClientId || !spotifyClientSecret) {
            return res.status(400).json({ error: 'Client ID and Client Secret are required' });
        }
        
        db.setConfig('spotifyClientId', spotifyClientId.trim());
        db.setConfig('spotifyClientSecret', spotifyClientSecret.trim());
        db.setConfig('baseUrl', (baseUrl || 'http://localhost:3000').trim());
        
        // Clear any stale tokens
        db.clearTokens();
        
        console.log('[CD-Display] Setup configuration saved');
        res.json({ success: true, setupComplete: true });
    } catch (error) {
        console.error('[CD-Display] Error saving setup config:', error);
        res.status(500).json({ error: 'Failed to save configuration' });
    }
});

// ---------------------------------------------------------------------------
// Auth middleware — all routes below require Spotify authentication
// ---------------------------------------------------------------------------
router.use((req, res, next) => {
    // Allow settings and config endpoints through without auth
    if (req.path === '/settings' && req.method === 'GET') return next();
    if (req.path === '/settings' && req.method === 'PUT') return next();
    
    const tokens = db.getTokens();
    if (!tokens) {
        return res.status(401).json({ error: 'Unauthorized: Please authenticate with Spotify first' });
    }
    next();
});

// Helper to fetch all albums from Spotify
async function fetchAllAlbums() {
    let allAlbums = [];
    let offset = 0;
    const limit = 50;
    let hasMore = true;

    while (hasMore) {
        const data = await spotify.getUserAlbums(offset, limit);
        if (!data || !data.items || data.items.length === 0) {
            hasMore = false;
        } else {
            const parsedAlbums = data.items.map(item => {
                const album = item.album;
                return {
                    id: album.id,
                    name: album.name,
                    artist: album.artists.map(a => a.name).join(', '),
                    image: album.images.length > 0 ? album.images[0].url : null,
                    uri: album.uri,
                    releaseDate: album.release_date,
                    addedAt: item.added_at,
                    totalTracks: album.total_tracks,
                    spotifyUrl: album.external_urls.spotify
                };
            });
            allAlbums = allAlbums.concat(parsedAlbums);
            offset += limit;
            if (data.next === null) {
                hasMore = false;
            }
        }
    }
    return allAlbums;
}

// GET /albums - Returns cached or fetched albums
router.get('/albums', async (req, res) => {
    try {
        const cached = db.getCachedAlbums();
        // Check if cache is fresh (< 1 hour old)
        if (cached && (new Date() - cached.updatedAt < 60 * 60 * 1000)) {
            console.log('[CD-Display] Returning cached albums');
            return res.json(cached.albums);
        }

        console.log('[CD-Display] Cache miss or expired. Fetching albums from Spotify...');
        const albums = await fetchAllAlbums();
        db.cacheAlbums(albums);
        res.json(albums);
    } catch (error) {
        console.error('[CD-Display] Error fetching albums:', error);
        res.status(500).json({ error: 'Failed to fetch albums' });
    }
});

// GET /albums/refresh - Force re-fetches from Spotify
router.get('/albums/refresh', async (req, res) => {
    try {
        console.log('[CD-Display] Force refreshing albums...');
        const albums = await fetchAllAlbums();
        db.cacheAlbums(albums);
        res.json({ success: true, count: albums.length, albums });
    } catch (error) {
        console.error('[CD-Display] Error refreshing albums:', error);
        res.status(500).json({ error: 'Failed to refresh albums' });
    }
});

// GET /albums/:id/spine - Return cached spine artwork or default fallback values without circumventing background AI verification
router.get('/albums/:id/spine', (req, res) => {
    try {
        const spotifyId = req.params.id;
        const cached = db.getSpineCache(spotifyId);
        if (cached) {
            return res.json({ spineUrl: cached.spineUrl || null, spineType: cached.spineType || null, spineWidth: cached.spineWidth || 28, coverUrl: cached.coverUrl || null });
        }
        // Return default values; let the background worker process the album properly with AI Vision
        res.json({ spineUrl: null, spineType: 'none', spineWidth: 28, coverUrl: null });
    } catch (e) {
        res.json({ spineUrl: null, spineType: 'none', spineWidth: 28, coverUrl: null });
    }
});

// GET /worker/logs - Returns the background worker logs and status
router.get('/worker/logs', (req, res) => {
    try {
        const worker = require('../worker');
        res.json({ logs: worker.getLogs(), status: worker.getStatus() });
    } catch (e) {
        res.json({ logs: [], status: {} });
    }
});

// POST /worker/reprocess - Triggers a fresh scan of all albums with current settings
router.post('/worker/reprocess', (req, res) => {
    try {
        const worker = require('../worker');
        worker.reprocessAll();
        res.json({ success: true, status: worker.getStatus() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /worker/clear-spines - Clears SQLite spine cache and removes physical files from /data/
router.post('/worker/clear-spines', (req, res) => {
    try {
        db.clearSpineCache();
        res.json({ success: true, count: 0 });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /worker/test-batch - Triggers processing a small test batch of albums in AI Testing Mode
router.post('/worker/test-batch', (req, res) => {
    try {
        const worker = require('../worker');
        const count = parseInt(req.body?.count, 10) || 5;
        worker.startTestBatch(count);
        res.json({ success: true, count, status: worker.getStatus() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /player - Returns current playback state
router.get('/player', async (req, res) => {
    try {
        const state = await spotify.getPlaybackState();
        res.json(state || { is_playing: false }); // 204 No Content returns null
    } catch (error) {
        res.status(500).json({ error: 'Failed to get playback state' });
    }
});

// PUT /player/play - Starts playback
router.put('/player/play', async (req, res) => {
    try {
        const { context_uri, device_id } = req.body;
        await spotify.startPlayback(context_uri, device_id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to start playback' });
    }
});

// PUT /player/pause - Pauses playback
router.put('/player/pause', async (req, res) => {
    try {
        await spotify.pausePlayback();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to pause playback' });
    }
});

// POST /player/next - Next track
router.post('/player/next', async (req, res) => {
    try {
        await spotify.nextTrack();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to skip to next track' });
    }
});

// POST /player/previous - Previous track
router.post('/player/previous', async (req, res) => {
    try {
        await spotify.previousTrack();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to skip to previous track' });
    }
});

// PUT /player/seek - Seek to position
router.put('/player/seek', async (req, res) => {
    try {
        const { position_ms } = req.body;
        if (position_ms === undefined) return res.status(400).json({ error: 'Missing position_ms' });
        await spotify.seekToPosition(position_ms);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to seek position' });
    }
});

// GET /devices - Lists Spotify Connect devices
router.get('/devices', async (req, res) => {
    try {
        const devices = await spotify.getDevices();
        res.json(devices);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get devices' });
    }
});

// PUT /player/transfer - Transfer playback
router.put('/player/transfer', async (req, res) => {
    try {
        const { device_id } = req.body;
        if (!device_id) return res.status(400).json({ error: 'Missing device_id' });
        await spotify.transferPlayback(device_id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to transfer playback' });
    }
});

// GET /settings - Returns all settings
router.get('/settings', (req, res) => {
    try {
        const settings = db.getSettings();
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get settings' });
    }
});

// PUT /settings - Updates a setting
router.put('/settings', (req, res) => {
    try {
        const { key, value } = req.body;
        if (key === undefined || value === undefined) {
            return res.status(400).json({ error: 'Missing key or value' });
        }
        db.saveSetting(key, value);
        res.json({ success: true, key, value });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save setting' });
    }
});

module.exports = router;
