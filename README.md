# CD Music Display

> ⚠️ **Disclaimer:** This project was entirely "vibe coded" by an AI agent (Google Antigravity). It is experimental!

> An ultra-wide, touch-first, self-hosted physical CD shelf UI for your Spotify library. Dockerised and designed specifically for long, wide hardware displays like a wall-mounted marquee.

![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)
![NodeJS](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)
![Spotify](https://img.shields.io/badge/Spotify-1ED760?style=for-the-badge&logo=spotify&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)

## Features

- 🎵 **Spotify Integration**: Connect your entire Spotify library and control playback via the Spotify Web API.
- 📀 **Physical CD Rack UI**: Browse your albums as a continuous, swipeable rack of physical CD spines.
- 🎛️ **Glassmorphic Controls**: Tap any album to bring it front-and-center. A slick, auto-hiding glass overlay provides play controls and a global mini-player.
- 📱 **Spotify Connect Ready**: Pick which of your physical Spotify Connect devices (Sonos, Echo, Desktop) to play music out of directly from the UI.
- ⚙️ **On-Screen Settings**: A full-screen overlay for changing themes, sort orders, and managing API keys without needing an external app.
- 🖥️ **Ultra-Wide Optimised**: Custom engineered specifically for displays that are very wide but not very tall.
- 🐳 **Docker Deployment**: One-command setup.

## Screenshots

![CD Music Display UI](screenshot-wide.png)

## Quick Start (Docker)

1. Clone the repository:
   ```bash
   git clone https://github.com/Adman1020/CD-Music-Display.git
   cd CD-Music-Display
   ```
2. Start the application using Docker Compose:
   ```bash
   docker compose up -d
   ```
3. Open [http://localhost:3000](http://localhost:3000) in your browser.
4. Follow the on-screen setup wizard to configure your Spotify credentials and log in.

## Spotify Developer Setup

Because this app acts as a remote control for your Spotify account, you must create a personal Spotify Developer App.

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in.
2. Click on **Create app**.
3. Set your App name and App description to whatever you like.
4. Add the following **Redirect URI**: `http://127.0.0.1:3000/auth/callback` (or `http://localhost:3000/auth/callback` if testing locally, or your specific IP address if accessing over the network).
5. Ensure you check **Web API** and **Web Playback SDK** in the APIs/Permissions section.
6. Copy your **Client ID** and **Client Secret** and enter them into the app's setup screen in your browser.
7. **Note:** A Spotify Premium account is required for full playback control and Connect features.

## Architecture

- **Backend:** Express.js (Node.js) serving a REST API and managing Spotify OAuth securely.
- **Frontend:** Vanilla JavaScript, HTML5, and CSS3. Zero heavy frameworks.
- **Database:** SQLite (via `better-sqlite3`) to securely store your configuration, access tokens, and cached album art.
- **APIs:** Spotify Web API, Cover Art Archive, MusicBrainz, + AI Vision models (optional)

## Artwork Engine & Variable-Width Shelf

To recreate the realism of a physical CD rack, the background worker server uses a multi-tiered pipeline that independently resolves **Front Cover Art** and **Spine Artwork** for every album in your Spotify library.

### Pipeline Workflow Diagram

```mermaid
graph TD
    A[Worker Loop: Analyze Album] --> B[Step 1: Front Cover Art Resolution]
    A --> C[Step 2: Spine Artwork Resolution]
    
    %% Front Cover Workflow
    B --> B1(Use Spotify High-Res Cover Art for optimal quality and consistency)
    
    %% Spine Workflow
    C --> C1[Query CoverArtArchive for explicit 'Spine' scan]
    C1 --> C2{Check Aspect Ratio}
    C2 -->|Valid Thin Spine: ratio <= 0.35| C3(Calculate Proportional Width at 300px Height<br/>Clamp: 18px to 95px<br/>Result: 'spine' with Custom Width & Hide Text)
    C2 -->|Too Wide: ratio > 0.35| C4[Reclassify as Full Traycard Scan for AI Crop]
    
    C1 -->|Not Found or Reclassified| C5{Is AI Vision Enabled?}
    C4 --> C5
    C5 -->|Yes| C6[Send Back/Traycard/Booklet scans to AI Model]
    C6 -->|AI Detects Valid Bounding Box| C7[Sharp Crops exact spine coordinate<br/>Clamp Width: 18px to 95px<br/>Result: 'ai_crop' & Hide Text]
    
    C6 -->|AI Failed / Invalid Ratio| C8[Tier 3: Ultimate Fallback]
    C5 -->|No| C8
    C8 --> C9(Result: 'none' at Standard 28px Width<br/>Crop left-edge of Front Cover<br/>SHOW vertical HTML Text Overlay)
```

### Key Technical Details

#### 1. Consistent High-Res Front Covers & CD Format Protection
* Front cover art is strictly sourced from Spotify's official high-resolution album imagery to guarantee vibrant visual consistency across your catalog without uneven scanner borders or brightness artifacts.
* When scanning MusicBrainz and the Cover Art Archive for CD spines, queries explicitly append `AND format:CD` to ensure we never accidentally import vinyl gatefold or audio cassette packaging dimensions.

#### 2. Strict Aspect Ratio Verification & Variable-Width CD Spines
* On a physical shelf, slimline CD single cases are extremely thin (~18px), standard single jewel cases are medium (~28px), and double albums ("fatboxes") or deluxe digipaks are much thicker (up to ~95px).
* Whenever a candidate scan is found on Cover Art Archive tagged as `Spine`, our server-side `sharp` image processing engine checks its geometry. Because uploaders frequently tag full unfolded back traycard scans as `Spine`, the server enforces an **Aspect Ratio Gatekeeper**: any image whose width is greater than 35% of its height is rejected as a direct spine and automatically forwarded to AI Vision to crop out the true spine flap!
* Validated spine dimensions are proportionally calculated when scaled to a 300px shelf height:
  $$\text{Target Width} = \min\left(95, \max\left(18, \text{round}\left(300 \times \frac{\text{original width}}{\text{original height}}\right)\right)\right)$$

#### 3. Interactive Toggleable Pop-Out Box & Sequential Animation
* Clicking any CD spine smoothly scrolls it to the center of the screen first, waiting until the album arrives in the middle before activating a smooth 3D jewel-case pop-out animation without any cover art flickering.
* A clean SVG minimize icon in the top right corner of the glassmorphic controls overlay allows you to fold the album away directly back into its native spine width on the rack, with adjacent CDs seamlessly sliding together to close up any empty gaps.

#### 4. Authentic Text Overlay Logic
* Whenever a real scan is discovered (either an explicit Cover Art Archive spine or an AI-cropped inlay), the UI automatically hides the HTML vertical font overlay so you can appreciate the original typography printed on the CD artwork.
* The vertical text overlay is only displayed when utilizing the fallback left-edge slice of the album cover art.

---

## CD Spine Extraction & AI Vision

By default, the server uses a **Heuristics Pipeline** to sanitize album titles (removing suffixes like "(Remastered)" or "(Deluxe Edition)") and query Cover Art Archive for explicit `Spine` tagged scans.

If an explicit spine is absent, you can enable **AI Vision** in the settings:
- The background worker will download candidate scans (back covers, traycards, booklets) and send them to an AI model (Gemini, OpenAI, or Claude) to detect the precise bounding box of the spine, which is then physically cropped via `sharp` and saved locally.
- **Costs:** This relies entirely on your personal API key and will incur API usage charges from your provider. 
- **Rate Limits:** To prevent unexpected bills and API throttling, you can configure a courteous rate limit in the settings (defaulting to 1 request per minute). 
- **Live Worker Logs:** You can monitor what the background extraction engine is doing in real-time by opening the "Worker Logs" diagnostic console directly inside the settings menu!

### Recommended AI Models
> *Note: These recommendations are current as of the time of publishing. AI models evolve rapidly, so you may want to test newer versions as they become available.*

Since extracting a spine requires precise spatial reasoning (identifying a bounding box and outputting strict JSON coordinates), we recommend using flagship or highly capable multimodal models:

1. **Google Gemini**
   - **`gemini-1.5-pro`** *(Recommended)*: Flagship model. Incredible spatial reasoning; handles complex JSON bounding boxes flawlessly.
   - **`gemini-1.5-flash`**: A faster, significantly cheaper alternative that is still highly capable of vision extraction.
2. **Anthropic Claude**
   - **`claude-3-5-sonnet-20240620`** *(Recommended)*: Anthropic's sweet-spot model. Often beats heavier models in vision tasks and is incredibly smart at deciphering cluttered CD back-cover scans.
3. **OpenAI**
   - **`gpt-4o`** *(Recommended)*: The current multimodal flagship. Very fast and highly accurate for visual JSON extraction.
   - **`gpt-4o-mini`**: Their newest lightweight model. Highly cost-effective if you have a massive CD library to process.

## License

This project is licensed under the [MIT License](LICENSE).
