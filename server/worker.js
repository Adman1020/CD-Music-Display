const db = require('./db');
const fs = require('fs');
const path = require('path');

let isRunning = false;
let timerId = null;
let testBatchRemaining = 0;
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

// ----------------------------------------------------------------------
// Generative Vector (SVG) Spine Design Engine
// ----------------------------------------------------------------------
async function resolveAlbumArtwork(album, useAi, aiConfig) {
    const fs = require('fs');
    const path = require('path');
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const coverUrl = album.image || null;
    let usedAi = false;

    // Generative Vector (SVG) Pipeline
    if (useAi && aiConfig && aiConfig.provider && aiConfig.key) {
        try {
            const cleanName = sanitizeAlbumName(album.name);
            log(`Generating custom vector SVG spine for: ${cleanName} by ${album.artist} via ${aiConfig.provider} (${aiConfig.model})...`);
            
            const prompt = `You are an elite graphic designer specializing in authentic physical CD packaging design. Your task is to design a historically and stylistically accurate CD spine as a raw SVG element specifically for the album "${cleanName}" by "${album.artist}".\n\n` +
                           `Strict Design Constraints:\n` +
                           `1. Specific Album Era & Aesthetic: Do NOT make a generic design for the artist as a whole. An artist's branding, typography style, color palette, and logo change over time; your design MUST reflect the specific point in time, visual identity, and art style of this exact album release. Make it look like it could be the genuine physical spine printed for this specific CD.\n` +
                           `2. Root Element: MUST be <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 3000" width="100%" height="100%"> (exact 1:10 aspect ratio representing a single jewel case spine).\n` +
                           `3. Background & Styling: Use accurate color fills, SVG linear/radial gradients, patterns, or artwork motifs that directly echo the original album cover and release era.\n` +
                           `4. Vertical Typography: Include prominent vertical text using <text> tags with styling (font family, weight, tracking, letter-spacing, and casing) that matches the specific typography and logo vibe used on this album. Rotate the text (using transform="rotate(270, 140, 1500)" or transform="rotate(90, 140, 1500)") so it reads cleanly along the length of the spine. Clearly display the artist name and album title.\n` +
                           `5. Commercial Authenticity: At the bottom or top end of the spine (near y=180 or y=2820), include a tiny simulated record label logo symbol (simple vector marks/shapes) and a simulated catalog serial number (e.g. "CD-78219" in small font) to evoke an authentic physical commercial release.\n` +
                           `6. Do NOT draw external plastic jewel case glare, reflections, or 3D borders (our frontend CSS acrylic glass engine automatically projects realistic polycarbonate jewel case lighting over top of your printed artwork strip).\n` +
                           `7. Efficiency & Clean Vector Code: Do NOT attempt to recreate photographic artwork using dense, overly complex <path> tracing or thousands of coordinates. Use elegant, clean vector design primitives (<rect>, <circle>, <polygon>, <line>, <g>, SVG gradients, and stylized <text>) so the SVG remains compact (under 300 lines of XML), renders instantly, and never exceeds output limits.\n\n` +
                           `Return ONLY the complete valid raw SVG code starting with <svg and ending with </svg>. Do not wrap in markdown code blocks or include explanatory prose.`;

            let generatedText = "";
            usedAi = true;

            if (aiConfig.provider === 'openai') {
                const res = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiConfig.key}` },
                    body: JSON.stringify({
                        model: aiConfig.model || 'gpt-4o-mini',
                        messages: [{ role: "user", content: prompt }],
                        max_tokens: 4096
                    })
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error.message);
                generatedText = data.choices[0].message.content;
            } 
            else if (aiConfig.provider === 'gemini') {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model || 'gemini-2.5-flash'}:generateContent?key=${aiConfig.key}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { maxOutputTokens: 8192, temperature: 0.7 }
                    })
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error.message);
                generatedText = data.candidates[0].content.parts[0].text;
            }
            else if (aiConfig.provider === 'claude') {
                const res = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': aiConfig.key, 'anthropic-version': '2023-06-01' },
                    body: JSON.stringify({
                        model: aiConfig.model || 'claude-3-5-sonnet-20240620',
                        max_tokens: 4096,
                        messages: [{ role: "user", content: prompt }]
                    })
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error.message);
                generatedText = data.content[0].text;
            }

            // Extract the clean SVG tag
            const svgMatch = generatedText.match(/<svg[\s\S]*?<\/svg>/i);
            if (svgMatch) {
                const filename = `spine_${album.id}.svg`;
                const filepath = path.join(dataDir, filename);
                fs.writeFileSync(filepath, svgMatch[0], 'utf-8');
                log(`Successfully generated vector SVG spine for ${album.artist} - ${album.name}`);
                return { coverUrl, spineUrl: `/data/${filename}`, spineType: 'ai_svg', spineWidth: 28, usedAi: true };
            } else {
                // Check if response started with <svg but got truncated before </svg>
                const partialMatch = generatedText.match(/<svg[\s\S]+/i);
                if (partialMatch && partialMatch[0].length > 100) {
                    const salvagedSvg = partialMatch[0] + "\n</svg>";
                    const filename = `spine_${album.id}.svg`;
                    const filepath = path.join(dataDir, filename);
                    fs.writeFileSync(filepath, salvagedSvg, 'utf-8');
                    log(`⚠️ Salvaged truncated SVG spine for ${album.artist} - ${album.name} by appending missing </svg> tag.`);
                    return { coverUrl, spineUrl: `/data/${filename}`, spineType: 'ai_svg', spineWidth: 28, usedAi: true };
                }
                
                const preview = generatedText.length > 180 ? generatedText.substring(0, 180) + "..." : generatedText;
                log(`AI response did not contain valid SVG syntax (Length: ${generatedText.length} chars). Preview: ${preview.replace(/\n/g, " ")}`);
            }
        } catch (err) {
            log(`Generative SVG design error for ${album.name}: ${err.message}`);
        }
    }

    // Ultimate Fallback: Default left-edge slice of Spotify cover art at standard single jewel case width (28px)
    log(`Using fallback left-edge cover slice at standard single jewel case width (28px).`);
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
        
        const settings = db.getSettings();
        const enableSpine = settings.enableSpineProcessing === 'true' || settings.enableSpineProcessing === true || settings.enableSpineProcessing === 1;
        const useAi = settings.useAiVision === true || settings.useAiVision === 'true' || settings.useAiVision === 1;
        const aiTestingMode = settings.aiTestingMode !== 'false' && settings.aiTestingMode !== false && settings.aiTestingMode !== 0;
        
        if (enableSpine && useAi && aiTestingMode && testBatchRemaining <= 0) {
            workerStatus.state = "Paused (AI Testing Mode active — Turn mode OFF or click 'Process 5 Albums' to run a test batch)";
            workerStatus.currentAlbum = null;
            timerId = setTimeout(processNextAlbum, 4000);
            return;
        }

        workerStatus.state = "Active (Extracting Spines & Cover Art)";
        workerStatus.currentAlbum = `${targetAlbum.artist} - ${targetAlbum.name}`;
        log(`Processing: ${workerStatus.currentAlbum}`);
        
        if (!enableSpine) {
            workerStatus.state = "Spine processing disabled (Using reliable Spotify cover slices)";
            db.setSpineCache(targetAlbum.id, null, 'none', 28, null);
            workerStatus.processedCount = db.getSpineCount();
            timerId = setTimeout(processNextAlbum, 50); // Fast-forward through unpaid/unverified albums
            return;
        }

        workerStatus.state = `Resolving artwork (${useAi ? 'Generative Vector AI' : 'Standard'})`;
        
        const result = await resolveAlbumArtwork(targetAlbum, useAi, {
            provider: db.getConfig('aiProvider'),
            key: db.getConfig('aiApiKey'),
            model: db.getConfig('aiModel')
        });
        
        if (result.usedAi && testBatchRemaining > 0) {
            testBatchRemaining--;
            log(`Test batch progress: ${testBatchRemaining} album(s) left in current test batch.`);
            if (testBatchRemaining <= 0) {
                log(`🧪 AI Test Batch complete! Worker paused to protect token budget while you inspect results.`);
            }
        }

        // Save result to SQLite cache
        db.setSpineCache(targetAlbum.id, result.spineUrl, result.spineType, result.spineWidth, result.coverUrl);
        workerStatus.processedCount = db.getSpineCount();
        
        // Determine courteous rate limit delay
        let delayMs = 3000;
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

function startTestBatch(count = 5) {
    log(`User initiated AI Test Batch processing of ${count} albums.`);
    testBatchRemaining = count;
    workerStatus.state = `Starting AI Test Batch (${count} albums)...`;
    if (timerId) { clearTimeout(timerId); timerId = null; }
    if (!isRunning) start();
    else processNextAlbum();
}

module.exports = {
    start,
    stop,
    getLogs,
    getStatus,
    reprocessAll,
    startTestBatch
};
