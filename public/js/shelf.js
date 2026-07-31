import { playAlbum } from './player.js';

let allAlbums = [];
let sortOrder = 'added';
let spineObserver = null;

// Virtual Carousel State
let vScrollX = 0;
let vVelocity = 0;
let isDragging = false;
let startDragX = 0;
let lastDragX = 0;
let overlayHideTimeout = null;

const SPINE_WIDTH = 28;
const CENTER_WIDTH = 300; // Matches the album-spine height exactly
const GAP = 4;

// Lazy import to avoid circular dependency
function notify(msg, type) {
    import('./app.js').then(m => m.showNotification(msg, type));
}

export async function initShelf() {
    const container = document.getElementById('shelf-container');
    
    // Virtual Carousel Events
    container.addEventListener('wheel', (e) => {
        vVelocity -= e.deltaY * 0.5;
        vVelocity -= e.deltaX * 0.5;
        e.preventDefault();
    }, { passive: false });
    
    container.addEventListener('pointerdown', (e) => {
        isDragging = true;
        startDragX = e.clientX;
        lastDragX = e.clientX;
        vVelocity = 0;
        container.style.cursor = 'grabbing';
    });
    
    window.addEventListener('pointermove', (e) => {
        if (isDragging) {
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

export function setSortOrder(order) {
    sortOrder = order;
    renderShelf();
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
    initSpineObserver();
    
    // Inject the static center box
    const centerBox = document.createElement('div');
    centerBox.id = 'static-center-box';
    centerBox.className = 'active';
    
    const centerArt = document.createElement('div');
    centerArt.id = 'center-box-art';
    centerBox.appendChild(centerArt);
    
    // Inject the Glass Overlay Template
    const template = document.getElementById('glass-overlay-template');
    if (template) {
        const overlayNode = template.content.cloneNode(true);
        centerBox.appendChild(overlayNode);
    }
    
    centerBox.addEventListener('click', (e) => {
        const overlay = centerBox.querySelector('.glass-controls-overlay');
        if (overlay) {
            // If clicking inside a control, don't toggle visibility
            if (e.target.closest('.control-btn') || e.target.closest('#glass-progress-container') || e.target.closest('.btn-primary')) {
                // Keep the overlay alive by resetting the timeout
                resetOverlayTimeout(overlay);
                return;
            }
            
            // Toggle visibility
            overlay.classList.toggle('hidden');
            
            if (!overlay.classList.contains('hidden')) {
                const selectedTitle = overlay.querySelector('#glass-selected-title');
                const selectedArtist = overlay.querySelector('#glass-selected-artist');
                if (selectedTitle && currentSelectedAlbum) selectedTitle.textContent = currentSelectedAlbum.name;
                if (selectedArtist && currentSelectedAlbum) selectedArtist.textContent = currentSelectedAlbum.artist;
                
                resetOverlayTimeout(overlay);
            } else {
                clearTimeout(overlayHideTimeout);
            }
        }
    });
    
    function resetOverlayTimeout(overlay) {
        clearTimeout(overlayHideTimeout);
        overlayHideTimeout = setTimeout(() => {
            overlay.classList.add('hidden');
        }, 5000);
    }
    
    container.appendChild(centerBox);
    
    // Ensure we have enough elements to fill an ultra-wide screen
    const containerWidth = window.innerWidth || 1920;
    const requiredElements = Math.ceil(containerWidth / (SPINE_WIDTH + GAP)) * 2;
    
    let displayAlbums = [...sorted];
    while (displayAlbums.length > 0 && displayAlbums.length < requiredElements) {
        displayAlbums = displayAlbums.concat(sorted);
    }
    
    displayAlbums.forEach((album, index) => {
        let el = document.createElement('div');
        
        // Randomize the spine frame gloss out of 3 options
        const frameClass = 'frame-' + (Math.floor(Math.random() * 3) + 1);
        el.className = `album-spine ${frameClass}`;
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
        
        let text = document.createElement('div');
        text.className = 'album-spine-text';
        text.textContent = `${album.artist} — ${album.name}`;
        
        el.appendChild(bg);
        el.appendChild(text);
        
        el.addEventListener('click', () => {
            // Smoothly scroll this item to center
            const itemWidth = SPINE_WIDTH + GAP;
            const diff = parseFloat(el.dataset.relativeFloat || 0);
            vVelocity = -diff * itemWidth * 0.15; 
        });
        
        spineObserver.observe(el);
        container.appendChild(el);
    });
}

export let currentSelectedAlbum = null;


// Fixed-gap discrete sliding math
function carouselLoop() {
    if (allAlbums.length > 0) {
        const container = document.getElementById('shelf-container');
        if (container) {
            const centerX = container.clientWidth / 2;
            const spines = container.querySelectorAll('.album-spine');
            const numAlbums = spines.length;
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
            
            // Hide overlay if scrolling fast
            if (Math.abs(vVelocity) > 0.5 || isDragging) {
                const overlay = document.querySelector('.glass-controls-overlay');
                if (overlay && !overlay.classList.contains('hidden')) {
                    overlay.classList.add('hidden');
                    clearTimeout(overlayHideTimeout);
                }
            }
            
            // centerFloatIndex goes UP as we scroll LEFT
            const centerFloatIndex = -vScrollX / itemWidth;
            const snapC = Math.round(centerFloatIndex);
            const offset = centerFloatIndex - snapC; // ranges from -0.5 to 0.5
            
            // Dist from center to the start of the tightly packed spines
            const gapDist = (CENTER_WIDTH / 2) + (SPINE_WIDTH / 2) + GAP;
            
            // Find which item is in the center
            let centerItemIndex = snapC % allAlbums.length;
            if (centerItemIndex < 0) centerItemIndex += allAlbums.length;
            
            // Update the static center box
            currentSelectedAlbum = allAlbums[centerItemIndex];
            const centerArt = document.getElementById('center-box-art');
            if (centerArt && currentSelectedAlbum) {
                centerArt.style.backgroundImage = `url(${currentSelectedAlbum.image})`;
            }
            
            const half = numAlbums / 2;
            
            spines.forEach((spine) => {
                const i = parseInt(spine.dataset.index);
                
                // Calculate discrete position relative to the current snapped center
                let rel = i - snapC;
                
                // Wrap logic for infinite loop
                while (rel > half) rel -= numAlbums;
                while (rel < -half) rel += numAlbums;
                
                spine.dataset.relativeFloat = rel - offset; // For click-to-scroll tracking
                
                if (rel === 0) {
                    // This is the active center item; hide it so the static box can show its cover
                    spine.style.opacity = '0';
                    spine.style.pointerEvents = 'none';
                } else {
                    spine.style.opacity = '1';
                    spine.style.pointerEvents = 'auto';
                    
                    let x;
                    if (rel > 0) {
                        // Right block (slides left, behind the box)
                        x = centerX + gapDist + (rel - 1 - offset) * itemWidth;
                    } else {
                        // Left block (slides left, out from behind the box)
                        x = centerX - gapDist + (rel + 1 - offset) * itemWidth;
                    }
                    
                    // Fixed width, pure 1D translation
                    spine.style.left = `${x}px`;
                    spine.style.width = `${SPINE_WIDTH}px`;
                    spine.style.transform = `translate(-50%, -50%)`;
                }
            });
        }
    }
    
    requestAnimationFrame(carouselLoop);
}
