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
