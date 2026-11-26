// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

import i18n from "@/i18n";

export type ServerErrorPayload = {
  error?: string;
  localizationCode?: string;
  localizationParams?: Record<string, string | number>;
};

export function localizeServerError(payload: ServerErrorPayload, fallback?: string) {
  const key = payload.localizationCode
    ? `serverErrors.${payload.localizationCode}`
    : "";
  if (key && i18n.global.te(key)) {
    return i18n.global.t(key, payload.localizationParams ?? {});
  }
  return payload.error ?? fallback ?? i18n.global.t("api.requestFailed");
}

export function createServerError(payload: ServerErrorPayload, fallback?: string) {
  return new Error(localizeServerError(payload, fallback));
}
