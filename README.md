# CD Music Display

> A self-hosted album art display for your Spotify library. Touch-first, Dockerised, designed for Raspberry Pi.

![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)
![NodeJS](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)
![Spotify](https://img.shields.io/badge/Spotify-1ED760?style=for-the-badge&logo=spotify&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)

## Features

- 🎵 Connect your Spotify library
- 📀 Browse albums as CD spines, covers, or grid
- ▶️ Tap to play — starts playback on any Spotify Connect device
- 🎛️ Built-in settings panel — no phone app needed
- 🖥️ Touch-optimised for wall-mounted displays
- 🐳 Docker deployment — one command setup
- 🍓 Raspberry Pi ready — kiosk mode guide included

## Screenshots

<!-- TODO: Add screenshots -->

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
4. Follow the on-screen setup instructions to configure your Spotify credentials and log in.

## Spotify Developer Setup

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Click on **Create app**.
3. Set your App name and App description.
4. Add the following **Redirect URI**: `http://localhost:3000/auth/callback` (or use your `BASE_URL` + `/auth/callback` if hosting elsewhere).
5. Ensure you check **Web API** and **Web Playback SDK** in the APIs/Permissions section.
6. Copy your **Client ID** and **Client Secret** and enter them into the app's setup screen in your browser.
7. **Note:** A Spotify Premium account is required for playback control.

## Raspberry Pi Kiosk Mode

1. Install Docker on your Raspberry Pi.
2. Clone the repository and set up the app as described in the Quick Start guide.
3. Configure auto-start for your Docker containers with systemd.
4. Set up Chromium in kiosk mode:
   ```bash
   # Install unclutter to hide cursor
   sudo apt install unclutter
   ```
   Create a script at `/home/pi/kiosk.sh`:
   ```bash
   #!/bin/bash
   xset s noblank
   xset s off
   xset -dpms
   unclutter -idle 0.5 -root &
   chromium-browser --noerrdialogs --disable-infobars --kiosk http://localhost:3000
   ```
5. Set this script to auto-start on boot via a `.desktop` file or systemd service.

## Architecture

- **Backend:** Express.js
- **Frontend:** Vanilla JS/HTML/CSS
- **Database:** SQLite (using `better-sqlite3`) for configuration and cache
- **APIs:** Spotify Web API + Playback SDK

## License

This project is licensed under the [MIT License](LICENSE).
