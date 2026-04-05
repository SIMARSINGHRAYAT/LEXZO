"""
Sandboxed Lex Executor

Creates an isolated temp directory per request, writes the .l file,
runs flex → gcc → the binary, captures all output, and cleans up.

Security:
  - All paths are resolved and validated against the temp root.
  - subprocess calls use absolute paths with no shell expansion.
  - Execution has CPU-time + wall-clock limits via ulimit / timeout.
  - Temp directories are always deleted (even on error).
"""

import logging
import os
import platform
import resource
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Paths to toolchain binaries (configurable via env)
FLEX_BIN = os.environ.get("FLEX_BIN", "/usr/bin/flex")
GCC_BIN = os.environ.get("GCC_BIN", "/usr/bin/gcc")

IS_WINDOWS = platform.system() == "Windows"


def _set_limits(memory_mb: int, cpu_seconds: int):
    """Pre-exec function to set resource limits on Linux (no-op on Windows)."""
    if IS_WINDOWS:
        return
    try:
        mem_bytes = memory_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
        # Prevent forking
        resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))
    except (ValueError, OSError) as e:
        logger.warning("Could not set resource limits: %s", e)


class LexExecutor:
    """Compile and run Lex source code in a sandboxed temporary directory."""

    def __init__(
        self,
        temp_root: str = "/tmp/lex-workspaces",
        compile_timeout: int = 15,
        exec_timeout: int = 10,
        memory_limit_mb: int = 128,
    ):
        self.temp_root = Path(temp_root)
        self.compile_timeout = compile_timeout
        self.exec_timeout = exec_timeout
        self.memory_limit_mb = memory_limit_mb
        self.temp_root.mkdir(parents=True, exist_ok=True)

    def run(
        self,
        code: str,
        stdin_input: str = "",
        request_id: str = "unknown",
    ) -> dict:
        """
        Full pipeline: save .l → flex → gcc → execute → return result dict.

        Returns:
            {
                "status": "success" | "compile_error" | "runtime_error" | "error",
                "output": str,
                "error": str,
                "flex_output": str,
                "gcc_output": str,
            }
        """
        work_dir: Optional[Path] = None

        try:
            # ── Create isolated temp directory ──────────────────────────────
            work_dir = Path(tempfile.mkdtemp(
                prefix=f"lex_{request_id}_",
                dir=str(self.temp_root),
            ))

            scanner_path = work_dir / "scanner.l"
            c_path = work_dir / "lex.yy.c"
            bin_path = work_dir / ("scanner.exe" if IS_WINDOWS else "scanner")

            # ── Validate paths stay inside work_dir ─────────────────────────
            for p in (scanner_path, c_path, bin_path):
                if not str(p.resolve()).startswith(str(work_dir.resolve())):
                    raise SecurityError("Path traversal detected")

            # ── Write Lex source ────────────────────────────────────────────
            scanner_path.write_text(code, encoding="utf-8")
            logger.info("[%s] Wrote scanner.l (%d bytes)", request_id, len(code))

            # ── Step 1: flex scanner.l ──────────────────────────────────────
            flex_result = self._exec(
                [FLEX_BIN, str(scanner_path)],
                cwd=str(work_dir),
                timeout=self.compile_timeout,
                label="flex",
                request_id=request_id,
            )

            if flex_result.returncode != 0:
                error_msg = flex_result.stderr.strip() or "flex failed with no error message"
                logger.warning("[%s] flex failed: %s", request_id, error_msg)
                return {
                    "status": "compile_error",
                    "output": "",
                    "error": error_msg,
                    "flex_output": error_msg,
                    "gcc_output": "",
                }

            if not c_path.exists():
                return {
                    "status": "compile_error",
                    "output": "",
                    "error": "flex did not produce lex.yy.c",
                    "flex_output": flex_result.stderr,
                    "gcc_output": "",
                }

            # ── Step 2: gcc lex.yy.c -o scanner -lfl ───────────────────────
            gcc_cmd = [
                GCC_BIN,
                str(c_path),
                "-o", str(bin_path),
                "-lfl",
            ]

            gcc_result = self._exec(
                gcc_cmd,
                cwd=str(work_dir),
                timeout=self.compile_timeout,
                label="gcc",
                request_id=request_id,
            )

            # If -lfl fails (no libfl), retry without it (user must provide yywrap)
            if gcc_result.returncode != 0:
                gcc_cmd_nolfl = [
                    GCC_BIN,
                    str(c_path),
                    "-o", str(bin_path),
                ]
                gcc_result2 = self._exec(
                    gcc_cmd_nolfl,
                    cwd=str(work_dir),
                    timeout=self.compile_timeout,
                    label="gcc (no -lfl)",
                    request_id=request_id,
                )
                if gcc_result2.returncode != 0:
                    error_msg = gcc_result.stderr.strip() or gcc_result2.stderr.strip() or "gcc compilation failed"
                    logger.warning("[%s] gcc failed: %s", request_id, error_msg)
                    return {
                        "status": "compile_error",
                        "output": "",
                        "error": error_msg,
                        "flex_output": flex_result.stderr,
                        "gcc_output": error_msg,
                    }

            if not bin_path.exists():
                return {
                    "status": "compile_error",
                    "output": "",
                    "error": "gcc did not produce the executable",
                    "flex_output": flex_result.stderr,
                    "gcc_output": gcc_result.stderr,
                }

            # ── Step 3: Execute the compiled scanner ────────────────────────
            # Make executable
            if not IS_WINDOWS:
                bin_path.chmod(0o755)

            run_result = self._exec(
                [str(bin_path)],
                cwd=str(work_dir),
                timeout=self.exec_timeout,
                label="run",
                request_id=request_id,
                stdin_data=stdin_input,
                apply_limits=True,
            )

            output = run_result.stdout
            error = run_result.stderr.strip()

            if run_result.returncode != 0 and error:
                logger.info("[%s] Runtime error (rc=%d): %s",
                            request_id, run_result.returncode, error[:200])
                return {
                    "status": "runtime_error",
                    "output": output,
                    "error": error,
                    "flex_output": flex_result.stderr,
                    "gcc_output": gcc_result.stderr if gcc_result else "",
                }

            logger.info("[%s] Success — output=%d bytes", request_id, len(output))
            return {
                "status": "success",
                "output": output,
                "error": error,
                "flex_output": flex_result.stderr,
                "gcc_output": gcc_result.stderr if gcc_result else "",
            }

        except subprocess.TimeoutExpired:
            logger.warning("[%s] Execution timed out", request_id)
            return {
                "status": "runtime_error",
                "output": "",
                "error": f"Execution timed out after {self.exec_timeout} seconds.",
                "flex_output": "",
                "gcc_output": "",
            }

        except SecurityError as e:
            logger.error("[%s] Security violation: %s", request_id, e)
            return {
                "status": "error",
                "output": "",
                "error": "Security violation detected.",
                "flex_output": "",
                "gcc_output": "",
            }

        except Exception as e:
            logger.exception("[%s] Unexpected error", request_id)
            return {
                "status": "error",
                "output": "",
                "error": str(e),
                "flex_output": "",
                "gcc_output": "",
            }

        finally:
            # ── Always clean up ─────────────────────────────────────────────
            if work_dir and work_dir.exists():
                try:
                    shutil.rmtree(str(work_dir))
                    logger.info("[%s] Cleaned up %s", request_id, work_dir)
                except OSError:
                    logger.warning("[%s] Failed to clean up %s", request_id, work_dir)

    def _exec(
        self,
        cmd: list[str],
        cwd: str,
        timeout: int,
        label: str,
        request_id: str,
        stdin_data: str = "",
        apply_limits: bool = False,
    ) -> subprocess.CompletedProcess:
        """Run a subprocess with timeout and optional resource limits."""
        logger.info("[%s] Running %s: %s", request_id, label, " ".join(cmd))

        preexec = None
        if apply_limits and not IS_WINDOWS:
            preexec = lambda: _set_limits(self.memory_limit_mb, self.exec_timeout)

        return subprocess.run(
            cmd,
            cwd=cwd,
            input=stdin_data,
            capture_output=True,
            text=True,
            timeout=timeout,
            preexec_fn=preexec,
            # Never use shell=True
        )


class SecurityError(Exception):
    """Raised when a path traversal or sandboxing violation is detected."""
    pass
