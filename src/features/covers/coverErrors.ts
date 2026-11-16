/** A temporary failure (offline, refused, rate-limited, server error): try again later; never stored as "no photo". */
export class CoverLookupError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}
