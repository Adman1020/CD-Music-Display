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
- **APIs:** Spotify Web API & Web Playback SDK

## Physical CD Jewel Case Framing System

To recreate the authentic aesthetic and tactile charm of a real-world physical CD rack, CD Music Display features a **Pixel-Perfect Jewel Case Engine** with zero reliance on vector distortion or blurred image stretching.

### Key Features & Capabilities

#### 1. Authentic Acrylic Jewel Case Overlays
* **Real Plastic Textures & Specular Glaze:** Spines are enveloped in customized, chroma-keyed transparent acrylic jewel case frame imagery extracted from real physical CD packaging.
* **Precise Artwork Inscription:** Rather than stretching cover artwork across the plastic edges, cover artwork slices are snugly inset into the inner structural groove of the spine casing, allowing plastic ridges and reflection glares to naturally overlay the artwork edges.
* **Classic Plain Spine Toggle:** Prefer a sleek, minimalist aesthetic? A single click on the **Display Physical CD Jewel Cases** toggle in Settings instantly reverts the display to simple, plain album spines without plastic framing or inlay margins.

#### 2. Three Fixed Pixel-Perfect Scale Tiers
* Rather than relying on generic CSS background scaling that causes artifacting and blurring, the rack utilizes 3 tailor-made, pixel-perfect scale presets:
  - **Compact (300px Shelf Height / 33px Spine Width):** Perfect for smaller secondary monitoring screens or compact viewports, powered by custom `frame-300.png` overlays.
  - **Desktop (460px Shelf Height / 50px Spine Width):** Our standard, balanced workstation preset providing vivid cover detail and clean typography across typical displays (`frame-460.png`).
  - **Life-Size CD (700px Shelf Height / 76px Spine Width):** Immersive, museum-grade display scale that renders physical CDs at authentic 1:1 life-size dimensions on large monitors and living room TVs (`frame-700.png`).

#### 3. Streamlined 2-Column Responsive Settings Panel
* **Clean Layout:** Settings are cleanly divided into two spacious, balanced columns (Appearance & Behavior vs. Spotify Account Configuration) with fluid overflow scrolling, ensuring zero UI clutter or clipped elements on any screen resolution.
* **Instant Application & Persistence:** Toggling jewel cases or switching shelf scales updates the virtual carousel dynamically in real time without refreshing the page, saving your exact configuration directly to local storage and SQLite database settings.

---

## License

This project is licensed under the [MIT License](LICENSE).
