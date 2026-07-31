import { playAlbum } from './player.js';

let allAlbums = [];
let displayMode = 'covers';
let sortOrder = 'added';
let autoScrollInterval;
let spineObserver = null;
let centerCalculateTimeout = null;

// Lazy import to avoid circular dependency
function notify(msg, type) {
    import('./app.js').then(m => m.showNotification(msg, type));
}

export async function initShelf() {
    // Bind UI elements
    document.getElementById('btn-close-detail').addEventListener('click', hideAlbumDetail);
    document.getElementById('btn-play-album').addEventListener('click', handlePlayAlbum);
    
    // Close overlay when tapping outside detail-content
    document.getElementById('album-detail-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'album-detail-overlay') hideAlbumDetail();
    });
    
    const container = document.getElementById('shelf-container');
    container.addEventListener('scroll', () => {
        if (displayMode === 'spines') {
            if (centerCalculateTimeout) cancelAnimationFrame(centerCalculateTimeout);
            centerCalculateTimeout = requestAnimationFrame(updateCenteredSpine);
        }
    });
    
    // Load albums
    await loadAlbums();
}

export async function fetchAlbums(forceRefresh = false) {
    try {
        const endpoint = forceRefresh ? '/api/albums/refresh' : '/api/albums';
        const res = await fetch(endpoint);
        if (!res.ok) throw new Error("Failed to fetch albums");
        const data = await res.json();
        // /refresh returns { albums: [...] }, /albums returns [...]
        return Array.isArray(data) ? data : (data.albums || []);
    } catch (e) {
        console.error("Fetch albums error", e);
        notify("Failed to load albums", "error");
        return [];
    }
}

export async function loadAlbums(forceRefresh = false) {
    const container = document.getElementById('shelf-container');
    
    // Show skeleton loading
    container.innerHTML = '';
    for (let i = 0; i < 20; i++) {
        const skel = document.createElement('div');
        skel.className = 'skeleton-card';
        container.appendChild(skel);
    }
    
    allAlbums = await fetchAlbums(forceRefresh);
    if (allAlbums.length > 0) {
        renderShelf();
        notify(`Loaded ${allAlbums.length} albums`);
    } else {
        container.innerHTML = '<div class="empty-state">No albums found.<br>Save some albums on Spotify first!</div>';
    }
}

export function setDisplayMode(mode) {
    displayMode = mode;
    const container = document.getElementById('shelf-container');
    const heroContainer = document.getElementById('hero-cover-container');
    
    container.className = `shelf-mode-${mode}`;
    
    if (heroContainer) {
        if (mode === 'spines') {
            heroContainer.classList.remove('hidden');
        } else {
            heroContainer.classList.add('hidden');
        }
    }
    
    renderShelf();
}

export function setSortOrder(order) {
    sortOrder = order;
    renderShelf();
}

export function setAutoScroll(enabled) {
    const container = document.getElementById('shelf-container');
    clearInterval(autoScrollInterval);
    
    if (enabled) {
        let scrollAmount = 1;
        autoScrollInterval = setInterval(() => {
            if (displayMode === 'covers') {
                container.scrollLeft += scrollAmount;
                if (container.scrollLeft >= (container.scrollWidth - container.clientWidth)) scrollAmount = -1;
                if (container.scrollLeft <= 0) scrollAmount = 1;
            } else {
                container.scrollTop += scrollAmount;
                if (container.scrollTop >= (container.scrollHeight - container.clientHeight)) scrollAmount = -1;
                if (container.scrollTop <= 0) scrollAmount = 1;
            }
        }, 50);
    }
}

function sortAlbums(albums) {
    return [...albums].sort((a, b) => {
        if (sortOrder === 'name') return a.name.localeCompare(b.name);
        if (sortOrder === 'artist') return a.artist.localeCompare(b.artist);
        if (sortOrder === 'added') {
            // Most recently added first
            return new Date(b.addedAt) - new Date(a.addedAt);
        }
        return 0; 
    });
}

function initSpineObserver() {
    if (!spineObserver) {
        spineObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    if (el.dataset.spineLoaded !== 'true') {
                        el.dataset.spineLoaded = 'true';
                        fetchSpine(el);
                    }
                }
            });
        }, { root: document.getElementById('shelf-container'), rootMargin: '200px' });
    }
}

async function fetchSpine(el) {
    const id = el.dataset.id;
    const name = el.dataset.name;
    const artist = el.dataset.artist;
    
    try {
        const res = await fetch(`/api/albums/${id}/spine?name=${encodeURIComponent(name)}&artist=${encodeURIComponent(artist)}`);
        if (res.ok) {
            const data = await res.json();
            if (data.spineUrl) {
                el.style.backgroundImage = `url(${data.spineUrl})`;
                el.classList.add('has-authentic-spine');
            }
        }
    } catch(e) {
        console.error("Failed to load spine", e);
    }
}

function renderShelf() {
    const container = document.getElementById('shelf-container');
    container.innerHTML = '';
    
    const sorted = sortAlbums(allAlbums);
    
    if (spineObserver) {
        spineObserver.disconnect();
    }
    
    if (displayMode === 'spines') {
        initSpineObserver();
        // Give it a tiny delay for layout to finish before finding the center
        setTimeout(updateCenteredSpine, 100);
    }
    
    sorted.forEach(album => {
        let el = document.createElement('div');
        
        if (displayMode === 'spines') {
            el.className = 'album-spine';
            el.dataset.id = album.id;
            el.dataset.name = album.name;
            el.dataset.artist = album.artist;
            el.dataset.image = album.image || '';
            
            const bg = document.createElement('div');
            bg.className = 'album-spine-bg';
            if (album.image) {
                bg.style.backgroundImage = `url(${album.image})`;
            }
            el.appendChild(bg);
            
            let text = document.createElement('div');
            text.className = 'album-spine-text';
            text.textContent = `${album.artist} — ${album.name}`;
            el.appendChild(text);
            
            spineObserver.observe(el);
            
        } else if (displayMode === 'covers' || displayMode === 'grid') {
            el.className = 'album-cover';
            if (displayMode === 'grid') el.classList.add('album-grid-item');
            
            let img = document.createElement('img');
            img.src = album.image || '';
            img.className = 'album-cover-img';
            img.alt = album.name;
            img.loading = 'lazy';
            
            let info = document.createElement('div');
            info.className = 'album-cover-info';
            
            let title = document.createElement('h4');
            title.textContent = album.name;
            
            let artist = document.createElement('p');
            artist.textContent = album.artist;
            
            info.appendChild(title);
            info.appendChild(artist);
            el.appendChild(img);
            el.appendChild(info);
        }
        
        el.addEventListener('click', () => showAlbumDetail(album));
        container.appendChild(el);
    });
}

let currentSelectedAlbum = null;

async function showAlbumDetail(album) {
    currentSelectedAlbum = album;
    
    document.getElementById('detail-cover').src = album.image || '';
    document.getElementById('detail-title').textContent = album.name;
    document.getElementById('detail-artist').textContent = album.artist;
    
    const year = album.releaseDate ? album.releaseDate.substring(0, 4) : 'Unknown Year';
    document.getElementById('detail-meta').textContent = `${year} • ${album.totalTracks || '?'} Tracks`;
    
    // Clear track list — we don't fetch individual tracks from the albums endpoint
    const trackList = document.getElementById('detail-tracks');
    trackList.innerHTML = '<p style="color:var(--text-secondary); padding: 16px;">Tap "Play Album" to start listening.</p>';
    
    document.getElementById('album-detail-overlay').classList.add('active');
}

function hideAlbumDetail() {
    document.getElementById('album-detail-overlay').classList.remove('active');
}

function handlePlayAlbum() {
    if (currentSelectedAlbum) {
        playAlbum(currentSelectedAlbum.uri);
        hideAlbumDetail();
    }
}

function updateCenteredSpine() {
    const container = document.getElementById('shelf-container');
    if (!container || displayMode !== 'spines') return;
    
    // In our new CSS, padding-left is 50vw. The exact center of the container's visible area is container.scrollLeft.
    // Actually, with padding 50vw, the first item is naturally at the center when scrollLeft is 0.
    // The visual center is scrollLeft + (container.clientWidth / 2)
    const containerCenter = container.scrollLeft + (container.clientWidth / 2);
    
    const spines = container.querySelectorAll('.album-spine');
    let closestSpine = null;
    let minDistance = Infinity;
    
    spines.forEach(spine => {
        const spineCenter = spine.offsetLeft + (spine.offsetWidth / 2);
        const distance = Math.abs(containerCenter - spineCenter);
        if (distance < minDistance) {
            minDistance = distance;
            closestSpine = spine;
        }
    });
    
    spines.forEach(spine => {
        if (spine === closestSpine) {
            spine.classList.add('is-selected');
        } else {
            spine.classList.remove('is-selected');
        }
    });
    
    if (closestSpine) {
        document.getElementById('hero-cover-img').src = closestSpine.dataset.image;
        document.getElementById('hero-cover-title').textContent = closestSpine.dataset.name;
        document.getElementById('hero-cover-artist').textContent = closestSpine.dataset.artist;
        
        document.getElementById('hero-cover-img').onclick = () => {
            const albumObj = allAlbums.find(a => String(a.id) === String(closestSpine.dataset.id));
            if (albumObj) showAlbumDetail(albumObj);
        };
    }
}
