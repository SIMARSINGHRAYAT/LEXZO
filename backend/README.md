# Lex Studio — Backend

Flask API server that compiles and runs Lex programs using real **Flex** and **GCC**.

## Quick Start (Local)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Server starts on `http://localhost:5000`.

> **Requires** `flex` and `gcc` installed on your system.

## Quick Start (Docker)

```bash
# From project root
docker compose up --build backend
```

This builds a container with Python 3.12, Flex, Bison, GCC, and Gunicorn.

## API

### `GET /health`

Returns `{"status": "ok"}` if the server is running.

### `POST /run`

Compiles and runs a Lex program.

**Request:**
```json
{
  "code": "%{\n#include <stdio.h>\n%}\n%%\n[0-9]+  { printf(\"NUMBER: %s\\n\", yytext); }\n.       { /* skip */ }\n%%\nint main() { yylex(); return 0; }",
  "input": "hello 123 world 456"
}
```

**Response:**
```json
{
  "status": "success",
  "output": "NUMBER: 123\nNUMBER: 456\n",
  "error": "",
  "flex_output": "",
  "gcc_output": ""
}
```

**Status values:**
| Status | Meaning |
|--------|---------|
| `success` | Compiled and ran successfully |
| `compile_error` | Flex or GCC failed |
| `runtime_error` | Binary crashed or timed out |
| `error` | Bad request or server error |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Server port |
| `FLASK_DEBUG` | `0` | Enable debug mode |
| `LEX_EXEC_TIMEOUT` | `10` | Max seconds for program execution |
| `LEX_COMPILE_TIMEOUT` | `15` | Max seconds for flex/gcc |
| `LEX_MEMORY_LIMIT_MB` | `128` | Memory limit per execution |
| `LEX_MAX_CODE_SIZE` | `65536` | Max code size in bytes |
| `LEX_MAX_INPUT_SIZE` | `65536` | Max stdin size in bytes |
| `LEX_TEMP_DIR` | `/tmp/lex-workspaces` | Temporary directory for builds |

## Security

- Each request runs in an isolated temp directory (deleted after use)
- Path traversal protection — all paths validated against the workspace root
- `subprocess` uses explicit argument lists (never `shell=True`)
- Resource limits: CPU time, memory, no-fork via `setrlimit`
- Configurable timeouts prevent infinite loops
- Docker container runs with `no-new-privileges`, read-only FS, and tmpfs scratch space
- CORS enabled for frontend communication

## Production Deployment

```bash
docker compose up -d
```

- **Backend**: Gunicorn with 4 workers on port 5000
- **Frontend**: Nginx on port 5173, proxies `/api/*` → backend
- Resource-limited Docker container with Flex/GCC toolchain
