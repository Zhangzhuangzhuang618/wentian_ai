export async function requestJsonWithCsrfRecovery(input) {
  const options = input.options ?? {};
  const method = (options.method ?? "GET").toUpperCase();
  const requiresCsrf =
    options.csrf !== false && method !== "GET" && method !== "HEAD";

  return attempt(input.csrfToken, false);

  async function attempt(csrfToken, retried) {
    const headers = { accept: "application/json" };
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (requiresCsrf) {
      if (!csrfToken) throw apiError("LOCAL_SESSION_INVALID");
      headers["x-wentian-csrf-token"] = csrfToken;
    }
    const response = await input.fetchImpl(input.path, {
      method,
      headers,
      credentials: "same-origin",
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const body = await response
      .json()
      .catch(() => ({ error: "INVALID_SERVER_RESPONSE" }));
    if (
      !response.ok &&
      body.error === "CSRF_TOKEN_INVALID" &&
      requiresCsrf &&
      !retried
    ) {
      const refreshedToken = await input.refreshCsrfToken();
      return attempt(refreshedToken, true);
    }
    if (!response.ok) {
      throw apiError(body.error ?? `HTTP_${response.status}`);
    }
    return body;
  }
}

function apiError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
