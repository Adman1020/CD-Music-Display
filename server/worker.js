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
// AI Spine Typography & Style Engine
// ----------------------------------------------------------------------
async function resolveAlbumArtwork(album, useAi, aiConfig) {
    const coverUrl = album.image || null;
    let usedAi = false;

    // AI Typography & Style Pipeline
    if (useAi && aiConfig && aiConfig.provider && aiConfig.key) {
        try {
            const cleanName = sanitizeAlbumName(album.name);
            log(`Selecting authentic AI typography & style for: ${cleanName} by ${album.artist} via ${aiConfig.provider}...`);
            
            const fontCategories = [
                "Abril Fatface, Bodoni Moda, Playfair Display, Cinzel, Julius Sans One (classical, elegant, baroque, jazz, soul, or timeless luxury)",
                "Anton, Bebas Neue, Oswald, Montserrat, Passion One, Russo One (bold pop, heavy beats, punchy mainstream, or iconic modern block text)",
                "Audiowide, Orbitron, Syncopate, Zen Dots, Monoton, Righteous (synthwave, neon cyberpunk, electronic futurism, or techno LED display)",
                "Creepster, Nosifer, UnifrakturMaguntia, Special Elite, Space Grotesk, Bungee Inline (rock, heavy metal, gothic blackletter, grunge, or raw analog zine punk)",
                "Permanent Marker, Sedgwick Ave Display, Lobster, Bangers, Racing Sans One, Inter, Press Start 2P, Outfit (handwritten indie tag art, comic poster style, urban streetwear, 8-bit digital, or geometric perfection)"
            ];
            const shuffledCategories = fontCategories.sort(() => Math.random() - 0.5).map((cat, i) => `${i+1}. ${cat}`).join("\n");
            
            const prompt = `You are an elite graphic designer and music art historian. Your task is to select the most authentically styled typography, colors, and design metadata for the vertical text overlay on the physical CD spine of the album "${cleanName}" by "${album.artist}".\n\n` +
                           `CRITICAL CREATIVE DIVERSITY & ANTI-REPETITION RULES:\n` +
                           `- Avoid boring default font selections! Do not rely on cliché choices like Anton, Bebas Neue, or Orbitron for every record.\n` +
                           `- To make a vibrant physical CD rack where every jewelcase spine looks distinct, explore our FULL typeface palette. Even within a musical genre, seek out surprising, artistic, editorial, retro, or boutique font variations!\n` +
                           `- If the album or artist name is long (> 25 characters), avoid ultra-wide fonts and choose tighter lettering ("letterSpacing": "normal" or "-1px") so the title fits comfortably on the narrow jewel case without falling off the edge!\n\n` +
                           `CRITICAL READABILITY RULES: This text will appear vertically over a slice of the album's actual cover artwork.\n` +
                           `- You MUST ensure extreme typographic contrast and readability over complex artwork slices.\n` +
                           `- For dark or vibrant cover art, choose crisp, bright, luminous colors (e.g., pure white #FFFFFF, cream #F8F6F0, neon yellow #FFEA00, or bright cyan #00F0FF).\n` +
                           `- For light or white cover art, choose bold, deep, authoritative dark colors (e.g., jet black #0A0A0A, deep navy #0A192F, or dark burgundy #3A0007).\n` +
                           `- Never select medium, muted, or low-contrast colors that could wash out or blend into artwork.\n\n` +
                           `OPTIMAL VERTICAL TEXT POSITIONING:\n` +
                           `- To avoid clashing with visual clutter or dominant design elements on the artwork slice, decide where along the vertical spine the typography will look best and be most legible.\n` +
                           `- Select "verticalAlignment": "start" (bottom-aligned, classic CD style), "center" (centered vertically), or "end" (top-aligned, leaving breathing room below).\n\n` +
                           `Available Google Fonts (choose ONE from this randomized palette):\n` +
                           `${shuffledCategories}\n\n` +
                           `Return ONLY a valid JSON object matching this exact schema (no markdown, no explanations):\n` +
                           `{\n` +
                           `  "fontFamily": "Selected font family name exactly as spelled above",\n` +
                           `  "fontWeight": "400 or 700 or 800",\n` +
                           `  "letterSpacing": "normal or 1px or 2px or -1px",\n` +
                           `  "textTransform": "uppercase or lowercase or capitalize or none",\n` +
                           `  "textColor": "#hexcode high-contrast readable album title color",\n` +
                           `  "artistColor": "#hexcode complementary high-contrast artist color",\n` +
                           `  "verticalAlignment": "start or center or end",\n` +
                           `  "catalogNumber": "Simulated or real catalog number e.g. CD-78219 or 4AD-0012",\n` +
                           `  "recordLabel": "Simulated or real record label name"\n` +
                           `}`;

            let generatedText = "";
            usedAi = true;

            if (aiConfig.provider === 'openai') {
                const res = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiConfig.key}` },
                    body: JSON.stringify({
                        model: aiConfig.model || 'gpt-4o-mini',
                        messages: [{ role: "user", content: prompt }],
                        max_tokens: 350,
                        temperature: 0.9
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
                        generationConfig: { maxOutputTokens: 500, temperature: 0.9 }
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
                        max_tokens: 350,
                        temperature: 0.9,
                        messages: [{ role: "user", content: prompt }]
                    })
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error.message);
                generatedText = data.content[0].text;
            }

            const jsonMatch = generatedText.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
                const styleMeta = JSON.parse(jsonMatch[0]);
                log(`✨ AI Styled spine for ${album.artist} - ${album.name} -> Font: ${styleMeta.fontFamily} | Align: ${styleMeta.verticalAlignment || 'start'} | Color: ${styleMeta.textColor}`);
                return { coverUrl, spineUrl: '', spineType: 'ai_style', spineWidth: 28, usedAi: true, styleMeta };
            } else {
                log(`AI response did not contain valid JSON syntax. Preview: ${generatedText}`);
            }
        } catch (err) {
            log(`AI Typography style error for ${album.name}: ${err.message}`);
        }
    }

    // Default Fallback: Reliable left-edge cover slice with Inter styling
    log(`Using standard left-edge cover slice at single jewel case width (28px).`);
    return { coverUrl, spineUrl: '', spineType: 'none', spineWidth: 28, usedAi, styleMeta: null };
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
        
        const settings = db.getSettings();
        const enableSpine = settings.enableSpineProcessing === 'true' || settings.enableSpineProcessing === true || settings.enableSpineProcessing === 1;
        const useAi = settings.useAiVision === true || settings.useAiVision === 'true' || settings.useAiVision === 1;
        const aiTestingMode = settings.aiTestingMode !== 'false' && settings.aiTestingMode !== false && settings.aiTestingMode !== 0;

        let targetAlbum = null;
        for (const album of albums) {
            const cache = db.getSpineCache(album.id);
            // Target if uncached, or if AI styling is enabled but this album hasn't received AI typography styles yet
            if (!cache || (enableSpine && useAi && (!cache.styleMeta || cache.spineType !== 'ai_style'))) {
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

        workerStatus.state = `Resolving artwork (${useAi ? 'AI Typography & Style Engine' : 'Standard'})`;
        
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
        db.setSpineCache(targetAlbum.id, result.spineUrl, result.spineType, result.spineWidth, result.coverUrl, result.styleMeta);
        workerStatus.processedCount = db.getSpineCount();
        
        // Determine rate limit delay (only enforce user-configured delay when using AI)
        let delayMs = 50; // Practically instant when processing locally without AI
        if (result.usedAi) {
            const aiRateLimit = db.getConfig('aiRateLimit');
            const reqPerMin = parseInt(aiRateLimit, 10) || 30; // Default to 30 req/min if unspecified
            delayMs = Math.max(100, Math.round((60 / reqPerMin) * 1000));
            const seconds = (delayMs / 1000).toFixed(1);
            workerStatus.state = `Waiting (${seconds}s rate limit delay)...`;
            log(`Waiting ${seconds}s (based on ${reqPerMin} req/min limit) before next album...`);
        } else {
            workerStatus.state = "Processing local album...";
        }
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
