export function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "An unexpected server error occurred.";
}
