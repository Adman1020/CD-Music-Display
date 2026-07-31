export async function checkAuth() {
    try {
        const res = await fetch('/auth/status');
        if (!res.ok) return { authenticated: false };
        return await res.json();
    } catch (e) {
        console.error("Auth check failed", e);
        return { authenticated: false };
    }
}

export function login() {
    window.location.href = '/auth/login';
}

export function logout() {
    window.location.href = '/auth/logout';
}

export async function getToken() {
    try {
        const res = await fetch('/auth/token');
        if (!res.ok) throw new Error("Failed to get token");
        const data = await res.json();
        return data.accessToken;
    } catch (e) {
        console.error("Token error", e);
        return null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const connectBtn = document.getElementById('connect-spotify-btn');
    if (connectBtn) {
        connectBtn.addEventListener('click', login);
    }
});
