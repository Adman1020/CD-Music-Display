import { checkAuth } from './auth.js';
import { initShelf } from './shelf.js';
import { initPlayer } from './player.js';
import { initSettings } from './settings.js';

let idleTimer;
let screenSleepTimeout = 'never';

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication (also returns setupComplete status)
    const authStatus = await checkAuth();
    
    if (!authStatus.setupComplete) {
        // First launch — show setup screen
        showScreen('setup');
        initSetupForm();
    } else if (!authStatus.authenticated) {
        // Setup done but not logged in — show login
        showScreen('login');
    } else {
        // Fully authenticated — show the app
        showScreen('app');
        await initSettings();
        await initShelf();
        initPlayer();
        setupIdleDetection();
    }
});

// Screen management
function showScreen(screen) {
    document.getElementById('setup-screen').classList.remove('active');
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('app').classList.remove('active');
    
    document.getElementById(`${screen}-screen` === 'app-screen' ? 'app' : `${screen}-screen`).classList.add('active');
    
    // Special case: 'app' doesn't have '-screen' suffix
    if (screen === 'app') {
        document.getElementById('app').classList.add('active');
        // Remove the setup and login screens from active
        document.getElementById('setup-screen').classList.remove('active');
        document.getElementById('login-screen').classList.remove('active');
    }
}

// Setup form handler
function initSetupForm() {
    const form = document.getElementById('setup-form');
    const errorEl = document.getElementById('setup-error');
    
    // Pre-fill the redirect URI display with current origin
    const redirectDisplay = document.getElementById('redirect-uri-display');
    if (redirectDisplay) {
        redirectDisplay.textContent = `${window.location.origin}/auth/callback`;
    }
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.textContent = '';
        
        const clientId = document.getElementById('setup-client-id').value.trim();
        const clientSecret = document.getElementById('setup-client-secret').value.trim();
        const baseUrl = document.getElementById('setup-base-url').value.trim() || window.location.origin;
        
        if (!clientId || !clientSecret) {
            errorEl.textContent = 'Client ID and Client Secret are required.';
            return;
        }
        
        const saveBtn = document.getElementById('setup-save-btn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        
        try {
            const res = await fetch('/api/config/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ spotifyClientId: clientId, spotifyClientSecret: clientSecret, baseUrl })
            });
            
            const data = await res.json();
            
            if (res.ok && data.setupComplete) {
                showScreen('login');
                showNotification('Configuration saved! Now connect your Spotify account.');
            } else {
                errorEl.textContent = data.error || 'Failed to save configuration.';
            }
        } catch (err) {
            errorEl.textContent = 'Network error. Is the server running?';
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save & Continue';
        }
    });
}

// Toast notification system
export function showNotification(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 3000);
}

export function updateSleepTimeout(val) {
    screenSleepTimeout = val;
    resetIdleTimer();
}

function setupIdleDetection() {
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    events.forEach(name => document.addEventListener(name, resetIdleTimer, true));
}

function resetIdleTimer() {
    clearTimeout(idleTimer);
    document.body.style.opacity = '1';
    
    if (screenSleepTimeout !== 'never') {
        const timeoutMs = parseInt(screenSleepTimeout) * 60 * 1000;
        idleTimer = setTimeout(() => {
            // Dim screen to save power/burn-in
            document.body.style.opacity = '0.1';
            document.body.style.transition = 'opacity 2s ease';
        }, timeoutMs);
    }
}
