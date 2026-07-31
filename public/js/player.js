import { getToken } from './auth.js';

let player;
let deviceId;
let currentPlaybackState = null;
let animationFrameId;

export function initPlayer() {
    // UI bindings
    document.getElementById('btn-play-pause').addEventListener('click', togglePlay);
    document.getElementById('btn-next').addEventListener('click', nextTrack);
    document.getElementById('btn-prev').addEventListener('click', prevTrack);
    
    const progressContainer = document.getElementById('progress-container');
    progressContainer.addEventListener('click', handleSeek);
    
    // Device Picker bindings
    const deviceBtn = document.getElementById('btn-device-picker');
    const deviceMenu = document.getElementById('device-picker-menu');
    const closeDeviceMenu = document.getElementById('btn-close-devices');
    
    deviceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = deviceMenu.classList.contains('hidden');
        if (isHidden) {
            deviceMenu.classList.remove('hidden');
            fetchAndRenderDevices();
        } else {
            deviceMenu.classList.add('hidden');
        }
    });
    
    closeDeviceMenu.addEventListener('click', () => {
        deviceMenu.classList.add('hidden');
    });
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.device-picker-container')) {
            deviceMenu.classList.add('hidden');
        }
    });
    
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

        // Error handling
        player.addListener('initialization_error', ({ message }) => { console.error(message); });
        player.addListener('authentication_error', ({ message }) => { console.error(message); });
        player.addListener('account_error', ({ message }) => { console.error(message); });
        player.addListener('playback_error', ({ message }) => { console.error(message); });

        // Playback status updates
        player.addListener('player_state_changed', state => {
            currentPlaybackState = state;
            updateNowPlaying(state);
        });

        // Ready
        player.addListener('ready', ({ device_id }) => {
            console.log('Ready with Device ID', device_id);
            deviceId = device_id;
            
            // Auto-select this device if settings say so, or we could just notify
            showNotification('Spotify Player Ready');
            
            // Dispatch custom event that device is ready (settings.js might listen)
            window.dispatchEvent(new CustomEvent('spotify-device-ready', { detail: { id: device_id }}));
        });

        // Connect
        player.connect();
    };
}

function updateNowPlaying(state) {
    if (!state) return;
    
    const track = state.track_window.current_track;
    
    document.getElementById('np-track').textContent = track.name;
    document.getElementById('np-artist').textContent = track.artists.map(a => a.name).join(', ');
    
    if (track.album.images.length > 0) {
        document.getElementById('np-art').src = track.album.images[0].url;
    }
    
    const playIcon = document.getElementById('icon-play');
    const pauseIcon = document.getElementById('icon-pause');
    
    if (state.paused) {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        cancelAnimationFrame(animationFrameId);
    } else {
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
        startProgressLoop();
    }
    
    document.getElementById('np-time-total').textContent = formatTime(state.duration);
    updateProgressBar(state.position, state.duration);
}

function startProgressLoop() {
    cancelAnimationFrame(animationFrameId);
    let lastTime = performance.now();
    
    const loop = (time) => {
        if (currentPlaybackState && !currentPlaybackState.paused) {
            const delta = time - lastTime;
            lastTime = time;
            
            // Estimate new position
            currentPlaybackState.position += delta;
            if (currentPlaybackState.position > currentPlaybackState.duration) {
                currentPlaybackState.position = currentPlaybackState.duration;
            }
            
            updateProgressBar(currentPlaybackState.position, currentPlaybackState.duration);
        }
        animationFrameId = requestAnimationFrame(loop);
    };
    
    animationFrameId = requestAnimationFrame(loop);
}

function updateProgressBar(position, duration) {
    const percent = (position / duration) * 100;
    document.getElementById('progress-fill').style.width = `${percent}%`;
    document.getElementById('progress-handle').style.left = `${percent}%`;
    document.getElementById('np-time-elapsed').textContent = formatTime(position);
}

function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

async function handleSeek(e) {
    if (!currentPlaybackState || !player) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const seekMs = Math.floor(percent * currentPlaybackState.duration);
    await player.seek(seekMs);
}

async function togglePlay() {
    if (!player) return;
    await player.togglePlay();
}

async function nextTrack() {
    if (!player) return;
    await player.nextTrack();
}

async function prevTrack() {
    if (!player) return;
    await player.previousTrack();
}

export async function playAlbum(contextUri) {
    if (!deviceId) {
        import('./app.js').then(m => m.showNotification("Player not ready yet", "error"));
        return;
    }
    
    try {
        const activeDevice = localStorage.getItem('activeDeviceId') || deviceId;
        
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
        list.innerHTML = '';
        
        const activeDevice = localStorage.getItem('activeDeviceId') || deviceId;
        
        let isActiveDevicePlaying = false;

        devices.forEach(device => {
            const li = document.createElement('li');
            li.className = 'device-item';
            
            // Highlight if active
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
        
        // Update button color based on whether an active device is currently playing
        const btn = document.getElementById('btn-device-picker');
        if (isActiveDevicePlaying) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
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
            document.getElementById('device-picker-menu').classList.add('hidden');
            import('./app.js').then(m => m.showNotification("Transferred playback"));
            
            // Re-render to update UI state
            setTimeout(fetchAndRenderDevices, 1000);
        } else {
            throw new Error('Transfer failed');
        }
    } catch (e) {
        console.error("Transfer error", e);
        import('./app.js').then(m => m.showNotification("Failed to transfer playback", "error"));
    }
}
