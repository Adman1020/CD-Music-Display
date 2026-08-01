const db = require('./db');
const fs = require('fs');
const path = require('path');

let isRunning = false;
let timerId = null;
const logs = [];
const MAX_LOGS = 250;

const workerStatus = {
    state: "Idle (Booting)",
    totalAlbums: 0,
    processedCount: 0,
    currentAlbum: null,
    lastAction: "Initializing worker..."
};

function log(msg) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const formatted = `[${timestamp}] ${msg}`;
    console.log(`[Worker] ${formatted}`);
    logs.push(formatted);
    if (logs.length > MAX_LOGS) logs.shift();
    workerStatus.lastAction = msg;
}

function getLogs() {
    return [...logs];
}

function getStatus() {
    try {
        workerStatus.processedCount = db.getSpineCount();
        const cached = db.getCachedAlbums();
        if (cached && cached.albums) {
            workerStatus.totalAlbums = cached.albums.length;
        }
    } catch (e) {}
    return { ...workerStatus, isRunning };
}

// ----------------------------------------------------------------------
// Image Processing & Cropping (using Sharp)
// ----------------------------------------------------------------------
async function cropImageWithSharp(imageUrl, type, albumId) {
    try {
        const sharp = require('sharp');
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error('Failed to fetch image for cropping');
        
        const buffer = await res.arrayBuffer();
        
        // Define crop based on type
        // If type is 'back', we typically crop the right-hand edge.
        // But for simplicity, the AI model will give us coordinates in the future.
        // For Heuristics, we don't strictly need sharp if we use CSS cropping, 
        // but if we want to save local cropped files, we can do it here.
        // For now, this is a placeholder where AI coordinates would be processed.
        
        return imageUrl; // Returning original URL for now, since we use CSS cropping for heuristics
    } catch (e) {
        log(`Crop error: ${e.message}`);
        return null;
    }
}

// ----------------------------------------------------------------------
// Sanitization Helper
// ----------------------------------------------------------------------
function sanitizeAlbumName(name) {
    return name
        .replace(/\(.*?remaster.*?\)/i, '')
        .replace(/\(.*?deluxe.*?\)/i, '')
        .replace(/\(.*?original motion picture soundtrack.*?\)/i, '')
        .replace(/\(.*?soundtrack.*?\)/i, '')
        .replace(/ - remaster.*/i, '')
        .replace(/ - .*?edition/i, '')
        .trim();
}

async function resolveAlbumArtwork(album, useAi, aiConfig) {
    const sharp = require('sharp');
    const fs = require('fs');
    const path = require('path');
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    let coverUrl = null;
    let spineUrl = null;
    let spineType = 'none';
    let spineWidth = 28;
    let usedAi = false;

    try {
        const name = sanitizeAlbumName(album.name);
        // Explicitly filter for CD format to avoid cassette / vinyl packaging
        const mbUrl = `https://musicbrainz.org/ws/2/release?query=release:"${encodeURIComponent(name)}" AND artist:"${encodeURIComponent(album.artist)}" AND format:CD&fmt=json`;
        const mbRes = await fetch(mbUrl, { headers: { 'User-Agent': 'CDMusicDisplay/1.0 ( local@local.com )' } });
        if (!mbRes.ok) throw new Error('MusicBrainz API error');
        
        const mbData = await mbRes.json();
        if (!mbData.releases || mbData.releases.length === 0) {
            throw new Error(`No CD release found in MusicBrainz for "${name}"`);
        }
        
        const mbid = mbData.releases[0].id;
        const caaUrl = `https://coverartarchive.org/release/${mbid}`;
        const caaRes = await fetch(caaUrl, { headers: { 'User-Agent': 'CDMusicDisplay/1.0' } });
        if (!caaRes.ok) throw new Error(`No Cover Art Archive images for MBID ${mbid}`);
        
        const caaData = await caaRes.json();
        const images = caaData.images || [];

        const getUrl = (img) => {
            if (img.thumbnails && img.thumbnails['500']) return img.thumbnails['500'];
            if (img.thumbnails && img.thumbnails['250']) return img.thumbnails['250'];
            return img.image;
        };

        // 1. Front Cover Artwork is strictly retrieved from Spotify for optimal reliability and consistency
        coverUrl = album.image || null;

        // 2. Resolve Spine Artwork via Explicit CAA Tag (with Aspect Ratio validation)
        const spineImg = images.find(img => img.types && img.types.includes('Spine'));
        let wideSpineCandidate = null;
        if (spineImg) {
            log(`Heuristic explicit Spine scan found on Cover Art Archive for ${name}!`);
            try {
                const sRes = await fetch(getUrl(spineImg));
                if (sRes.ok) {
                    const buf = Buffer.from(await sRes.arrayBuffer());
                    const img = sharp(buf);
                    const metadata = await img.metadata();
                    const ratio = metadata.width / metadata.height;
                    
                    // A true vertical CD spine has a very low aspect ratio (width <= 35% of height).
                    // If wider, it's actually an entire back traycard or un-cropped cover scan!
                    if (ratio > 0.35) {
                        log(`Explicit 'Spine' image has aspect ratio ${ratio.toFixed(2)} (not a thin spine strip). Reclassifying as candidate scan for AI bounding-box extraction.`);
                        wideSpineCandidate = spineImg;
                    } else {
                        // Calculate proportional width when scaled to 300px height, allowed range 26px to 64px
                        const calcWidth = Math.min(64, Math.max(26, Math.round(300 * ratio)));
                        const filename = `spine_${album.id}.jpg`;
                        await img.resize({ width: calcWidth, height: 300, fit: 'fill' }).toFile(path.join(dataDir, filename));
                        spineUrl = `/data/${filename}`;
                        spineType = 'spine';
                        spineWidth = calcWidth;
                        return { coverUrl, spineUrl, spineType, spineWidth, usedAi: false };
                    }
                }
            } catch (se) {
                log(`Explicit spine image processing failed: ${se.message}`);
            }
        }

        // 3. AI Vision Fallback (if no valid explicit spine scan was found)
        if (useAi && aiConfig && aiConfig.provider && aiConfig.key && !spineUrl) {
            log(`No ready-to-use spine image found. Kicking into AI Vision analysis...`);
            const targetImage = wideSpineCandidate || images.find(img => img.types && (img.types.includes('Back') || img.types.includes('Tray') || img.types.includes('Other') || img.types.length === 0));
            if (targetImage) {
                try {
                    const candidateUrl = targetImage.image;
                    log(`Downloading candidate CD scan for AI analysis: ${candidateUrl}`);
                    const imgRes = await fetch(candidateUrl);
                    if (imgRes.ok) {
                        const arrayBuffer = await imgRes.arrayBuffer();
                        const base64 = Buffer.from(arrayBuffer).toString('base64');
                        
                        log(`Sending candidate scan to ${aiConfig.provider} (${aiConfig.model})...`);
                        const prompt = "You are a rigorous music archive preservation expert. Inspect this scan to determine if an AUTHENTIC, UNFOLDED CD TRAYCARD SPINE FLAP is physically present along the edge of the scan.\n" +
                                       "A genuine CD spine flap MUST exhibit AT LEAST ONE of these undeniable visual proofs:\n" +
                                       "1. Text aligned sideways (90-degree rotated typography) displaying the artist name, album title, or catalog number.\n" +
                                       "2. A distinct structural vertical line, fold crease, or completely different background color design separating the narrow spine strip from the main back cover area.\n\n" +
                                       "CRITICAL WARNING: Many scans are simply flat back covers without any attached spine flaps. NEVER crop or guess a random right-hand or left-hand slice of a back cover if it is simply tracklists, copyright notes, or plain artwork borders! If there is ANY doubt or if it is merely an edge of a standard back cover, you MUST reject it!\n\n" +
                                       "Reply ONLY with a valid JSON object matching this exact schema:\n" +
                                       "{\n" +
                                       "  \"has_authentic_spine_flap\": true or false,\n" +
                                       "  \"confidence\": \"HIGH\" or \"LOW\",\n" +
                                       "  \"reasoning\": \"Explicitly explain what visual proofs confirm this is an authentic spine flap, or why it is merely a standard back cover edge.\",\n" +
                                       "  \"box\": { \"x\": 0.0, \"y\": 0.0, \"width\": 0.0, \"height\": 0.0 } // normalized 0.0 to 1.0 fractions. If has_authentic_spine_flap is false, return empty box {}.\n" +
                                       "}\n" +
                                       "Do not include markdown code blocks or any other surrounding prose.";
                        let jsonText = "";
                        usedAi = true;

                        if (aiConfig.provider === 'openai') {
                            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiConfig.key}` },
                                body: JSON.stringify({
                                    model: aiConfig.model,
                                    response_format: { type: "json_object" },
                                    messages: [{
                                        role: "user",
                                        content: [
                                            { type: "text", text: prompt },
                                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } }
                                        ]
                                    }]
                                })
                            });
                            const data = await res.json();
                            if (data.error) throw new Error(data.error.message);
                            jsonText = data.choices[0].message.content;
                        } 
                        else if (aiConfig.provider === 'gemini') {
                            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.key}`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    contents: [{
                                        parts: [
                                            { text: prompt },
                                            { inline_data: { mime_type: "image/jpeg", data: base64 } }
                                        ]
                                    }]
                                })
                            });
                            const data = await res.json();
                            if (data.error) throw new Error(data.error.message);
                            jsonText = data.candidates[0].content.parts[0].text;
                        }
                        else if (aiConfig.provider === 'claude') {
                            const res = await fetch('https://api.anthropic.com/v1/messages', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'x-api-key': aiConfig.key, 'anthropic-version': '2023-06-01' },
                                body: JSON.stringify({
                                    model: aiConfig.model,
                                    max_tokens: 1024,
                                    messages: [{
                                        role: "user",
                                        content: [
                                            { type: "text", text: prompt },
                                            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } }
                                        ]
                                    }]
                                })
                            });
                            const data = await res.json();
                            if (data.error) throw new Error(data.error.message);
                            jsonText = data.content[0].text;
                        }
                        
                        jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
                        let parsed = {};
                        try {
                            parsed = JSON.parse(jsonText);
                        } catch (perr) {
                            const match = jsonText.match(/\{[\s\S]*\}/);
                            if (match) parsed = JSON.parse(match[0]);
                        }
                        
                        if (parsed.has_authentic_spine_flap && (parsed.confidence === 'HIGH' || parsed.confidence === 'high') && parsed.box && parsed.box.width > 0 && parsed.box.height > 0) {
                            const boxRatio = parsed.box.width / parsed.box.height;
                            if (boxRatio > 0.28) {
                                log(`AI suggested spine box with ratio ${boxRatio.toFixed(2)} (too wide for a genuine CD spine). Rejecting crop; falling back to Spotify cover slice.`);
                            } else {
                                log(`AI verified authentic spine flap with HIGH confidence ("${parsed.reasoning || 'verified'}"). Cropping image...`);
                                const img = sharp(Buffer.from(arrayBuffer));
                                const metadata = await img.metadata();
                                const cropX = Math.max(0, Math.floor(parsed.box.x * metadata.width));
                                const cropY = Math.max(0, Math.floor(parsed.box.y * metadata.height));
                                const cropW = Math.min(metadata.width - cropX, Math.floor(parsed.box.width * metadata.width));
                                const cropH = Math.min(metadata.height - cropY, Math.floor(parsed.box.height * metadata.height));
                                
                                if (cropW > 3 && cropH > 5) {
                                    const calcWidth = Math.min(64, Math.max(26, Math.round(300 * (cropW / cropH))));
                                    const filename = `spine_${album.id}.jpg`;
                                    await img.extract({ left: cropX, top: cropY, width: cropW, height: cropH })
                                        .resize({ width: calcWidth, height: 300, fit: 'fill' })
                                        .toFile(path.join(dataDir, filename));
                                    spineUrl = `/data/${filename}`;
                                    spineType = 'ai_crop';
                                    spineWidth = calcWidth;
                                    return { coverUrl, spineUrl, spineType, spineWidth, usedAi: true };
                                }
                            }
                        } else {
                            log(`AI rejected image as non-spine or low confidence ("${parsed.reasoning || 'No distinct spine characteristics verified'}"). Falling back to Spotify cover slice.`);
                        }
                    }
                } catch (aie) {
                    log(`AI Vision processing error: ${aie.message}`);
                }
            } else {
                log("No candidate back or traycard images available for AI evaluation.");
            }
        }

    } catch (err) {
        log(`Artwork lookup error for ${album.name}: ${err.message}`);
    }

    // 4. Ultimate Fallback: No spine image found, fall back to default left-edge crop of Cover Art
    if (!coverUrl) coverUrl = album.image || null;
    log(`Using fallback left-edge slice with text overlay at standard width (28px).`);
    return { coverUrl, spineUrl: '', spineType: 'none', spineWidth: 28, usedAi };
}

// ----------------------------------------------------------------------
// Main Worker Loop
// ----------------------------------------------------------------------
async function processNextAlbum() {
    if (!isRunning) return;
    if (timerId) { clearTimeout(timerId); timerId = null; }
    
    try {
        const cachedAlbumsData = db.getCachedAlbums();
        if (!cachedAlbumsData || !cachedAlbumsData.albums) {
            workerStatus.state = "Waiting for Spotify albums cache...";
            timerId = setTimeout(processNextAlbum, 10000);
            return;
        }
        
        const albums = cachedAlbumsData.albums;
        workerStatus.totalAlbums = albums.length;
        workerStatus.processedCount = db.getSpineCount();
        
        let targetAlbum = null;
        for (const album of albums) {
            const cache = db.getSpineCache(album.id);
            if (!cache) {
                targetAlbum = album;
                break;
            }
        }
        
        if (!targetAlbum) {
            workerStatus.state = "Idle (All library albums processed)";
            workerStatus.currentAlbum = null;
            timerId = setTimeout(processNextAlbum, 60000); // Check again in a minute
            return;
        }
        
        workerStatus.state = "Active (Extracting Spines & Cover Art)";
        workerStatus.currentAlbum = `${targetAlbum.artist} - ${targetAlbum.name}`;
        log(`Processing: ${workerStatus.currentAlbum}`);
        
        const settings = db.getSettings();
        const enableSpine = settings.enableSpineProcessing === 'true' || settings.enableSpineProcessing === true || settings.enableSpineProcessing === 1;
        if (!enableSpine) {
            workerStatus.state = "Spine processing disabled (Using reliable Spotify cover slices)";
            db.setSpineCache(targetAlbum.id, null, 'none', 28, null);
            workerStatus.processedCount = db.getSpineCount();
            timerId = setTimeout(processNextAlbum, 50); // Fast-forward through unpaid/unverified albums
            return;
        }

        const useAi = settings.useAiVision === true || settings.useAiVision === 'true';
        workerStatus.state = `Resolving artwork (${useAi ? 'Heuristics + AI Vision' : 'Heuristics only'})`;
        
        const result = await resolveAlbumArtwork(targetAlbum, useAi, {
            provider: db.getConfig('aiProvider'),
            key: db.getConfig('aiApiKey'),
            model: db.getConfig('aiModel')
        });
        
        // Save result to SQLite cache
        db.setSpineCache(targetAlbum.id, result.spineUrl, result.spineType, result.spineWidth, result.coverUrl);
        workerStatus.processedCount = db.getSpineCount();
        
        // Determine courteous rate limit delay
        let delayMs = 3000; // Default safe rate limit for Cover Art Archive & MusicBrainz
        const aiRateLimit = db.getConfig('aiRateLimit');
        if (result.usedAi && aiRateLimit) {
            const reqPerMin = parseInt(aiRateLimit, 10) || 1;
            delayMs = Math.max(3000, (60 / reqPerMin) * 1000);
        }
        
        workerStatus.state = `Waiting (${Math.round(delayMs/1000)}s rate limit delay)...`;
        log(`Waiting ${Math.round(delayMs/1000)}s before next album...`);
        timerId = setTimeout(processNextAlbum, delayMs);
        
    } catch (e) {
        log(`Worker crash: ${e.message}`);
        workerStatus.state = `Error: ${e.message}`;
        timerId = setTimeout(processNextAlbum, 10000);
    }
}

function start() {
    if (isRunning) return;
    isRunning = true;
    log('Background Spine Worker started');
    processNextAlbum();
}

function stop() {
    isRunning = false;
    if (timerId) { clearTimeout(timerId); timerId = null; }
    workerStatus.state = "Stopped";
    log('Background Spine Worker stopped');
}

function reprocessAll() {
    log('User initiated Reprocess Library with AI!');
    db.clearSpineCache();
    workerStatus.processedCount = 0;
    workerStatus.state = "Restarting library processing...";
    if (timerId) { clearTimeout(timerId); timerId = null; }
    if (isRunning) {
        processNextAlbum();
    } else {
        start();
    }
}

module.exports = {
    start,
    stop,
    getLogs,
    getStatus,
    reprocessAll
};
