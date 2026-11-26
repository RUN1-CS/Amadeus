// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// localStorage keys and the persisted composer options.
export const tokenStorageKey = "amadeus_token";
export const sidebarStorageKey = "amadeus_sidebar";
export const selectedModelStorageKey = "amadeus_selected_model";
export const selectedComfyModelStorageKey = "amadeus_selected_comfy_model";
export const selectedOptionsStorageKey = "amadeus_selected_options";

export type SelectedOptions = {
  tsundere: boolean;
  thinking: boolean;
  streaming: boolean;
};

export const defaultSelectedOptions: SelectedOptions = {
  tsundere: false,
  thinking: false,
  streaming: true,
};

export function loadSelectedOptions(): SelectedOptions {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(selectedOptionsStorageKey) ?? "null");
    if (!stored || typeof stored !== "object") return { ...defaultSelectedOptions };

    const options = stored as Partial<SelectedOptions>;
    return {
      tsundere:
        typeof options.tsundere === "boolean" ? options.tsundere : defaultSelectedOptions.tsundere,
      thinking:
        typeof options.thinking === "boolean" ? options.thinking : defaultSelectedOptions.thinking,
      streaming:
        typeof options.streaming === "boolean"
          ? options.streaming
          : defaultSelectedOptions.streaming,
    };
  } catch {
    return { ...defaultSelectedOptions };
  }
}
