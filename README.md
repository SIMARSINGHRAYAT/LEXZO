# Lex Studio

## A VS Code–style web IDE for writing, compiling, and running **Lex (Flex)** programs — entirely in the browser or with a real Flex/GCC backend.

![React](https://img.shields.io/badge/React-19-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)
![Vite](https://img.shields.io/badge/Vite-7-purple)
![Flask](https://img.shields.io/badge/Flask-3-green)
![Docker](https://img.shields.io/badge/Docker-ready-blue)

---

## Features

- **Monaco Editor** with custom Lex syntax highlighting (keywords, regex, C actions)
- **File Explorer** — create, rename, delete `.l` files; persisted in IndexedDB
- **Built-in Terminal** — interactive shell with commands for compiling and running Lex programs
- **Browser Interpreter** — runs Lex programs locally without any backend
- **Backend Compiler** — optional Flask server that compiles with real `flex` + `gcc` and runs the binary
- **Dark / Light themes** — VS Code color palette, toggleable from the title bar
- **Single-file build** — entire app compiles into one `index.html` (~277 KB)

---

## Quick Start (Frontend Only)

No backend needed — the browser-based Lex interpreter handles everything.

### Prerequisites

- **Node.js** 18+ and **npm**

### Install & Run

```bash
# Clone the repo
git clone <repo-url>
cd vs-code-style-lex-editor

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open **http://localhost:5173** in your browser.

### Production Build

```bash
npm run build
```

Output: `dist/index.html` — a single self-contained HTML file you can deploy anywhere.

```bash
# Preview the production build locally
npm run preview
```

---

## Full Stack (Frontend + Backend)

The backend uses Flask with real **Flex** and **GCC** for native compilation.

### Option A — Docker (Recommended)

```bash
docker compose up --build
```

| Service  | URL                    | Description                       |
|----------|------------------------|-----------------------------------|
| Frontend | http://localhost:5173  | Nginx serving the built app       |
| Backend  | http://localhost:5000  | Flask API with Flex/GCC toolchain |

The frontend automatically proxies `/api/*` requests to the backend via Nginx.

### Option B — Run Backend Locally

> Requires `flex`, `gcc`, and Python 3.10+ installed on your system.

```bash
# Terminal 1 — Backend
cd backend
python -m venv .venv
# Linux/macOS:
source .venv/bin/activate
# Windows:
.venv\Scripts\activate

pip install -r requirements.txt
python app.py
```

```bash
# Terminal 2 — Frontend
npm run dev
```

The frontend detects the backend at `http://localhost:5000` automatically.

---

## Deploy to Render

Render hosts both the **backend** (Docker web service with Flex/GCC) and the **frontend** (static site) — no server management required.

### One-Click Blueprint Deploy

1. **Push this repo to GitHub** (public or private).

2. Go to **[Render Dashboard → Blueprints](https://dashboard.render.com/blueprints)**.

3. Click **New Blueprint Instance**.

4. **Connect your GitHub repo** — select the repo containing this project.

5. Render reads `render.yaml` and shows two services to create:
   | Service | Type | What it does |
   |---------|------|-------------|
   | `lex-studio-api` | Docker Web Service | Flask + Flex + GCC backend |
   | `lex-studio` | Static Site | Vite-built frontend |

6. Click **Apply** — Render builds and deploys both services.

7. Once deployed, open the **lex-studio** static site URL (e.g., `https://lex-studio.onrender.com`).

> The `VITE_API_URL` environment variable is automatically wired from the backend service URL — no manual configuration needed.

### Manual Deploy (Without Blueprint)

If you prefer setting things up individually:

#### Step 1 — Deploy the Backend

1. Go to **[Render Dashboard](https://dashboard.render.com)** → **New** → **Web Service**.
2. Connect your GitHub repo.
3. Configure:
   | Setting | Value |
   |---------|-------|
   | **Name** | `lex-studio-api` |
   | **Region** | Oregon (or nearest) |
   | **Runtime** | Docker |
   | **Dockerfile Path** | `./backend/Dockerfile` |
   | **Docker Context** | `./backend` |
   | **Plan** | Starter ($7/mo) or Free (with limits) |
4. Add environment variable: `PORT` = `10000`
5. Set **Health Check Path** to `/health`.
6. Click **Deploy**.
7. Copy the service URL (e.g., `https://lex-studio-api.onrender.com`).

#### Step 2 — Deploy the Frontend

1. **New** → **Static Site**.
2. Connect the same repo.
3. Configure:
   | Setting | Value |
   |---------|-------|
   | **Name** | `lex-studio` |
   | **Build Command** | `npm install && npm run build` |
   | **Publish Directory** | `./dist` |
4. Add environment variable:
   ```
   VITE_API_URL = https://lex-studio-api.onrender.com
   ```
   (use the actual URL from Step 1)
5. Under **Redirects/Rewrites**, add a rule:
   | Source | Destination | Action |
   |--------|-------------|--------|
   | `/*` | `/index.html` | Rewrite |
6. Click **Deploy**.

### After Deployment

- **Frontend**: `https://lex-studio.onrender.com` — the full IDE
- **Backend**: `https://lex-studio-api.onrender.com/health` — verify with this URL
- The status bar in the app shows **● Server Connected** when the backend is reachable.

### Render Free Tier Notes

- Free services spin down after 15 minutes of inactivity. First request after idle takes ~30–60 seconds (cold start).
- The backend Docker image is ~300 MB (Python + Flex + GCC). First deploy takes a few minutes.
- Free tier has 750 hours/month across all services.
- For always-on performance, use the **Starter** plan ($7/mo per service).

---

## How It Works

### The Editor

1. Open the app — you'll see a VS Code–like interface with a sidebar, editor, and terminal.
2. Click **New File** (or use `File → New File`) to create a `.l` file.
3. Write your Lex program in the Monaco editor. Syntax highlighting is built in.
4. Files are saved automatically to **IndexedDB** in your browser — they persist across reloads.

### The Terminal

The integrated terminal supports these commands:

| Command | Description |
|---------|-------------|
| `lex <file.l>` | Parse a Lex file and enter input mode (browser interpreter) |
| `flex <file.l>` | Compile with real Flex + GCC on the server (requires backend) |
| `run <file.l>` | Compile and run — uses backend if available, falls back to browser |
| `cat <file>` | Display file contents |
| `ls` | List all files |
| `pwd` | Print working directory |
| `clear` | Clear terminal output |
| `help` | Show all available commands |
| `echo <text>` | Print text |
| `touch <file>` | Create an empty file |
| `rm <file>` | Delete a file |

### Typical Workflow

```
# 1. Create a Lex file in the sidebar or terminal
touch wordcount.l

# 2. Write your Lex code in the editor, e.g.:
#    %{
#    #include <stdio.h>
#    int words = 0;
#    %}
#    %%
#    [a-zA-Z]+  { words++; }
#    .|\n       { /* skip */ }
#    %%
#    int main() { yylex(); printf("Words: %d\n", words); return 0; }

# 3. Compile and run (picks best available method)
run wordcount.l

# 4. Type your input, then press Enter
hello world foo bar
# → Output: Words: 4
```

### Browser vs Server Execution

| Feature | Browser Interpreter | Server Backend |
|---------|-------------------|----------------|
| Setup | None | Docker or local Flex/GCC |
| Speed | Instant | Compiled C binary |
| Compatibility | Core Lex subset | Full Flex spec |
| C code in actions | Interpreted (limited) | Native execution |
| yywrap, yylineno | Emulated | Real implementation |

The app automatically uses the server when it's available and falls back to the browser interpreter otherwise. The status bar shows the connection state:

- **● Server Connected** (green) — backend is reachable
- **○ Server Offline** (red) — using browser-only mode

---

## Project Structure

```
vs-code-style-lex-editor/
├── src/
│   ├── App.tsx             # Main application (editor, terminal, file system)
│   ├── api.ts              # Backend API client (health check, /run)
│   ├── main.tsx            # React entry point
│   ├── index.css           # Tailwind CSS entry
│   ├── types.ts            # TypeScript interfaces
│   ├── vite-env.d.ts       # Vite type declarations
│   └── utils/
│       ├── lexer.ts        # Browser-based Lex interpreter
│       └── cn.ts           # Tailwind class merge utility
├── backend/
│   ├── app.py              # Flask API server
│   ├── executor.py         # Sandboxed Flex/GCC execution engine
│   ├── Dockerfile          # Python + Flex + GCC container
│   ├── requirements.txt    # Python dependencies
│   └── README.md           # Backend-specific docs
├── docker-compose.yml      # Full-stack orchestration (local/Docker)
├── render.yaml             # Render Blueprint (one-click cloud deploy)
├── Dockerfile.frontend     # Multi-stage frontend build → Nginx
├── nginx.conf              # Reverse proxy config
├── .env                    # Environment variables
├── package.json            # Node dependencies & scripts
├── tsconfig.json           # TypeScript config
├── vite.config.ts          # Vite + Tailwind + single-file plugin
└── SPEC.md                 # Design specification
```

---

## Configuration

### Environment Variables

Create a `.env` file in the project root (one is included by default):

```env
# Backend URL for the frontend to connect to
VITE_API_URL=http://localhost:5000

# For Docker deployment (nginx handles proxying):
# VITE_API_URL=/api
```

### Backend Environment Variables

Set these on the backend service (in `docker-compose.yml` or shell):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Server port |
| `FLASK_DEBUG` | `0` | Enable Flask debug mode |
| `LEX_EXEC_TIMEOUT` | `10` | Max seconds for program execution |
| `LEX_COMPILE_TIMEOUT` | `15` | Max seconds for Flex/GCC compilation |
| `LEX_MEMORY_LIMIT_MB` | `128` | Memory limit per execution (MB) |
| `LEX_MAX_CODE_SIZE` | `65536` | Max Lex source code size (bytes) |
| `LEX_MAX_INPUT_SIZE` | `65536` | Max stdin input size (bytes) |

---

## API Reference

### `GET /health`

Health check endpoint.

**Response:** `{"status": "ok"}`

### `POST /run`

Compile and execute a Lex program.

**Request:**
```json
{
  "code": "%%\n[0-9]+  { printf(\"NUM\\n\"); }\n%%",
  "input": "abc 123"
}
```

**Response:**
```json
{
  "status": "success",
  "output": "NUM\n",
  "error": "",
  "flex_output": "",
  "gcc_output": ""
}
```

**Status values:** `success`, `compile_error`, `runtime_error`, `error`

---

## Security

- Each compilation runs in an **isolated temp directory**, cleaned up after every request
- **No `shell=True`** — all subprocess calls use explicit argument lists
- **Resource limits** — CPU time, memory, and process count capped via `setrlimit`
- **Path traversal protection** — all file paths validated against the workspace root
- **Docker hardening** — `no-new-privileges`, read-only root filesystem, tmpfs scratch space, memory/CPU limits
- **Input size limits** — configurable caps on code and stdin size

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Editor | Monaco Editor (VS Code's editor component) |
| Frontend | React 19, TypeScript 5.9, Tailwind CSS 4 |
| Bundler | Vite 7 with `vite-plugin-singlefile` |
| Storage | IndexedDB (browser-side file persistence) |
| Backend | Python 3.12, Flask 3, Gunicorn |
| Compiler | Flex, GCC, libfl |
| Deployment | Render, Docker Compose, Nginx |

---

## License

MIT
