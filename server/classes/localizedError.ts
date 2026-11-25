export class LocalizedError extends Error {
  localizationCode: string;
  localizationParams?: Record<string, string | number>;

  constructor(
    localizationCode: string,
    message: string,
    localizationParams?: Record<string, string | number>,
  ) {
    super(message);
    this.localizationCode = localizationCode;
    this.localizationParams = localizationParams;
  }
}
