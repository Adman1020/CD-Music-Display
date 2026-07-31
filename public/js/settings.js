import { logout, getToken } from './auth.js';
import { loadAlbums, setDisplayMode, setSortOrder, setAutoScroll } from './shelf.js';
import { updateSleepTimeout } from './app.js';

export async function initSettings() {
    const toggleBtn = document.getElementById('settings-toggle');
    const closeBtn = document.getElementById('btn-close-settings');
    const panel = document.getElementById('settings-panel');
    
    toggleBtn.addEventListener('click', () => panel.classList.add('open'));
    closeBtn.addEventListener('click', () => panel.classList.remove('open'));
    
    document.getElementById('btn-logout').addEventListener('click', logout);
    document.getElementById('btn-refresh-library').addEventListener('click', () => {
        loadAlbums(true);
        panel.classList.remove('open');
    });

    // Segmented controls
    setupSegmentedControl('setting-mode', (val) => {
        setDisplayMode(val);
        saveSetting('displayMode', val);
    });
    
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

    // Toggle
    document.getElementById('setting-autoscroll').addEventListener('change', (e) => {
        setAutoScroll(e.target.checked);
        saveSetting('autoScroll', e.target.checked);
    });
    
    // Load existing settings
    await loadSettings();
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
            if (settings.displayMode) {
                document.querySelector(`#setting-mode button[data-value="${settings.displayMode}"]`)?.click();
            }
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
            if (settings.autoScroll !== undefined) {
                document.getElementById('setting-autoscroll').checked = settings.autoScroll;
                setAutoScroll(settings.autoScroll);
            }
        }
    } catch (e) {
        console.warn("Failed to load settings from server, using defaults", e);
    }
}

async function saveSetting(key, value) {
    try {
        await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value })
        });
    } catch (e) {
        console.error("Failed to save setting", e);
    }
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
