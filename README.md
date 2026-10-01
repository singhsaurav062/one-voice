# Once Voice

## Run it locally

This is a client/server app. **Do not open `index.html` directly**; the browser needs the Node server for uploads, links, and playback.

1. Install Node.js 20 or newer.
2. Open a terminal in this project folder (the folder containing `package.json`).
3. Run `npm start`.
4. Open `http://localhost:3000` in your browser.

Microphone recording is allowed on localhost and on deployed HTTPS sites. If recording is unavailable, use the audio file picker.

## Files

```text
once-voice/
├── package.json          # Start command and project metadata
├── server.js             # HTTP server and upload/link/playback API
├── index.html            # Recording and upload page
├── listen.html           # One-time listening page
├── README.md             # Setup and deployment guide
├── .gitignore
├── css/
│   └── styles.css        # Shared site styling
├── js/
│   └── app.js            # Recording and upload interactions
└── data/                 # Created at runtime; audio and link metadata
```

By default, uploads are stored in `data/`; keep that directory on persistent storage when hosting the app. Messages are limited to 25 MB. The app supports one server instance with its JSON metadata file.

## Optional GitHub storage

GitHub storage is disabled unless configured. Set these **server-side** environment variables:

- `GITHUB_TOKEN`: a fine-grained token with Contents read/write access.
- `GITHUB_REPO`: repository in `owner/name` form; private is recommended.
- `GITHUB_BRANCH`: target branch (defaults to `main`).
- `GITHUB_PATH`: repository folder (defaults to `voice-messages`).

The server commits audio to GitHub and deletes the blob after a link is claimed. GitHub keeps commit history, so this does not erase all historical copies. Never put the token in browser code.

To deploy, use any Node.js host that runs `npm start`, provides persistent storage (or configure GitHub), and supports HTTPS. Set `PORT` if required by the host. Optionally set `UPLOAD_KEY` to require a shared upload key.
