<!-- Settings page for profile data, theme colors, and account updates. -->
<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";

import BackToChatButton from "@/components/common/BackToChatButton.vue";
import LanguageSelector from "@/components/common/LanguageSelector.vue";
import { useOllamaStore } from "../stores/ollama";
import { applyTheme, defaultTheme, loadTheme, saveTheme, type Theme } from "@/services/theme";

const router = useRouter();
const { t } = useI18n();
const store = useOllamaStore();
const { user, sidebarVisible } = storeToRefs(store);
const username = ref(user.value?.username ?? "");
const aboutMe = ref(user.value?.aboutMe ?? "");
const customBehavior = ref(user.value?.customBehavior ?? "");
const currentPassword = ref("");
const newPassword = ref("");
const saveError = ref("");
const saved = ref(false);
const deletePassword = ref("");
const deleteError = ref("");
const deleting = ref(false);
const theme = ref<Theme>(loadTheme());

// Update one color slot and save it immediately for the next browser session.
function updateTheme<K extends keyof Theme>(key: K, value: string) {
  theme.value[key] = value;
  saveTheme(theme.value);
}

// Restore the default palette and persist it to local storage.
function resetTheme() {
  theme.value = { ...defaultTheme };
  applyTheme(theme.value);
  saveTheme(theme.value);
}

// Save profile details and password changes after the current password is validated.
async function saveAccount() {
  saveError.value = "";
  saved.value = false;
  try {
    await store.updateAccount(
      username.value,
      currentPassword.value,
      newPassword.value,
      aboutMe.value,
      customBehavior.value,
    );
    currentPassword.value = "";
    newPassword.value = "";
    saved.value = true;
    window.location.reload();
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : t("settings.updateFailed");
  }
}

async function deleteAccount() {
  deleteError.value = "";
  if (!window.confirm(t("settings.deleteAccountConfirmation"))) {
    return;
  }

  deleting.value = true;
  try {
    await store.deleteCurrentAccount(deletePassword.value);
    await router.replace("/auth");
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : t("settings.deleteFailed");
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <main
    class="min-h-screen bg-[var(--theme-background)] px-5 py-8 text-[var(--theme-text)] sm:px-10"
  >
    <section class="mx-auto max-w-2xl">
      <BackToChatButton />
      <div
        class="rounded-2xl border border-[#ddd8ce] bg-[var(--theme-surface)] p-7 shadow-sm sm:p-9"
      >
        <p class="font-mono text-[10px] uppercase tracking-widest text-[var(--theme-muted)]">
          {{ $t("settings.settings") }}
        </p>
        <h1 class="mt-2 text-2xl font-bold">{{ $t("settings.accountSettings") }}</h1>
        <p class="mt-2 text-sm text-[var(--theme-muted)]">
          {{ $t("settings.signedInAs", { username: user?.username }) }}
        </p>

        <div class="mt-8 divide-y divide-[#eeeae3] items-center">
          <section class="py-6">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h2 class="text-sm font-bold">{{ $t("settings.theme") }}</h2>
                <p class="mt-1 text-sm text-[var(--theme-muted)]">
                  {{ $t("settings.chooseColors") }}
                </p>
              </div>
              <button
                type="button"
                class="text-xs text-[var(--theme-accent)] hover:underline"
                @click="resetTheme"
              >
                {{ $t("settings.reset") }}
              </button>
            </div>
            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <label
                class="flex items-center justify-between gap-3 rounded-lg border border-[#ddd8ce] p-3 text-sm"
              >
                <span>{{ $t("settings.accent") }}</span>
                <input
                  :value="theme.accent"
                  type="color"
                  :aria-label="$t('settings.accentColor')"
                  @input="updateTheme('accent', ($event.target as HTMLInputElement).value)"
                />
              </label>
              <label
                class="flex items-center justify-between gap-3 rounded-lg border border-[#ddd8ce] p-3 text-sm"
              >
                <span>{{ $t("settings.background") }}</span>
                <input
                  :value="theme.background"
                  type="color"
                  :aria-label="$t('settings.backgroundColor')"
                  @input="updateTheme('background', ($event.target as HTMLInputElement).value)"
                />
              </label>
              <label
                class="flex items-center justify-between gap-3 rounded-lg border border-[#ddd8ce] p-3 text-sm"
              >
                <span>{{ $t("settings.surface") }}</span>
                <input
                  :value="theme.surface"
                  type="color"
                  :aria-label="$t('settings.surfaceColor')"
                  @input="updateTheme('surface', ($event.target as HTMLInputElement).value)"
                />
              </label>
              <label
                class="flex items-center justify-between gap-3 rounded-lg border border-[#ddd8ce] p-3 text-sm"
              >
                <span>{{ $t("settings.text") }}</span>
                <input
                  :value="theme.text"
                  type="color"
                  :aria-label="$t('settings.textColor')"
                  @input="updateTheme('text', ($event.target as HTMLInputElement).value)"
                />
              </label>
            </div>
          </section>
          <LanguageSelector />
          <label class="flex items-center justify-between gap-5 py-5 text-sm">
            <span>
              <strong class="block">{{ $t("settings.showSidebar") }}</strong>
              <small class="mt-1 block text-[var(--theme-muted)]">{{
                $t("settings.sidebarDescription")
              }}</small>
            </span>
            <input
              :checked="sidebarVisible"
              type="checkbox"
              class="size-5 accent-[var(--theme-accent)]"
              @change="store.setSidebarVisible(($event.target as HTMLInputElement).checked)"
            />
          </label>
          <form class="space-y-4 py-6" @submit.prevent="saveAccount">
            <h2 class="text-sm font-bold">{{ $t("settings.profile") }}</h2>
            <label class="block text-sm font-semibold">
              {{ $t("auth.username") }}
              <input
                v-model="username"
                type="text"
                required
                autocomplete="username"
                class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
              />
            </label>
            <label class="block text-sm font-semibold">
              {{ $t("settings.aboutMe") }}
              <textarea
                v-model="aboutMe"
                rows="4"
                :placeholder="$t('settings.aboutMePlaceholder')"
                class="mt-2 w-full resize-y rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
              ></textarea>
            </label>
            <label class="block text-sm font-semibold">
              {{ $t("settings.customBehavior") }}
              <textarea
                v-model="customBehavior"
                rows="4"
                :placeholder="$t('settings.customBehaviorPlaceholder')"
                class="mt-2 w-full resize-y rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
              ></textarea>
            </label>
            <label class="block text-sm font-semibold">
              {{ $t("settings.currentPassword") }}
              <input
                v-model="currentPassword"
                type="password"
                required
                autocomplete="current-password"
                class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
              />
            </label>
            <label class="block text-sm font-semibold">
              {{ $t("settings.newPassword") }}
              <span class="font-normal text-[var(--theme-muted)]">{{
                $t("settings.optional")
              }}</span>
              <input
                v-model="newPassword"
                type="password"
                minlength="8"
                autocomplete="new-password"
                class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
              />
            </label>
            <p v-if="saveError" class="rounded-lg bg-[#f9e4dc] px-3 py-2 text-sm text-[#9e422c]">
              {{ saveError }}
            </p>
            <p v-if="saved" class="rounded-lg bg-[#e4f0df] px-3 py-2 text-sm text-[#47723e]">
              {{ $t("settings.accountUpdated") }}
            </p>
            <div class="flex flex-col items-center gap-3">
              <button
                type="submit"
                class="rounded-lg bg-[var(--theme-accent)] px-4 py-2.5 text-sm font-bold text-white hover:opacity-80"
              >
                {{ $t("settings.saveAccount") }}
              </button>
              <button
                type="button"
                class="text-[var(--theme-muted)] hover:text-[var(--theme-accent)]"
                @click="router.push('/memory')"
              >
                {{ $t("settings.memorySettings") }}
              </button>
            </div>
          </form>

          <section class="border-t border-[#eeeae3] py-6">
            <h2 class="text-sm font-bold text-[#853c2a]">{{ $t("settings.deleteAccount") }}</h2>
            <p class="mt-1 text-sm text-[var(--theme-muted)]">
              {{ $t("settings.deleteAccountDescription") }}
            </p>
            <label class="mt-4 block text-sm font-semibold">
              {{ $t("settings.currentPassword") }}
              <input
                v-model="deletePassword"
                type="password"
                required
                autocomplete="current-password"
                class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
              />
            </label>
            <p v-if="deleteError" role="alert" class="mt-3 text-sm text-[#853c2a]">
              {{ deleteError }}
            </p>
            <div class="mt-4 flex justify-center">
              <button
                type="button"
                class="rounded-lg border border-[#e7b6a4] px-4 py-2.5 text-sm font-bold text-[#853c2a] hover:bg-[#f9e4dc] disabled:opacity-50"
                :disabled="deleting || !deletePassword"
                @click="deleteAccount"
              >
                {{ deleting ? $t("settings.deleting") : $t("settings.permanentlyDeleteAccount") }}
              </button>
            </div>
          </section>
        </div>
      </div>
    </section>
  </main>
</template>
