import { getToken } from './auth.js';
import { currentSelectedAlbum } from './shelf.js';

let player;
let deviceId;
let globalState = null;
let pollInterval = null;

export function initPlayer() {
    // Wait for SDK to load
    window.onSpotifyWebPlaybackSDKReady = () => {
        player = new Spotify.Player({
            name: 'CD Music Display',
            getOAuthToken: async cb => {
                const token = await getToken();
                cb(token);
            },
            volume: 1.0
        });

        player.addListener('initialization_error', ({ message }) => { console.error(message); });
        player.addListener('authentication_error', ({ message }) => { console.error(message); });
        player.addListener('account_error', ({ message }) => { console.error(message); });
        player.addListener('playback_error', ({ message }) => { console.error(message); });

        player.addListener('ready', ({ device_id }) => {
            console.log('Local Web Player Ready with Device ID', device_id);
            deviceId = device_id;
            import('./app.js').then(m => m.showNotification('Spotify Player Ready'));
            window.dispatchEvent(new CustomEvent('spotify-device-ready', { detail: { id: device_id }}));
        });

        player.connect();
    };
    
    // Setup delegated event listeners for the dynamically injected glass controls
    setupDelegatedEvents();
    
    // Start polling the global Spotify API state
    startStatePolling();
}

function startStatePolling() {
    if (pollInterval) clearInterval(pollInterval);
    
    const poll = async () => {
        try {
            const res = await fetch('/api/player');
            if (res.status === 200) {
                const state = await res.json();
                globalState = state;
                updateNowPlayingFromAPI(state);
            } else if (res.status === 204) {
                // No active device / nothing playing
                globalState = null;
                updateNowPlayingFromAPI(null);
            }
        } catch (e) {
            console.error("Polling error", e);
        }
    };
    
    poll(); // initial
    pollInterval = setInterval(poll, 2000);
}

function updateNowPlayingFromAPI(state) {
    const trackEl = document.getElementById('glass-np-track');
    const artistEl = document.getElementById('glass-np-artist');
    const playIcon = document.getElementById('icon-play');
    const pauseIcon = document.getElementById('icon-pause');
    const progressFill = document.getElementById('glass-progress-fill');
    
    if (!trackEl) return; // UI not rendered yet
    
    if (!state || !state.item) {
        trackEl.textContent = "No track playing";
        artistEl.textContent = "—";
        if (playIcon) playIcon.style.display = 'block';
        if (pauseIcon) pauseIcon.style.display = 'none';
        if (progressFill) progressFill.style.width = '0%';
        return;
    }
    
    const track = state.item;
    trackEl.textContent = track.name;
    artistEl.textContent = track.artists.map(a => a.name).join(', ');
    
    if (state.is_playing) {
        if (playIcon) playIcon.style.display = 'none';
        if (pauseIcon) pauseIcon.style.display = 'block';
    } else {
        if (playIcon) playIcon.style.display = 'block';
        if (pauseIcon) pauseIcon.style.display = 'none';
    }
    
    if (progressFill && state.item.duration_ms) {
        const percent = (state.progress_ms / state.item.duration_ms) * 100;
        progressFill.style.width = `${percent}%`;
    }
    
    // Note: We don't animate the progress bar smoothly here because it's global polling.
    // A 2-second tick update is standard for Spotify remotes.
}

function setupDelegatedEvents() {
    document.body.addEventListener('click', async (e) => {
        
        // Play / Pause (Global)
        if (e.target.closest('#btn-play-pause')) {
            e.stopPropagation();
            await togglePlay();
        }

        // Play This Album
        if (e.target.closest('#btn-play-this-album')) {
            e.stopPropagation();
            if (currentSelectedAlbum) {
                playAlbum(currentSelectedAlbum.uri);
            }
        }
        
        // Next
        if (e.target.closest('#btn-next')) {
            e.stopPropagation();
            await fetch('/api/player/next', { method: 'POST' });
            // Optimistic update
            setTimeout(() => fetch('/api/player').then(r=>r.json()).then(updateNowPlayingFromAPI), 500);
        }
        
        // Prev
        if (e.target.closest('#btn-prev')) {
            e.stopPropagation();
            await fetch('/api/player/previous', { method: 'POST' });
            setTimeout(() => fetch('/api/player').then(r=>r.json()).then(updateNowPlayingFromAPI), 500);
        }
        
        // Seek
        const progressContainer = e.target.closest('#glass-progress-container');
        if (progressContainer) {
            e.stopPropagation();
            if (!globalState || !globalState.item) return;
            const rect = progressContainer.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            const seekMs = Math.floor(percent * globalState.item.duration_ms);
            await fetch('/api/player/seek', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ position_ms: seekMs })
            });
            setTimeout(() => fetch('/api/player').then(r=>r.json()).then(updateNowPlayingFromAPI), 500);
        }
        
        // Device Picker Toggle
        if (e.target.closest('#btn-device-picker')) {
            e.stopPropagation();
            const menu = document.getElementById('device-picker-menu');
            if (menu) {
                if (menu.classList.contains('hidden')) {
                    menu.classList.remove('hidden');
                    fetchAndRenderDevices();
                } else {
                    menu.classList.add('hidden');
                }
            }
        }
        
        // Close Device Menu
        if (e.target.closest('#btn-close-devices')) {
            e.stopPropagation();
            const menu = document.getElementById('device-picker-menu');
            if (menu) menu.classList.add('hidden');
        }
    });
}

async function togglePlay() {
    // Option B logic:
    // Just toggle global playback for the active device
    
    if (globalState && globalState.is_playing) {
        await fetch('/api/player/pause', { method: 'PUT' });
    } else {
        const activeDevice = localStorage.getItem('activeDeviceId') || deviceId;
        await fetch('/api/player/play', { 
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: activeDevice })
        });
    }
    
    // Quick optimistic sync
    setTimeout(() => fetch('/api/player').then(r=>r.json()).then(updateNowPlayingFromAPI), 500);
}

export async function playAlbum(contextUri) {
    const activeDevice = localStorage.getItem('activeDeviceId') || deviceId;
    if (!activeDevice) {
        import('./app.js').then(m => m.showNotification("Player not ready yet", "error"));
        return;
    }
    
    try {
        const res = await fetch('/api/player/play', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context_uri: contextUri, device_id: activeDevice })
        });
        
        if (res.ok) {
            import('./app.js').then(m => m.showNotification("Playing album"));
        } else {
            throw new Error('Playback failed');
        }
    } catch (e) {
        console.error("Play error", e);
        import('./app.js').then(m => m.showNotification("Failed to play album", "error"));
    }
}

async function fetchAndRenderDevices() {
    try {
        const res = await fetch('/api/devices');
        if (!res.ok) throw new Error('Failed to fetch devices');
        
        const data = await res.json();
        const devices = data.devices || [];
        const list = document.getElementById('device-list');
        if (!list) return;
        
        list.innerHTML = '';
        const activeDevice = localStorage.getItem('activeDeviceId') || deviceId;
        let isActiveDevicePlaying = false;

        devices.forEach(device => {
            const li = document.createElement('li');
            li.className = 'device-item';
            
            if (device.is_active || device.id === activeDevice) {
                li.classList.add('active');
                if (device.is_active) isActiveDevicePlaying = true;
            }
            
            li.innerHTML = `
                <div class="device-item-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h16v10H4z" opacity=".3"/><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4v-2H4V6h16v10h-4v2h4c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-9 14.53v-2.02c-2.04-.54-3.5-2.4-3.5-4.51s1.46-3.97 3.5-4.51v-2.02c-3.16.59-5.5 3.38-5.5 6.53s2.34 5.94 5.5 6.53zM15.5 14c0 1.35-.74 2.53-1.84 3.09v-6.18c1.1.56 1.84 1.74 1.84 3.09z"/></svg>
                </div>
                <div class="device-item-info">
                    <span class="device-item-name">${device.name}</span>
                    <span class="device-item-type">${device.type}</span>
                </div>
            `;
            
            li.addEventListener('click', () => transferPlayback(device.id));
            list.appendChild(li);
        });
        
        const btn = document.getElementById('btn-device-picker');
        if (btn) {
            if (isActiveDevicePlaying) btn.classList.add('active');
            else btn.classList.remove('active');
        }
        
    } catch (e) {
        console.error("Error fetching devices", e);
    }
}

async function transferPlayback(targetDeviceId) {
    try {
        const res = await fetch('/api/player/transfer', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: targetDeviceId })
        });
        
        if (res.ok) {
            localStorage.setItem('activeDeviceId', targetDeviceId);
            const menu = document.getElementById('device-picker-menu');
            if (menu) menu.classList.add('hidden');
            import('./app.js').then(m => m.showNotification("Transferred playback"));
            setTimeout(fetchAndRenderDevices, 1000);
        } else {
            throw new Error('Transfer failed');
        }
    } catch (e) {
        console.error("Transfer error", e);
        import('./app.js').then(m => m.showNotification("Failed to transfer playback", "error"));
    }
}
