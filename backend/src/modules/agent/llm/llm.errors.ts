export class LlmOutputError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
    readonly rawText?: string,
  ) {
    super(message);
    this.name = 'LlmOutputError';
  }
}
