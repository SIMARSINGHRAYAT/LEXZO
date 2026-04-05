"""
Lex Studio — Backend API

Flask application exposing a /run endpoint that accepts Lex (.l) source code
and optional stdin, compiles it with Flex + GCC, executes the binary, and
returns structured JSON output.

Production: gunicorn -w 4 -b 0.0.0.0:5000 app:app
"""

import logging
import os
import uuid

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from executor import LexExecutor

# ── Logging ─────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── App ─────────────────────────────────────────────────────────────────────

app = Flask(__name__)

# CORS: restrict to allowed origins (set ALLOWED_ORIGINS env var; defaults to all for dev)
allowed_origins = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
CORS(app, resources={r"/*": {"origins": allowed_origins}})

# Rate limiting: prevent abuse
limiter = Limiter(get_remote_address, app=app, default_limits=["60 per minute"])

# Configurable limits (overridable via env vars)
MAX_CODE_SIZE = int(os.environ.get("LEX_MAX_CODE_SIZE", 64 * 1024))         # 64 KB
MAX_INPUT_SIZE = int(os.environ.get("LEX_MAX_INPUT_SIZE", 64 * 1024))       # 64 KB
EXEC_TIMEOUT = int(os.environ.get("LEX_EXEC_TIMEOUT", 10))                  # 10 s
COMPILE_TIMEOUT = int(os.environ.get("LEX_COMPILE_TIMEOUT", 15))            # 15 s
MEMORY_LIMIT_MB = int(os.environ.get("LEX_MEMORY_LIMIT_MB", 128))           # 128 MB
TEMP_DIR = os.environ.get("LEX_TEMP_DIR", "/tmp/lex-workspaces")

executor = LexExecutor(
    temp_root=TEMP_DIR,
    compile_timeout=COMPILE_TIMEOUT,
    exec_timeout=EXEC_TIMEOUT,
    memory_limit_mb=MEMORY_LIMIT_MB,
)


# ── Health ──────────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


# ── /run Endpoint ───────────────────────────────────────────────────────────

@app.route("/run", methods=["POST"])
@limiter.limit("10 per minute")
def run_lex():
    """
    Accepts JSON:
      {
        "code": "<lex source code>",
        "input": "<optional stdin data>"
      }

    Returns JSON:
      {
        "status": "success" | "compile_error" | "runtime_error" | "error",
        "output": "<stdout from the compiled lexer>",
        "error": "<stderr / error message>",
        "flex_output": "<flex command stderr if any>",
        "gcc_output": "<gcc command stderr if any>"
      }
    """
    # ── Parse request ───────────────────────────────────────────────────────
    data = request.get_json(silent=True)
    if not data:
        return jsonify({
            "status": "error",
            "output": "",
            "error": "Request body must be JSON with a 'code' field.",
        }), 400

    code = data.get("code", "")
    stdin_input = data.get("input", "")

    if not code or not code.strip():
        return jsonify({
            "status": "error",
            "output": "",
            "error": "No Lex source code provided.",
        }), 400

    if len(code) > MAX_CODE_SIZE:
        return jsonify({
            "status": "error",
            "output": "",
            "error": f"Code exceeds maximum size ({MAX_CODE_SIZE} bytes).",
        }), 400

    if len(stdin_input) > MAX_INPUT_SIZE:
        return jsonify({
            "status": "error",
            "output": "",
            "error": f"Input exceeds maximum size ({MAX_INPUT_SIZE} bytes).",
        }), 400

    request_id = uuid.uuid4().hex[:12]
    logger.info("Request %s — code=%d bytes, input=%d bytes",
                request_id, len(code), len(stdin_input))

    # ── Execute ─────────────────────────────────────────────────────────────
    try:
        result = executor.run(code, stdin_input, request_id)
        status_map = {
            "success": 200,
            "compile_error": 400,
            "runtime_error": 400,
            "error": 500,
        }
        status_code = status_map.get(result["status"], 500)
        logger.info("Request %s — status=%s", request_id, result["status"])
        return jsonify(result), status_code
    except Exception:
        logger.exception("Request %s — unexpected error", request_id)
        return jsonify({
            "status": "error",
            "output": "",
            "error": "Internal server error. Please try again.",
        }), 500


# ── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    logger.info("Starting Lex Studio backend on :%d (debug=%s)", port, debug)
    app.run(host="0.0.0.0", port=port, debug=debug)
