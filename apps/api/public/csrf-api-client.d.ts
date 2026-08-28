export interface CsrfApiRequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly csrf?: boolean;
}

export interface CsrfApiClientInput {
  readonly path: string;
  readonly options?: CsrfApiRequestOptions;
  readonly csrfToken: string | null;
  readonly fetchImpl: typeof fetch;
  readonly refreshCsrfToken: () => Promise<string>;
}

export function requestJsonWithCsrfRecovery<T = unknown>(
  input: CsrfApiClientInput,
): Promise<T>;
