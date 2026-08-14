export interface CliErrorPayload {
  readonly failureType: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export class CliError extends Error {
  public readonly payload: CliErrorPayload;

  public constructor(payload: CliErrorPayload, options?: ErrorOptions) {
    super(payload.message, options);
    this.name = "CliError";
    this.payload = payload;
  }
}

export function toCliErrorPayload(error: unknown): CliErrorPayload {
  if (error instanceof CliError) {
    return error.payload;
  }

  if (error instanceof Error) {
    const failureType = "failureType" in error && typeof error.failureType === "string"
      ? error.failureType
      : "UNEXPECTED_ERROR";
    return {
      failureType,
      message: error.message
    };
  }

  return {
    failureType: "UNEXPECTED_ERROR",
    message: "An unknown error occurred"
  };
}
