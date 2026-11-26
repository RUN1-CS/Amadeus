// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

import { LocalizedError } from "./localizedError.js";

// An error that carries the HTTP status and localization key the client should see.
export class HttpError extends LocalizedError {
  status: number;

  constructor(
    status: number,
    localizationCode: string,
    message: string,
    localizationParams?: Record<string, string | number>,
  ) {
    super(localizationCode, message, localizationParams);
    this.status = status;
  }
}
