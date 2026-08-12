import {
  apiErrorSchema,
  authSessionResponseSchema,
  csrfHeaderName,
  forgotPasswordRequestSchema,
  forgotPasswordResponseSchema,
  loginRequestSchema,
  logoutResponseSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  resetPasswordResponseSchema,
  type AuthErrorCode,
  type AuthSessionResponse,
  type ForgotPasswordRequest,
  type ForgotPasswordResponse,
  type LoginRequest,
  type LogoutResponse,
  type RegisterRequest,
  type ResetPasswordRequest,
  type ResetPasswordResponse,
} from "@trace/shared";

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001").replace(/\/$/, "");

type ClientErrorCode = AuthErrorCode | "INVALID_RESPONSE" | "UNEXPECTED_ERROR" | "NETWORK_ERROR";

interface RequestOptions {
  signal?: AbortSignal;
}

const safeMessages: Record<ClientErrorCode, string> = {
  VALIDATION_ERROR: "Please check the highlighted fields and try again.",
  USERNAME_TAKEN: "That username is already in use.",
  EMAIL_TAKEN: "That email is already in use.",
  INVALID_CREDENTIALS: "The username or password is incorrect.",
  ACCOUNT_DISABLED: "This account is disabled. Contact support for help.",
  UNAUTHENTICATED: "Your session has expired. Please sign in again.",
  CSRF_INVALID: "Your security session is no longer valid. Please sign in again.",
  INVALID_OR_EXPIRED_RESET_TOKEN: "This reset link is invalid or has expired.",
  RATE_LIMITED: "Too many attempts. Please wait and try again.",
  SERVICE_UNAVAILABLE: "Authentication is temporarily unavailable. Please try again later.",
  INVALID_RESPONSE: "Trace received an invalid response. Please try again.",
  NETWORK_ERROR: "Trace could not reach the server. Check your connection and try again.",
  UNEXPECTED_ERROR: "Trace could not complete the request. Please try again.",
};

/** A UI-safe error normalized from the frozen API error envelope. */
export class AuthApiError extends Error {
  readonly name = "AuthApiError";

  constructor(
    public readonly code: ClientErrorCode,
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

interface ResponseSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

interface ApiRequest<T> extends RequestOptions {
  path: string;
  method: "GET" | "POST";
  responseSchema: ResponseSchema<T>;
  body?: unknown;
  headers?: Record<string, string>;
}

async function request<T>({ path, method, responseSchema, body, headers, signal }: ApiRequest<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      method,
      credentials: "include",
      headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AuthApiError("NETWORK_ERROR", safeMessages.NETWORK_ERROR, 0);
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AuthApiError("UNEXPECTED_ERROR", safeMessages.UNEXPECTED_ERROR, response.status);
    }
    const knownCode = parsed.data.code in safeMessages
      ? parsed.data.code as ClientErrorCode
      : "UNEXPECTED_ERROR";
    throw new AuthApiError(
      knownCode,
      safeMessages[knownCode],
      response.status,
      parsed.data.requestId,
      parsed.data.fieldErrors,
    );
  }

  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AuthApiError("INVALID_RESPONSE", safeMessages.INVALID_RESPONSE, response.status);
  }
  return parsed.data;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Establishes a cookie-only Trace session and returns public session state. */
export function login(input: LoginRequest, options: RequestOptions = {}): Promise<AuthSessionResponse> {
  return request({
    path: "/api/v1/auth/login",
    method: "POST",
    body: loginRequestSchema.parse(input),
    responseSchema: authSessionResponseSchema,
    ...options,
  });
}

/** Creates a Trace account and establishes its cookie-only session. */
export function register(input: RegisterRequest, options: RequestOptions = {}): Promise<AuthSessionResponse> {
  return request({
    path: "/api/v1/auth/register",
    method: "POST",
    body: registerRequestSchema.parse(input),
    responseSchema: authSessionResponseSchema,
    ...options,
  });
}

/** Bootstraps public session state from the HTTP-only session cookie. */
export function getSession(options: RequestOptions = {}): Promise<AuthSessionResponse> {
  return request({ path: "/api/v1/auth/me", method: "GET", responseSchema: authSessionResponseSchema, ...options });
}

/** Revokes the session. CSRF is sent only in the frozen canonical header. */
export function logout(csrfToken: string, options: RequestOptions = {}): Promise<LogoutResponse> {
  return request({
    path: "/api/v1/auth/logout",
    method: "POST",
    headers: { [csrfHeaderName]: csrfToken },
    responseSchema: logoutResponseSchema,
    ...options,
  });
}

/** Requests recovery with the contract's deliberately non-enumerating response. */
export function forgotPassword(input: ForgotPasswordRequest, options: RequestOptions = {}): Promise<ForgotPasswordResponse> {
  return request({
    path: "/api/v1/auth/password/forgot",
    method: "POST",
    body: forgotPasswordRequestSchema.parse(input),
    responseSchema: forgotPasswordResponseSchema,
    ...options,
  });
}

/** Consumes an opaque reset token and replaces the account password. */
export function resetPassword(input: ResetPasswordRequest, options: RequestOptions = {}): Promise<ResetPasswordResponse> {
  return request({
    path: "/api/v1/auth/password/reset",
    method: "POST",
    body: resetPasswordRequestSchema.parse(input),
    responseSchema: resetPasswordResponseSchema,
    ...options,
  });
}
