/**
 * Lex Studio — Backend API Client
 *
 * Sends Lex source code to the Flask backend for compilation with
 * real Flex + GCC and returns the structured result.
 */

export interface LexApiResponse {
  status: 'success' | 'compile_error' | 'runtime_error' | 'error';
  output: string;
  error: string;
  flex_output?: string;
  gcc_output?: string;
}

/**
 * Auto-detect the backend URL:
 *  - Render / production: VITE_API_URL = https://lex-studio-api.onrender.com
 *  - Docker (nginx proxy): VITE_API_URL = /api
 *  - Local dev:            fallback to http://localhost:5000
 */
function getBackendUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) {
    // Strip trailing slash for consistent concatenation
    return envUrl.replace(/\/+$/, '');
  }
  // Development default — Flask on port 5000
  return 'http://localhost:5000';
}

const BASE_URL = getBackendUrl();

/**
 * Send Lex code to the backend, compile with flex+gcc, and run.
 */
export async function runLexOnServer(
  code: string,
  input: string = '',
): Promise<LexApiResponse> {
  const response = await fetch(`${BASE_URL}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, input }),
  });

  if (!response.ok) {
    const text = await response.text();
    let parsed: LexApiResponse;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {
        status: 'error',
        output: '',
        error: `Server error (HTTP ${response.status}): ${text.slice(0, 200)}`,
      };
    }
    return validateLexApiResponse(parsed);
  }

  const json = await response.json();
  return validateLexApiResponse(json);
}

/**
 * Validate that a response object conforms to the LexApiResponse shape.
 */
function validateLexApiResponse(data: unknown): LexApiResponse {
  if (
    typeof data === 'object' && data !== null &&
    'status' in data && 'output' in data && 'error' in data &&
    typeof (data as LexApiResponse).status === 'string' &&
    typeof (data as LexApiResponse).output === 'string' &&
    typeof (data as LexApiResponse).error === 'string'
  ) {
    return data as LexApiResponse;
  }
  return {
    status: 'error',
    output: '',
    error: 'Unexpected response format from server.',
  };
}

/**
 * Check if the backend is reachable.
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const resp = await fetch(`${BASE_URL}/health`, { method: 'GET' });
    return resp.ok;
  } catch {
    return false;
  }
}
