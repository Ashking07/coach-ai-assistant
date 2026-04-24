export class LlmOutputError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmOutputError';
  }
}
