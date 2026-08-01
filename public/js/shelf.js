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
let dragDistance = 0;
let isCenterPoppedOut = true;
let pendingPopOutIndex = null;
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
    
    // Virtual Carousel Events - 1 album per notch on mouse wheel
    container.addEventListener('wheel', (e) => {
        if (e.target.closest('.settings-content') || e.target.closest('.popover-menu') || e.target.closest('.settings-overlay')) return;
        const delta = e.deltaY || e.deltaX;
        if (Math.abs(delta) >= 15) {
            const dir = Math.sign(delta);
            vVelocity -= dir * ((SPINE_WIDTH + GAP) * 0.1);
        } else {
            vVelocity -= delta * 0.1;
        }
        e.preventDefault();
    }, { passive: false });
    
    container.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.glass-controls-overlay')) return;
        isDragging = true;
        startDragX = e.clientX;
        lastDragX = e.clientX;
        dragDistance = 0;
        vVelocity = 0;
        container.style.cursor = 'grabbing';
    });
    
    window.addEventListener('pointermove', (e) => {
        if (isDragging) {
            const delta = e.clientX - lastDragX;
            dragDistance += Math.abs(delta);
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
    
    // Arrow keys navigation
    window.addEventListener('keydown', (e) => {
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
        const itemWidth = SPINE_WIDTH + GAP;
        if (e.key === 'ArrowRight') {
            vVelocity = -(itemWidth * 0.1);
            e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
            vVelocity = (itemWidth * 0.1);
            e.preventDefault();
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
            const w = Math.min(95, Math.max(18, parseInt(data.spineWidth) || 28));
            el.dataset.width = w;
            el.style.width = `${w}px`;
            
            const idx = parseInt(el.dataset.index);
            if (!isNaN(idx) && allAlbums.length > 0) {
                const realAlbum = allAlbums[idx % allAlbums.length];
                if (realAlbum) {
                    realAlbum.width = w;
                    if (data.coverUrl) realAlbum.coverUrl = data.coverUrl;
                }
            }
            
            if (data.spineUrl && data.spineUrl !== '') {
                el.style.backgroundImage = `url(${data.spineUrl})`;
                const st = data.spineType || 'spine';
                el.dataset.spineType = st;
                el.classList.add(`spine-type-${st}`);
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
    
    allAlbums = sortAlbums(allAlbums);
    const sorted = allAlbums;
    
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
    
    // Add Close / Fold-Away Button
    const closeBtn = document.createElement('button');
    closeBtn.id = 'close-center-btn';
    closeBtn.title = 'Fold back into shelf';
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isCenterPoppedOut = false;
        pendingPopOutIndex = null;
        centerBox.classList.add('folding-away');
        setTimeout(() => {
            centerBox.style.display = 'none';
            centerBox.classList.remove('folding-away');
            const overlay = centerBox.querySelector('.glass-controls-overlay');
            if (overlay && !overlay.classList.contains('hidden')) {
                overlay.classList.add('hidden');
            }
        }, 300);
    });
    
    // Inject the Glass Overlay Template and place closeBtn inside it
    const template = document.getElementById('glass-overlay-template');
    if (template) {
        const overlayNode = template.content.cloneNode(true);
        const overlayContainer = overlayNode.querySelector('.glass-controls-overlay');
        if (overlayContainer) {
            overlayContainer.appendChild(closeBtn);
        }
        centerBox.appendChild(overlayNode);
    } else {
        centerBox.appendChild(closeBtn);
    }
    
    centerBox.addEventListener('click', (e) => {
        if (dragDistance > 5) return;
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
            const deviceMenu = document.getElementById('device-picker-menu');
            if (deviceMenu && !deviceMenu.classList.contains('hidden')) {
                // Keep checking later if the device menu is open
                resetOverlayTimeout(overlay);
                return;
            }
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
        text.innerHTML = `<span class="spine-artist">${album.artist}</span><span class="spine-divider">—</span><span class="spine-album">${album.name}</span>`;
        
        el.appendChild(bg);
        el.appendChild(text);
        
        el.addEventListener('click', () => {
            if (dragDistance > 5) return;
            
            const box = document.getElementById('static-center-box');
            const diff = parseFloat(el.dataset.relativeFloat || 0);
            const w = parseFloat(el.dataset.width || SPINE_WIDTH);
            const idx = parseInt(el.dataset.index);
            
            // Reopen center pop-out box if it was closed
            if (!isCenterPoppedOut || (box && box.style.display === 'none')) {
                // If already at the center, open immediately
                if (Math.abs(diff) < 0.2 && Math.abs(vVelocity) < 0.2) {
                    isCenterPoppedOut = true;
                    pendingPopOutIndex = null;
                    if (box) {
                        box.style.display = 'block';
                        box.classList.add('folding-out');
                        setTimeout(() => box.classList.remove('folding-out'), 300);
                    }
                } else {
                    // Otherwise defer opening until the album scrolls to the middle
                    pendingPopOutIndex = idx;
                }
            }
            
            // Smoothly scroll this item to center (scaled to universal scroll grid index distance)
            vVelocity = -diff * (SPINE_WIDTH + GAP) * 0.1; 
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
            
            // If waiting for clicked album to arrive in center before pop-out animation
            if (pendingPopOutIndex !== null && !isDragging) {
                let targetIndex = pendingPopOutIndex % allAlbums.length;
                if (targetIndex < 0) targetIndex += allAlbums.length;
                
                // When we arrive close to the target center index and velocity has settled down
                if (centerItemIndex === targetIndex && Math.abs(offset) < 0.35 && Math.abs(vVelocity) < 2.0) {
                    pendingPopOutIndex = null;
                    isCenterPoppedOut = true;
                    const box = document.getElementById('static-center-box');
                    if (box) {
                        box.style.display = 'block';
                        box.classList.add('folding-out');
                        setTimeout(() => box.classList.remove('folding-out'), 300);
                    }
                }
            }
            if (isDragging) {
                pendingPopOutIndex = null; // Cancel deferred open if user interrupts by dragging
            }
            
            // Update the static center box
            currentSelectedAlbum = allAlbums[centerItemIndex];
            const centerArt = document.getElementById('center-box-art');
            if (centerArt && currentSelectedAlbum) {
                const displayCover = currentSelectedAlbum.image || currentSelectedAlbum.coverUrl;
                centerArt.style.backgroundImage = `url(${displayCover})`;
            }
            
            const half = numAlbums / 2;
            const spineItems = Array.from(spines).map(spine => {
                const i = parseInt(spine.dataset.index);
                let rel = i - snapC;
                while (rel > half) rel -= numAlbums;
                while (rel < -half) rel += numAlbums;
                spine.dataset.relativeFloat = rel - offset;
                const width = parseFloat(spine.dataset.width || SPINE_WIDTH);
                return { spine, rel, width };
            });

            const centerObj = spineItems.find(item => item.rel === 0);
            const rightList = spineItems.filter(item => item.rel > 0).sort((a, b) => a.rel - b.rel);
            const leftList = spineItems.filter(item => item.rel < 0).sort((a, b) => b.rel - a.rel);

            const centerW = centerObj ? centerObj.width : SPINE_WIDTH;
            const avgSlideStep = centerW + GAP; 
            const slideOffset = offset * avgSlideStep;

            let curXRight, curXLeft;

            const boxEl = document.getElementById('static-center-box');
            const actuallyPopped = isCenterPoppedOut && (!boxEl || boxEl.style.display !== 'none');

            if (actuallyPopped) {
                if (centerObj) {
                    centerObj.spine.style.opacity = '0';
                    centerObj.spine.style.pointerEvents = 'none';
                }
                curXRight = centerX + (CENTER_WIDTH / 2) + GAP - slideOffset;
                curXLeft = centerX - (CENTER_WIDTH / 2) - GAP - slideOffset;
            } else {
                if (centerObj) {
                    centerObj.spine.style.opacity = '1';
                    centerObj.spine.style.pointerEvents = 'auto';
                    const x0 = centerX - slideOffset;
                    centerObj.spine.style.left = `${x0}px`;
                    centerObj.spine.style.width = `${centerObj.width}px`;
                    centerObj.spine.style.transform = `translate(-50%, -50%)`;
                }
                const x0 = centerX - slideOffset;
                curXRight = x0 + (centerW / 2) + GAP;
                curXLeft = x0 - (centerW / 2) - GAP;
            }

            // Stack variable-width items outwards to the right
            rightList.forEach(item => {
                item.spine.style.opacity = '1';
                item.spine.style.pointerEvents = 'auto';
                const x = curXRight + (item.width / 2);
                item.spine.style.left = `${x}px`;
                item.spine.style.width = `${item.width}px`;
                item.spine.style.transform = `translate(-50%, -50%)`;
                curXRight += item.width + GAP;
            });

            // Stack variable-width items outwards to the left (-1, -2, -3...)
            leftList.forEach(item => {
                item.spine.style.opacity = '1';
                item.spine.style.pointerEvents = 'auto';
                const x = curXLeft - (item.width / 2);
                item.spine.style.left = `${x}px`;
                item.spine.style.width = `${item.width}px`;
                item.spine.style.transform = `translate(-50%, -50%)`;
                curXLeft -= (item.width + GAP);
            });
        }
    }
    
    requestAnimationFrame(carouselLoop);
}
