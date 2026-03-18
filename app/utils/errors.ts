export class AppError extends Error {
  public readonly retryable: boolean;
  public readonly statusCode: number;

  constructor(
    message: string,
    options: { retryable?: boolean; statusCode?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode ?? 500;
  }
}

export class DownloadError extends AppError {
  constructor(message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, { retryable: options.retryable ?? true, statusCode: 502, cause: options.cause });
    this.name = "DownloadError";
  }
}

export class TranscriptionError extends AppError {
  constructor(message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, { retryable: options.retryable ?? true, statusCode: 502, cause: options.cause });
    this.name = "TranscriptionError";
  }
}

export class TranslationError extends AppError {
  constructor(message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, { retryable: options.retryable ?? true, statusCode: 502, cause: options.cause });
    this.name = "TranslationError";
  }
}

export class TTSError extends AppError {
  constructor(message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, { retryable: options.retryable ?? true, statusCode: 502, cause: options.cause });
    this.name = "TTSError";
  }
}

export class ProcessingError extends AppError {
  constructor(message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, { retryable: options.retryable ?? false, statusCode: 500, cause: options.cause });
    this.name = "ProcessingError";
  }
}

export class StorageError extends AppError {
  constructor(message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, { retryable: options.retryable ?? true, statusCode: 502, cause: options.cause });
    this.name = "StorageError";
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication required") {
    super(message, { retryable: false, statusCode: 401 });
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "Insufficient permissions") {
    super(message, { retryable: false, statusCode: 403 });
    this.name = "AuthorizationError";
  }
}

export class ValidationError extends AppError {
  public readonly fieldErrors: Record<string, string[]>;

  constructor(message: string, fieldErrors: Record<string, string[]> = {}) {
    super(message, { retryable: false, statusCode: 400 });
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} with ID "${id}" not found` : `${resource} not found`, {
      retryable: false,
      statusCode: 404,
    });
    this.name = "NotFoundError";
  }
}
