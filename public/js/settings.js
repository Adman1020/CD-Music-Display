import { logout } from './auth.js';
import { loadAlbums, setSortOrder } from './shelf.js';
import { updateSleepTimeout } from './app.js';

export async function initSettings() {
    const closeBtn = document.getElementById('btn-close-settings');
    const panel = document.getElementById('settings-panel');
    
    document.body.addEventListener('click', (e) => {
        if (e.target.closest('#settings-toggle')) {
            panel.classList.add('open');
        }
    });
    closeBtn.addEventListener('click', () => panel.classList.remove('open'));
    
    document.getElementById('btn-logout').addEventListener('click', logout);
    document.getElementById('btn-refresh-library').addEventListener('click', () => {
        loadAlbums(true);
        panel.classList.remove('open');
    });

    // Segmented controls
    
    setupSegmentedControl('setting-theme', (val) => {
        document.documentElement.setAttribute('data-theme', val);
        saveSetting('theme', val);
    });

    // Selects
    document.getElementById('setting-sort').addEventListener('change', (e) => {
        setSortOrder(e.target.value);
        saveSetting('sortOrder', e.target.value);
    });
    
    document.getElementById('setting-sleep').addEventListener('change', (e) => {
        updateSleepTimeout(e.target.value);
        saveSetting('sleepTimeout', e.target.value);
    });
    
    document.getElementById('setting-device').addEventListener('change', (e) => {
        localStorage.setItem('activeDeviceId', e.target.value);
        saveSetting('deviceId', e.target.value);
    });

    const scaleSelect = document.getElementById('setting-shelf-scale');
    if (scaleSelect) {
        scaleSelect.addEventListener('change', (e) => {
            updateShelfScaleUI(e.target.value);
            saveSetting('shelfScale', e.target.value);
        });
    }

    const casesToggle = document.getElementById('setting-show-jewel-cases');
    if (casesToggle) {
        casesToggle.addEventListener('change', (e) => {
            const checked = e.target.checked;
            localStorage.setItem('showJewelCases', checked ? 'true' : 'false');
            saveSetting('showJewelCases', checked ? 'true' : 'false');
            const savedScale = localStorage.getItem('shelfScale') || '460';
            updateShelfScaleUI(savedScale);
        });
    }

    // Spotify config save button
    document.getElementById('btn-save-config').addEventListener('click', saveSpotifyConfig);

    // Load existing settings & config
    await loadSettings();
    await loadSpotifyConfig();
    await fetchDevices();
    
    window.addEventListener('spotify-device-ready', () => fetchDevices());
}

function setupSegmentedControl(id, callback) {
    const container = document.getElementById(id);
    const buttons = container.querySelectorAll('button');
    
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            callback(btn.dataset.value);
        });
    });
}

async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        if (res.ok) {
            const settings = await res.json();
            
            // Apply settings to UI
            if (settings.theme) {
                document.querySelector(`#setting-theme button[data-value="${settings.theme}"]`)?.click();
            }
            if (settings.sortOrder) {
                document.getElementById('setting-sort').value = settings.sortOrder;
                setSortOrder(settings.sortOrder);
            }
            if (settings.sleepTimeout) {
                document.getElementById('setting-sleep').value = settings.sleepTimeout;
                updateSleepTimeout(settings.sleepTimeout);
            }
            let scaleVal = parseInt(settings.shelfScale || localStorage.getItem('shelfScale') || '460', 10);
            if (scaleVal <= 380) scaleVal = 300;
            else if (scaleVal >= 580) scaleVal = 700;
            else scaleVal = 460;
            document.getElementById('setting-shelf-scale').value = String(scaleVal);
            const showCases = settings.showJewelCases !== 'false' && localStorage.getItem('showJewelCases') !== 'false';
            const casesToggle = document.getElementById('setting-show-jewel-cases');
            if (casesToggle) casesToggle.checked = showCases;
            localStorage.setItem('showJewelCases', showCases ? 'true' : 'false');

            updateShelfScaleUI(scaleVal);
        }
    } catch (e) {
        console.warn("Failed to load settings from server, using defaults", e);
    }
}

async function loadSpotifyConfig() {
    try {
        const res = await fetch('/api/config');
        if (res.ok) {
            const config = await res.json();
            
            if (config.spotifyClientId) {
                document.getElementById('config-client-id').value = config.spotifyClientId;
            }
            if (config.spotifyClientSecret) {
                document.getElementById('config-client-secret').placeholder = config.spotifyClientSecret;
            }
            if (config.baseUrl) {
                document.getElementById('config-base-url').value = config.baseUrl;
            }
        }
    } catch (e) {
        console.warn("Failed to load Spotify config", e);
    }
}

async function saveSpotifyConfig() {
    const clientId = document.getElementById('config-client-id').value.trim();
    const clientSecret = document.getElementById('config-client-secret').value.trim();
    const baseUrl = document.getElementById('config-base-url').value.trim();
    
    const notify = (msg, type) => import('./app.js').then(m => m.showNotification(msg, type));
    
    try {
        // Only save fields that have values
        if (clientId) {
            await fetch('/api/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'spotifyClientId', value: clientId })
            });
        }
        if (clientSecret) {
            await fetch('/api/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'spotifyClientSecret', value: clientSecret })
            });
        }
        if (baseUrl) {
            await fetch('/api/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'baseUrl', value: baseUrl })
            });
        }
        
        notify('Spotify configuration saved. Sign out and back in for changes to take effect.');
        
        // Clear the secret field after saving
        document.getElementById('config-client-secret').value = '';
        
        // Reload the masked values
        await loadSpotifyConfig();
    } catch (e) {
        console.error("Failed to save Spotify config", e);
        notify('Failed to save configuration', 'error');
    }
}

async function saveSetting(key, value) {
    try {
        await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value: String(value) })
        });
    } catch (e) {
        console.error("Failed to save setting:", e);
    }
}

const SPINE_SCALE_CONFIG = {
    "300": { height: 300, width: 33, oldWidth: 28, left: 5, top: 9, inlayW: 23, inlayH: 282, frame: "/images/spines/frame-300.png" },
    "460": { height: 460, width: 50, oldWidth: 43, left: 8, top: 14, inlayW: 35, inlayH: 432, frame: "/images/spines/frame-460.png" },
    "700": { height: 700, width: 76, oldWidth: 65, left: 12, top: 21, inlayW: 52, inlayH: 658, frame: "/images/spines/frame-700.png" }
};

function updateShelfScaleUI(val) {
    let numVal = parseInt(val, 10);
    if (numVal <= 380) numVal = 300;
    else if (numVal >= 580) numVal = 700;
    else numVal = 460;
    
    const scaleKey = String(numVal);
    const cfg = SPINE_SCALE_CONFIG[scaleKey] || SPINE_SCALE_CONFIG["460"];
    const showCases = localStorage.getItem('showJewelCases') !== 'false';
    const activeWidth = showCases ? cfg.width : cfg.oldWidth;
    
    localStorage.setItem('shelfScale', scaleKey);
    
    const selectEl = document.getElementById('setting-shelf-scale');
    if (selectEl && selectEl.value !== scaleKey) selectEl.value = scaleKey;
    
    const root = document.documentElement;
    root.style.setProperty('--shelf-height', `${cfg.height}px`);
    root.style.setProperty('--spine-width', `${activeWidth}px`);
    root.style.setProperty('--inlay-left', `${cfg.left}px`);
    root.style.setProperty('--inlay-top', `${cfg.top}px`);
    root.style.setProperty('--inlay-width', `${cfg.inlayW}px`);
    root.style.setProperty('--inlay-height', `${cfg.inlayH}px`);
    root.style.setProperty('--spine-frame-url', `url("${cfg.frame}")`);
    
    window.dispatchEvent(new CustomEvent('shelfScaleChanged', { detail: { scale: cfg.height, width: activeWidth, config: cfg } }));
}

async function fetchDevices() {
    try {
        const res = await fetch('/api/devices');
        
        if (res.ok) {
            const data = await res.json();
            const select = document.getElementById('setting-device');
            select.innerHTML = '<option value="">Default (This Display)</option>';
            
            const devices = data.devices || [];
            devices.forEach(device => {
                const opt = document.createElement('option');
                opt.value = device.id;
                opt.textContent = `${device.name} (${device.type})`;
                select.appendChild(opt);
            });
            
            const savedDevice = localStorage.getItem('activeDeviceId');
            if (savedDevice) {
                select.value = savedDevice;
            }
        }
    } catch (e) {
        console.error("Failed to fetch devices", e);
    }
}
