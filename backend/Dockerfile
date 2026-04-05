# ── Stage: Backend ───────────────────────────────────────────────────────────
FROM python:3.12-slim AS backend

# Install Flex, Bison, GCC, build-essential
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        flex \
        bison \
        gcc \
        build-essential \
        libfl-dev \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for running user code
RUN useradd --create-home --shell /bin/bash lexrunner

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY app.py executor.py ./

# Create temp workspace directory
RUN mkdir -p /tmp/lex-workspaces && \
    chown lexrunner:lexrunner /tmp/lex-workspaces

# Environment
ENV FLASK_DEBUG=0 \
    PORT=10000 \
    LEX_TEMP_DIR=/tmp/lex-workspaces \
    LEX_EXEC_TIMEOUT=10 \
    LEX_COMPILE_TIMEOUT=15 \
    LEX_MEMORY_LIMIT_MB=128

EXPOSE 10000

# PORT=10000 is the Render default; docker-compose overrides to 5000.
# Shell form so $PORT is expanded at runtime.
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT} --workers 4 --timeout 30 --access-logfile - --error-logfile - app:app"]
