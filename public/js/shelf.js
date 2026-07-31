import { playAlbum } from './player.js';

let allAlbums = [];
let displayMode = 'covers';
let sortOrder = 'added';
let autoScrollInterval;
let spineObserver = null;

// Virtual Carousel State
let vScrollX = 0;
let vVelocity = 0;
let isDragging = false;
let startDragX = 0;
let lastDragX = 0;
let animationFrameId = null;

const SPINE_WIDTH = 28;
const CENTER_WIDTH = 300;
const GAP = 4;

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
    
    // Virtual Carousel Events
    container.addEventListener('wheel', (e) => {
        if (displayMode === 'spines') {
            vVelocity -= e.deltaY * 0.5;
            vVelocity -= e.deltaX * 0.5;
            e.preventDefault();
        }
    }, { passive: false });
    
    container.addEventListener('pointerdown', (e) => {
        if (displayMode === 'spines') {
            isDragging = true;
            startDragX = e.clientX;
            lastDragX = e.clientX;
            vVelocity = 0;
            container.style.cursor = 'grabbing';
        }
    });
    
    window.addEventListener('pointermove', (e) => {
        if (isDragging && displayMode === 'spines') {
            const delta = e.clientX - lastDragX;
            vScrollX += delta;
            vVelocity = delta * 0.5; // impart some momentum
            lastDragX = e.clientX;
        }
    });
    
    window.addEventListener('pointerup', () => {
        if (isDragging) {
            isDragging = false;
            container.style.cursor = '';
        }
    });
    
    // Start animation loop
    requestAnimationFrame(carouselLoop);
    
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
        
        // Ensure we have enough elements to fill an ultra-wide screen to prevent void gaps
        const containerWidth = window.innerWidth || 1920;
        const requiredElements = Math.ceil(containerWidth / (SPINE_WIDTH + GAP)) * 2;
        
        let displayAlbums = [...sorted];
        while (displayAlbums.length > 0 && displayAlbums.length < requiredElements) {
            displayAlbums = displayAlbums.concat(sorted);
        }
        
        displayAlbums.forEach((album, index) => {
            let el = document.createElement('div');
            
            el.className = 'album-spine';
            el.dataset.id = album.id;
            el.dataset.name = album.name;
            el.dataset.artist = album.artist;
            el.dataset.image = album.image || '';
            el.dataset.index = index;
            
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
            
            el.addEventListener('click', () => {
                if (el.classList.contains('is-center')) {
                    showAlbumDetail(album);
                } else {
                    // Smoothly scroll this item to center
                    const totalWidth = SPINE_WIDTH + GAP;
                    const diff = parseInt(el.dataset.relativeIndex || 0);
                    vVelocity = -diff * totalWidth * 0.1; 
                }
            });
            
            spineObserver.observe(el);
            container.appendChild(el);
        });
    }
    
    if (displayMode !== 'spines') {
        sorted.forEach((album, index) => {
            let el = document.createElement('div');
            el.className = 'album-cover';
            el.dataset.id = album.id;
            el.dataset.uri = album.uri;
            
            let img = document.createElement('img');
            img.src = album.image || 'https://placehold.co/300x300/111/444?text=No+Cover';
            img.alt = album.name;
            img.loading = 'lazy';
            
            let info = document.createElement('div');
            info.className = 'album-info';
            
            let title = document.createElement('div');
            title.className = 'album-title';
            title.textContent = album.name;
            
            let artist = document.createElement('div');
            artist.className = 'album-artist';
            artist.textContent = album.artist;
            
            info.appendChild(title);
            info.appendChild(artist);
            el.appendChild(img);
            el.appendChild(info);
            
            el.addEventListener('click', () => showAlbumDetail(album));
            container.appendChild(el);
        });
    }
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

// Math-driven virtual carousel loop
function carouselLoop() {
    if (displayMode === 'spines' && allAlbums.length > 0) {
        const container = document.getElementById('shelf-container');
        if (container) {
            const centerX = container.clientWidth / 2;
            const spines = container.querySelectorAll('.album-spine');
            const numAlbums = spines.length; // Use rendered element count
            const itemWidth = SPINE_WIDTH + GAP;
            
            if (!isDragging) {
                // Apply momentum
                vScrollX += vVelocity;
                vVelocity *= 0.90; // friction
                
                // Snap to nearest item if moving very slowly
                if (Math.abs(vVelocity) < 0.5) {
                    vVelocity = 0;
                    const snapX = Math.round(vScrollX / itemWidth) * itemWidth;
                    vScrollX += (snapX - vScrollX) * 0.1;
                }
            }
            
            const centerFloatIndex = -vScrollX / itemWidth;
            const centerIndex = Math.round(centerFloatIndex);
            
            spines.forEach((spine) => {
                const i = parseInt(spine.dataset.index);
                
                // Calculate shortest distance wrapped around the array length
                let relativeIndex = i - centerIndex;
                const half = numAlbums / 2;
                
                // Wrap logic for infinite loop
                while (relativeIndex > half) relativeIndex -= numAlbums;
                while (relativeIndex < -half) relativeIndex += numAlbums;
                
                spine.dataset.relativeIndex = relativeIndex;
                
                // Math for positioning
                let x = centerX + (relativeIndex * itemWidth);
                let width = SPINE_WIDTH;
                let isCenter = false;
                
                if (Math.abs(relativeIndex) < 0.1) {
                    // Exact center
                    width = CENTER_WIDTH;
                    isCenter = true;
                } else if (relativeIndex > 0) {
                    x += (CENTER_WIDTH - SPINE_WIDTH) / 2;
                } else {
                    x -= (CENTER_WIDTH - SPINE_WIDTH) / 2;
                }
                
                // Apply inline styles to absolute positioned elements
                spine.style.left = `${x}px`;
                spine.style.width = `${width}px`;
                
                if (isCenter) {
                    spine.classList.add('is-center');
                } else {
                    spine.classList.remove('is-center');
                }
            });
        }
    }
    
    requestAnimationFrame(carouselLoop);
}
