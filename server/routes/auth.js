const express = require('express');
const crypto = require('crypto');
const db = require('../db');
// Node 20+ has built-in fetch
const router = express.Router();

function generateRandomString(length) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
}

function generateCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
}

const getRedirectUri = () => {
    let { baseUrl } = db.getSpotifyCredentials();
    if (baseUrl && baseUrl.endsWith('/')) {
        baseUrl = baseUrl.slice(0, -1);
    }
    return `${baseUrl}/auth/callback`;
};

router.get('/login', (req, res) => {
    if (!db.isSetupComplete()) {
        return res.status(400).json({ error: 'Spotify credentials not configured. Complete setup first.' });
    }

    const { clientId } = db.getSpotifyCredentials();

    const state = generateRandomString(16);
    const codeVerifier = generateRandomString(64);
    const codeChallenge = generateCodeChallenge(codeVerifier);

    req.session.codeVerifier = codeVerifier;
    req.session.state = state;

    const scopes = 'user-library-read user-read-playback-state user-modify-playback-state streaming user-read-email user-read-private';
    
    const authUrl = new URL('https://accounts.spotify.com/authorize');
    authUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        scope: scopes,
        redirect_uri: getRedirectUri(),
        state: state,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge
    }).toString();

    res.redirect(authUrl.toString());
});

router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    const { codeVerifier, state: sessionState } = req.session;

    if (error) {
        return res.status(400).send(`Auth error: ${error}`);
    }

    if (state === null || state !== sessionState) {
        return res.status(400).send('State mismatch error');
    }

    delete req.session.state;
    delete req.session.codeVerifier;

    const { clientId, clientSecret } = db.getSpotifyCredentials();

    try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: getRedirectUri(),
                client_id: clientId,
                code_verifier: codeVerifier
            })
        });

        const data = await response.json();
        
        if (!response.ok) {
            console.error('[CD-Display] Callback token error:', data);
            return res.status(400).send('Failed to get tokens');
        }

        db.saveTokens(data.access_token, data.refresh_token, data.expires_in);
        res.redirect('/');
    } catch (err) {
        console.error('[CD-Display] Error in callback:', err);
        res.status(500).send('Internal Server Error');
    }
});

router.get('/token', async (req, res) => {
    try {
        const spotify = require('../spotify');
        const token = await spotify.getValidToken();
        const tokens = db.getTokens();
        res.json({ accessToken: token, expiresAt: tokens.expiresAt });
    } catch (err) {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

router.post('/refresh', async (req, res) => {
    try {
        const tokens = db.getTokens();
        if (!tokens || !tokens.refreshToken) {
            return res.status(400).json({ error: 'No refresh token available' });
        }
        
        const { clientId, clientSecret } = db.getSpotifyCredentials();
        
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: tokens.refreshToken
            })
        });

        if (!response.ok) {
            return res.status(400).json({ error: 'Failed to refresh token' });
        }

        const data = await response.json();
        db.saveTokens(data.access_token, data.refresh_token || tokens.refreshToken, data.expires_in);
        res.json({ success: true, expires_in: data.expires_in });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/logout', (req, res) => {
    db.clearTokens();
    req.session.destroy();
    res.redirect('/');
});

router.get('/status', async (req, res) => {
    // Include setup status so the frontend knows which screen to show
    if (!db.isSetupComplete()) {
        return res.json({ authenticated: false, setupComplete: false });
    }

    const tokens = db.getTokens();
    if (!tokens) {
        return res.json({ authenticated: false, setupComplete: true });
    }
    
    try {
        const spotify = require('../spotify');
        const user = await spotify.getCurrentUser();
        res.json({
            authenticated: true,
            setupComplete: true,
            user: {
                name: user.display_name,
                email: user.email,
                image: user.images && user.images.length > 0 ? user.images[0].url : null
            }
        });
    } catch (err) {
        res.json({ authenticated: false, setupComplete: true });
    }
});

module.exports = router;
