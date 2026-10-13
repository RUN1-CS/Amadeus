// Small helper that turns thrown values into user-safe server errors.
// Convert thrown values into a compact, readable server error string.
export function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "An unexpected server error occurred.";
}
