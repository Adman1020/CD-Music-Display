import { checkAuth } from './auth.js';
import { initShelf } from './shelf.js';
import { initPlayer } from './player.js';
import { initSettings } from './settings.js';

let idleTimer;
let screenSleepTimeout = 'never';

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    const authStatus = await checkAuth();
    
    if (authStatus.authenticated) {
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('app').classList.add('active');
        
        // Initialize modules
        await initSettings();
        await initShelf();
        initPlayer();
        
        setupIdleDetection();
    } else {
        document.getElementById('login-screen').classList.add('active');
    }
});

// Toast notification system
export function showNotification(message, type = 'info') {
    const container = document.getElementById('toast-container');
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
