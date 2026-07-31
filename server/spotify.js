const db = require('./db');

// Node 20+ has built-in fetch
const _fetch = globalThis.fetch;

async function refreshAccessToken(refreshToken) {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
        throw new Error('Spotify credentials not found');
    }

    const response = await _fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        })
    });

    if (!response.ok) {
        throw new Error('Failed to refresh token: ' + response.statusText);
    }

    const data = await response.json();
    return data;
}

async function getValidToken() {
    const tokens = db.getTokens();
    if (!tokens || !tokens.accessToken) {
        throw new Error('No authentication tokens found');
    }

    // Check if expired (with 1 minute buffer)
    if (new Date() > new Date(tokens.expiresAt.getTime() - 60000)) {
        console.log('[CD-Display] Token expired, refreshing...');
        if (!tokens.refreshToken) throw new Error('No refresh token available');
        
        try {
            const data = await refreshAccessToken(tokens.refreshToken);
            db.saveTokens(
                data.access_token,
                data.refresh_token || tokens.refreshToken,
                data.expires_in
            );
            return data.access_token;
        } catch (error) {
            console.error('[CD-Display] Error refreshing token:', error);
            throw error;
        }
    }
    
    return tokens.accessToken;
}

async function spotifyApiFetch(endpoint, options = {}) {
    let token = await getValidToken();
    
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    let response = await _fetch(`https://api.spotify.com/v1${endpoint}`, {
        ...options,
        headers
    });
    
    // If unauthorized, token might have been invalidated, try refresh once
    if (response.status === 401) {
        const tokens = db.getTokens();
        if (tokens && tokens.refreshToken) {
            console.log('[CD-Display] 401 Unauthorized, attempting force refresh...');
            const data = await refreshAccessToken(tokens.refreshToken);
            db.saveTokens(data.access_token, data.refresh_token || tokens.refreshToken, data.expires_in);
            token = data.access_token;
            headers['Authorization'] = `Bearer ${token}`;
            response = await _fetch(`https://api.spotify.com/v1${endpoint}`, {
                ...options,
                headers
            });
        }
    }

    if (!response.ok) {
        const text = await response.text();
        console.error(`[CD-Display] Spotify API Error (${response.status}) on ${endpoint}:`, text);
        throw new Error(`Spotify API error: ${response.statusText}`);
    }

    // 204 No Content has no body
    if (response.status === 204) return null;
    return response.json();
}

module.exports = {
    getUserAlbums: async (offset = 0, limit = 50) => {
        return spotifyApiFetch(`/me/albums?offset=${offset}&limit=${limit}`);
    },
    getPlaybackState: async () => {
        return spotifyApiFetch('/me/player');
    },
    startPlayback: async (contextUri, deviceId) => {
        const query = deviceId ? `?device_id=${deviceId}` : '';
        const body = contextUri ? JSON.stringify({ context_uri: contextUri }) : undefined;
        return spotifyApiFetch(`/me/player/play${query}`, {
            method: 'PUT',
            body
        });
    },
    pausePlayback: async () => {
        return spotifyApiFetch('/me/player/pause', { method: 'PUT' });
    },
    nextTrack: async () => {
        return spotifyApiFetch('/me/player/next', { method: 'POST' });
    },
    previousTrack: async () => {
        return spotifyApiFetch('/me/player/previous', { method: 'POST' });
    },
    seekToPosition: async (positionMs) => {
        return spotifyApiFetch(`/me/player/seek?position_ms=${positionMs}`, { method: 'PUT' });
    },
    getDevices: async () => {
        return spotifyApiFetch('/me/player/devices');
    },
    transferPlayback: async (deviceId) => {
        return spotifyApiFetch('/me/player', {
            method: 'PUT',
            body: JSON.stringify({ device_ids: [deviceId] })
        });
    },
    getCurrentUser: async () => {
        return spotifyApiFetch('/me');
    },
    getValidToken
};
