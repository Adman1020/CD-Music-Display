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
    B --> B1[Query CoverArtArchive for 'Front' scan]
    B1 -->|Found| B2(Pad to exact 300x300 Square<br/>Save as primary Cover Art)
    B1 -->|Not Found| B3(Use Spotify High-Res Cover Art)
    
    %% Spine Workflow
    C --> C1[Query CoverArtArchive for explicit 'Spine' scan]
    C1 -->|Found Explicit Spine| C2(Calculate Aspect Ratio Width at 300px Height<br/>Min Width: 28px)
    C2 --> C3(Result: 'spine' with Custom Width<br/>Hide HTML Text Overlay)
    
    C1 -->|Not Found| C4{Is AI Vision Enabled?}
    C4 -->|Yes| C5[Send Back/Traycard/Booklet scans to AI Model]
    C5 -->|AI Detects Spine Bounding Box| C6[Sharp Crops exact spine coordinate]
    C6 --> C7(Calculate Custom Pixel Width at 300px Height<br/>Min Width: 28px)
    C7 --> C8(Result: 'ai_crop' with Custom Width<br/>Hide HTML Text Overlay)
    
    C5 -->|AI Failed / Not Found| C9[Tier 3: Ultimate Fallback]
    C4 -->|No| C9
    C9 --> C10(Result: 'none' at Standard 28px Width<br/>Crop left-edge of Front Cover<br/>SHOW vertical HTML Text Overlay)
```

### Key Technical Details

#### 1. Independent Retrieval & CD Format Protection
* When scanning MusicBrainz and the Cover Art Archive, queries explicitly append `AND format:CD` to ensure we never accidentally import vinyl gatefold or audio cassette packaging dimensions.
* Front cover scans and spine scans are resolved independently so that each can be sourced from its most faithful database representation.

#### 2. Variable-Width CD Spines
* On a physical shelf, standard single jewel cases are thin (~10mm / 28px), whereas double albums ("fatboxes"), digipaks, and deluxe cardboard sleeves are two to three times thicker.
* Whenever an authentic spine scan is extracted (via heuristic tag or AI bounding box crop), our server-side `sharp` image processing engine inspects its true native dimensions and calculates its proportional width when scaled to a 300px shelf height:
  $$\text{Target Width} = \max\left(28, \text{round}\left(300 \times \frac{\text{original width}}{\text{original height}}\right)\right)$$
* Widths are clamped to a minimum of **28px** so single CD jewel cases remain easy to click, while thicker albums render dynamically wider on your shelf!

#### 3. Square Front Cover Padding
* When Cover Art Archive supplies a Front cover scan, it is often slightly rectangular due to scanner borders or folded booklet tabs. 
* To prevent typography from being squished or distorted, the server uses `sharp` to pad non-square artwork into a perfectly uniform **300x300px square** canvas against a crisp black background.

#### 4. Interactive Toggleable Pop-Out Box
* Clicking any CD spine smoothly scrolls it to the center of the screen and pops out its 300x300px front cover art.
* A small minimize button (`✕`) in the top right corner of the cover allows you to fold the album away. When clicked, a 3D jewel-case folding animation collapses the cover directly back into its native spine width on the rack, and adjacent CDs seamlessly slide together to close up any empty gaps.

#### 5. Authentic Text Overlay Logic
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
