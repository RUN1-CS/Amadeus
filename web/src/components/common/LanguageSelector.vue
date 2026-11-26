<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 RUN1-CS -->

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { finalAvailableLanguages } from "@/i18n";

const { locale } = useI18n({ useScope: "global" });

function saveLanguage(event: Event): void {
  const selectedLanguage = (event.target as HTMLSelectElement).value;

  locale.value = selectedLanguage;
  localStorage.setItem("amadeus_locale", selectedLanguage);
}
</script>

<template>
  <label class="flex items-center justify-between gap-5 py-5 text-sm">
    <span>
      <strong class="block">{{ $t("settings.language") }}</strong>
      <small class="mt-1 block text-[var(--theme-muted)]">
        {{ $t("settings.languageDescription") }}
      </small>
    </span>

    <select
      :value="locale"
      class="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-background)] px-3 py-2 text-sm text-[var(--theme-text)]"
      :aria-label="$t('settings.language')"
      @change="saveLanguage"
    >
      <option
        v-for="language in finalAvailableLanguages"
        :key="language.code"
        :value="language.code"
      >
        {{ language.name }}
      </option>
    </select>
  </label>
</template>
