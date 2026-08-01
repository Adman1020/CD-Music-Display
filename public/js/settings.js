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
    const clearSpinesBtn = document.getElementById('btn-clear-spines');
    if (clearSpinesBtn) {
        clearSpinesBtn.addEventListener('click', async () => {
            const notify = (msg, type) => import('./app.js').then(m => m.showNotification(msg, type));
            try {
                await fetch('/api/worker/reprocess', { method: 'POST' });
                notify('Spine image cache flushed! AI is re-checking all albums.');
                loadAlbums(true);
                panel.classList.remove('open');
            } catch (e) {
                notify('Failed to clear spine cache', 'error');
            }
        });
    }

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



    // Spotify config save button
    document.getElementById('btn-save-config').addEventListener('click', saveSpotifyConfig);
    
    // Spine processing & AI config toggle & save buttons
    const spineToggle = document.getElementById('config-spine-processing-toggle');
    const spineOptions = document.getElementById('spine-processing-options');
    spineToggle.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        spineOptions.style.display = enabled ? 'block' : 'none';
        await saveSetting('enableSpineProcessing', enabled ? 'true' : 'false');
        if (!enabled) {
            // Automatically clear spine cache & trigger reprocess to revert all albums to clean Spotify slices
            await fetch('/api/worker/clear-spines', { method: 'POST' });
            await fetch('/api/worker/reprocess', { method: 'POST' });
            import('./app.js').then(m => m.showNotification('Spine processing disabled — resetting library to Spotify cover slices', 'info'));
        } else {
            await fetch('/api/worker/reprocess', { method: 'POST' });
            import('./app.js').then(m => m.showNotification('Spine processing enabled — restarting background scan', 'info'));
        }
    });

    const aiToggle = document.getElementById('config-ai-toggle');
    const aiContainer = document.getElementById('ai-settings-container');
    const diagBtn = document.getElementById('btn-open-worker-diagnostics');
    aiToggle.addEventListener('change', (e) => {
        aiContainer.style.display = e.target.checked ? 'block' : 'none';
        if (diagBtn) diagBtn.style.display = e.target.checked ? 'block' : 'none';
        saveSetting('useAiVision', e.target.checked ? 'true' : 'false');
    });
    document.getElementById('btn-save-ai').addEventListener('click', saveAiConfig);
    
    // AI Worker Diagnostics modal handlers
    const workerModal = document.getElementById('ai-worker-modal');
    if (diagBtn && workerModal) {
        diagBtn.addEventListener('click', () => {
            workerModal.classList.remove('hidden');
            workerModal.style.display = 'flex';
            pollWorkerLogs(true);
        });
        const closeWorkerModal = () => {
            workerModal.classList.add('hidden');
            workerModal.style.display = 'none';
        };
        document.getElementById('btn-close-worker-modal').addEventListener('click', closeWorkerModal);
        document.getElementById('btn-done-worker').addEventListener('click', closeWorkerModal);
    }
    
    const reprocessBtn = document.getElementById('btn-reprocess-spines');
    if (reprocessBtn) {
        reprocessBtn.addEventListener('click', async () => {
            const notify = (msg, type) => import('./app.js').then(m => m.showNotification(msg, type));
            try {
                await fetch('/api/worker/reprocess', { method: 'POST' });
                notify('Library spine reprocessing triggered with current AI settings!');
                pollWorkerLogs(true);
            } catch(e) {
                notify('Failed to trigger reprocessing', 'error');
            }
        });
    }
    
    // Load existing settings & config
    await loadSettings();
    await loadSpotifyConfig();
    await loadAiConfig();
    await fetchDevices();
    
    window.addEventListener('spotify-device-ready', () => fetchDevices());
    
    // Start polling logs if panel is open
    setInterval(pollWorkerLogs, 2000);
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
            // Spine processing toggle defaults to OFF unless explicitly set to true
            const isSpineEnabled = settings.enableSpineProcessing === 'true' || settings.enableSpineProcessing === true || settings.enableSpineProcessing === 1;
            document.getElementById('config-spine-processing-toggle').checked = isSpineEnabled;
            document.getElementById('spine-processing-options').style.display = isSpineEnabled ? 'block' : 'none';

            if (settings.useAiVision === 'true' || settings.useAiVision === true || settings.useAiVision === 1) {
                document.getElementById('config-ai-toggle').checked = true;
                document.getElementById('ai-settings-container').style.display = 'block';
                const diagBtn = document.getElementById('btn-open-worker-diagnostics');
                if (diagBtn) diagBtn.style.display = 'block';
            } else {
                document.getElementById('config-ai-toggle').checked = false;
                document.getElementById('ai-settings-container').style.display = 'none';
                const diagBtn = document.getElementById('btn-open-worker-diagnostics');
                if (diagBtn) diagBtn.style.display = 'none';
            }

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

async function loadAiConfig() {
    try {
        const res = await fetch('/api/config');
        if (res.ok) {
            const config = await res.json();
            if (config.aiProvider) document.getElementById('config-ai-provider').value = config.aiProvider;
            if (config.aiApiKey) document.getElementById('config-ai-key').placeholder = config.aiApiKey;
            if (config.aiModel) document.getElementById('config-ai-model').value = config.aiModel;
            if (config.aiRateLimit) document.getElementById('config-ai-rate').value = config.aiRateLimit;
        }
    } catch (e) {
        console.warn("Failed to load AI config", e);
    }
}

async function saveAiConfig() {
    const provider = document.getElementById('config-ai-provider').value;
    const apiKey = document.getElementById('config-ai-key').value.trim();
    const model = document.getElementById('config-ai-model').value.trim();
    const rateLimit = document.getElementById('config-ai-rate').value.trim();
    
    const notify = (msg, type) => import('./app.js').then(m => m.showNotification(msg, type));
    
    try {
        await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'aiProvider', value: provider }) });
        if (apiKey) await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'aiApiKey', value: apiKey }) });
        if (model) await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'aiModel', value: model }) });
        if (rateLimit) await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'aiRateLimit', value: rateLimit }) });
        
        const isSpineEnabled = document.getElementById('config-spine-processing-toggle').checked ? 'true' : 'false';
        const isAiEnabled = document.getElementById('config-ai-toggle').checked ? 'true' : 'false';
        await saveSetting('enableSpineProcessing', isSpineEnabled);
        await saveSetting('useAiVision', isAiEnabled);
        
        // Trigger worker restart/reprocess automatically
        await fetch('/api/worker/reprocess', { method: 'POST' });
        
        notify('AI Configuration saved and Worker restarted!');
        document.getElementById('config-ai-key').value = '';
        await loadAiConfig();
        pollWorkerLogs(true);
    } catch (e) {
        console.error("Failed to save AI config", e);
        notify('Failed to save AI configuration', 'error');
    }
}

let lastLogLines = 0;
let lastDiagLogLines = 0;
async function pollWorkerLogs(force = false) {
    const panel = document.getElementById('settings-panel');
    const modal = document.getElementById('ai-worker-modal');
    const isPanelOpen = panel && panel.classList.contains('open');
    const isModalOpen = modal && !modal.classList.contains('hidden');
    
    if (!isPanelOpen && !isModalOpen && !force) return;
    
    try {
        const res = await fetch('/api/worker/logs');
        if (res.ok) {
            const data = await res.json();
            
            // Update small settings box
            if (isPanelOpen) {
                const logBox = document.getElementById('worker-logs');
                if (logBox && data.logs && data.logs.length > 0) {
                    if (data.logs.length !== lastLogLines || force) {
                        logBox.textContent = data.logs.join('\n');
                        logBox.scrollTop = logBox.scrollHeight;
                        lastLogLines = data.logs.length;
                    }
                } else if (logBox) {
                    logBox.textContent = "No logs yet...";
                }
            }
            
            // Update Diagnostics modal
            if (isModalOpen || force) {
                const diagState = document.getElementById('diag-worker-state');
                const diagProgress = document.getElementById('diag-worker-progress');
                const diagAction = document.getElementById('diag-worker-action');
                const diagConsole = document.getElementById('diag-console');
                
                if (data.status) {
                    if (diagState) diagState.textContent = data.status.state || "Active";
                    if (diagProgress) diagProgress.textContent = `${data.status.processedCount || 0} / ${data.status.totalAlbums || 0} Albums`;
                    if (diagAction) diagAction.textContent = data.status.lastAction || "Idle";
                }
                
                if (diagConsole && data.logs && data.logs.length > 0) {
                    if (data.logs.length !== lastDiagLogLines || force) {
                        diagConsole.textContent = data.logs.join('\n');
                        diagConsole.scrollTop = diagConsole.scrollHeight;
                        lastDiagLogLines = data.logs.length;
                    }
                } else if (diagConsole) {
                    diagConsole.textContent = "No worker logs recorded yet...";
                }
            }
        }
    } catch (e) {
        // Ignore fetch errors during polling to prevent console spam
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
