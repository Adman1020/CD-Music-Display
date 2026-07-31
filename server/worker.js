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
    // Strip common Spotify suffixes that break MusicBrainz
    return name
        .replace(/\(.*?remaster.*?\)/i, '')
        .replace(/\(.*?deluxe.*?\)/i, '')
        .replace(/\(.*?original motion picture soundtrack.*?\)/i, '')
        .replace(/\(.*?soundtrack.*?\)/i, '')
        .replace(/ - remaster.*/i, '')
        .replace(/ - .*?edition/i, '')
        .trim();
}

// ----------------------------------------------------------------------
// MusicBrainz & Cover Art Archive Fetch
// ----------------------------------------------------------------------
async function fetchSpineHeuristically(albumName, artistName) {
    const name = sanitizeAlbumName(albumName);
    const mbUrl = `https://musicbrainz.org/ws/2/release?query=release:"${encodeURIComponent(name)}" AND artist:"${encodeURIComponent(artistName)}"&fmt=json`;
    
    const mbRes = await fetch(mbUrl, { headers: { 'User-Agent': 'CDMusicDisplay/1.0 ( local@local.com )' } });
    if (!mbRes.ok) throw new Error('MusicBrainz API error');
    
    const mbData = await mbRes.json();
    if (!mbData.releases || mbData.releases.length === 0) {
        throw new Error(`No MusicBrainz match for "${name}"`);
    }
    
    const mbid = mbData.releases[0].id;
    const caaUrl = `https://coverartarchive.org/release/${mbid}`;
    const caaRes = await fetch(caaUrl, { headers: { 'User-Agent': 'CDMusicDisplay/1.0' } });
    
    if (!caaRes.ok) throw new Error(`No CoverArtArchive found for MBID ${mbid}`);
    
    const caaData = await caaRes.json();
    const images = caaData.images || [];
    
    const getUrl = (img) => {
        if (img.thumbnails && img.thumbnails['500']) return img.thumbnails['500'];
        return img.image;
    };
    
    const spineImg = images.find(img => img.types && img.types.includes('Spine'));
    if (spineImg) {
        return { url: getUrl(spineImg), type: 'spine' };
    }
    
    const backImg = images.find(img => img.types && img.types.includes('Back'));
    if (backImg) {
        return { url: getUrl(backImg), type: 'back' };
    }
    
    throw new Error('No Spine or Back image found in CAA');
}

// ----------------------------------------------------------------------
// AI Vision Pipeline
// ----------------------------------------------------------------------
async function fetchSpineWithAI(album, aiConfig) {
    log(`AI processing requested via ${aiConfig.provider} using ${aiConfig.model}`);
    
    // First, we need an image that might contain a spine. We use CAA.
    const name = sanitizeAlbumName(album.name);
    const mbUrl = `https://musicbrainz.org/ws/2/release?query=release:"${encodeURIComponent(name)}" AND artist:"${encodeURIComponent(album.artist)}"&fmt=json`;
    const mbRes = await fetch(mbUrl, { headers: { 'User-Agent': 'CDMusicDisplay/1.0' } });
    
    if (!mbRes.ok) throw new Error('MusicBrainz API error');
    const mbData = await mbRes.json();
    if (!mbData.releases || mbData.releases.length === 0) throw new Error('No release found in MB');
    
    const mbid = mbData.releases[0].id;
    const caaUrl = `https://coverartarchive.org/release/${mbid}`;
    const caaRes = await fetch(caaUrl, { headers: { 'User-Agent': 'CDMusicDisplay/1.0' } });
    if (!caaRes.ok) throw new Error('No Cover Art Archive found');
    
    const caaData = await caaRes.json();
    const images = caaData.images || [];
    
    // Grab the first high-res back or unclassified image
    const targetImage = images.find(img => img.types && (img.types.includes('Back') || img.types.includes('Spine') || img.types.includes('Other') || img.types.length === 0));
    
    if (!targetImage) throw new Error('No suitable candidate images to send to AI');
    const imageUrl = targetImage.image;
    
    log(`Downloading candidate image for AI: ${imageUrl}`);
    
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error('Failed to download image for AI');
    const arrayBuffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    
    log(`Sending image to ${aiConfig.provider} (${aiConfig.model})...`);
    
    const prompt = "This is a CD jewel case scan. Find the CD spine (the long thin strip with the artist and album name). Reply ONLY with a valid JSON object in this format: { \"box\": { \"x\": 0.0, \"y\": 0.0, \"width\": 0.0, \"height\": 0.0 } } where the values are percentages from 0.0 to 1.0 of the image dimensions. If there is no spine, return {}. Do not include markdown blocks.";
    
    let jsonText = "";
    
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
    
    // Parse JSON
    try {
        jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(jsonText);
        
        if (!parsed.box || !parsed.box.width) {
            throw new Error("AI did not find a spine in the image");
        }
        
        log(`AI found spine at x=${parsed.box.x} y=${parsed.box.y}`);
        
        // Use Sharp to crop the image
        const sharp = require('sharp');
        const img = sharp(Buffer.from(arrayBuffer));
        const metadata = await img.metadata();
        
        const cropX = Math.floor(parsed.box.x * metadata.width);
        const cropY = Math.floor(parsed.box.y * metadata.height);
        const cropW = Math.floor(parsed.box.width * metadata.width);
        const cropH = Math.floor(parsed.box.height * metadata.height);
        
        const croppedBuffer = await img
            .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
            .toBuffer();
            
        // Save locally
        const fs = require('fs');
        const path = require('path');
        const dataDir = path.join(__dirname, '../public/data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        
        const filename = `spine_${album.id}.jpg`;
        fs.writeFileSync(path.join(dataDir, filename), croppedBuffer);
        
        return { url: `/data/${filename}`, type: 'ai_crop' };
        
    } catch (e) {
        throw new Error(`AI JSON parsing failed: ${e.message}`);
    }
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
        
        workerStatus.state = "Active (Extracting Spines)";
        workerStatus.currentAlbum = `${targetAlbum.artist} - ${targetAlbum.name}`;
        log(`Processing: ${workerStatus.currentAlbum}`);
        
        const settings = db.getSettings();
        const config = db.getAllConfig();
        
        const useAi = settings.useAiVision === true || settings.useAiVision === 'true';
        let result = null;
        let aiFailed = false;
        
        if (useAi && config.aiProvider && config.aiApiKey) {
            try {
                workerStatus.state = `AI Extraction (${config.aiProvider} : ${config.aiModel || 'default'})`;
                result = await fetchSpineWithAI(targetAlbum, {
                    provider: config.aiProvider,
                    key: config.aiApiKey,
                    model: config.aiModel
                });
            } catch (e) {
                log(`AI Failed: ${e.message}. Falling back to Heuristics.`);
                aiFailed = true;
            }
        }
        
        if (!result) {
            try {
                workerStatus.state = "Heuristic Extraction (MusicBrainz/CAA)";
                result = await fetchSpineHeuristically(targetAlbum.name, targetAlbum.artist);
                log(`Heuristic Success: Found [${result.type}] image`);
            } catch (e) {
                log(`Heuristic Failed: ${e.message}`);
                result = { url: null, type: 'none' };
            }
        }
        
        // Save result
        db.setSpineCache(targetAlbum.id, result.url, result.type);
        workerStatus.processedCount = db.getSpineCount();
        
        // Determine delay
        let delayMs = 3000; // Default safe rate limit for MusicBrainz
        if (useAi && !aiFailed && config.aiRateLimit) {
            const reqPerMin = parseInt(config.aiRateLimit, 10) || 1;
            delayMs = (60 / reqPerMin) * 1000;
        }
        
        workerStatus.state = `Waiting (${Math.round(delayMs/1000)}s rate limit delay)...`;
        log(`Waiting ${Math.round(delayMs/1000)}s before next...`);
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
