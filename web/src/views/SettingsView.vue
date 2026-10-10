<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";

import { useOllamaStore } from "../stores/ollama";
import { applyTheme, defaultTheme, loadTheme, saveTheme, type Theme } from "../services/theme";

const router = useRouter();
const store = useOllamaStore();
const { user, sidebarVisible } = storeToRefs(store);
const username = ref(user.value?.username ?? "");
const aboutMe = ref(user.value?.aboutMe ?? "");
const customBehavior = ref(user.value?.customBehavior ?? "");
const currentPassword = ref("");
const newPassword = ref("");
const saveError = ref("");
const saved = ref(false);
const theme = ref<Theme>(loadTheme());

function updateTheme<K extends keyof Theme>(key: K, value: string) {
  theme.value[key] = value;
  saveTheme(theme.value);
}

function resetTheme() {
  theme.value = { ...defaultTheme };
  applyTheme(theme.value);
  saveTheme(theme.value);
}

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
    saveError.value = error instanceof Error ? error.message : "Could not update account.";
  }
}
</script>

<template>
  <main
    class="min-h-screen bg-[var(--theme-background)] px-5 py-8 text-[var(--theme-text)] sm:px-10"
  >
    <section class="mx-auto max-w-2xl">
      <button
        class="mb-8 text-sm text-[var(--theme-accent)] hover:underline"
        @click="router.push('/')"
      >
        ← Back to chat
      </button>
      <div
        class="rounded-2xl border border-[#ddd8ce] bg-[var(--theme-surface)] p-7 shadow-sm sm:p-9"
      >
        <p class="font-mono text-[10px] uppercase tracking-widest text-[var(--theme-muted)]">
          Settings
        </p>
        <h1 class="mt-2 text-2xl font-bold">Account settings</h1>
        <p class="mt-2 text-sm text-[var(--theme-muted)]">Signed in as {{ user?.username }}</p>

        <div class="mt-8 divide-y divide-[#eeeae3]">
          <section class="py-6">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h2 class="text-sm font-bold">Theme</h2>
                <p class="mt-1 text-sm text-[var(--theme-muted)]">
                  Choose the exact colors used by this browser.
                </p>
              </div>
              <button
                type="button"
                class="text-xs text-[var(--theme-accent)] hover:underline"
                @click="resetTheme"
              >
                Reset
              </button>
            </div>
            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <label
                class="flex items-center justify-between gap-3 rounded-lg border border-[#ddd8ce] p-3 text-sm"
              >
                <span>Accent</span>
                <input
                  :value="theme.accent"
                  type="color"
                  aria-label="Accent color"
                  @input="updateTheme('accent', ($event.target as HTMLInputElement).value)"
                />
              </label>
              <label
                class="flex items-center justify-between gap-3 rounded-lg border border-[#ddd8ce] p-3 text-sm"
              >
                <span>Background</span>
                <input
                  :value="theme.background"
                  type="color"
                  aria-label="Background color"
                  @input="updateTheme('background', ($event.target as HTMLInputElement).value)"
                />
              </label>
              <label
                class="flex items-center justify-between gap-3 rounded-lg border border-[#ddd8ce] p-3 text-sm"
              >
                <span>Surface</span>
                <input
                  :value="theme.surface"
                  type="color"
                  aria-label="Surface color"
                  @input="updateTheme('surface', ($event.target as HTMLInputElement).value)"
                />
              </label>
              <label
                class="flex items-center justify-between gap-3 rounded-lg border border-[#ddd8ce] p-3 text-sm"
              >
                <span>Text</span>
                <input
                  :value="theme.text"
                  type="color"
                  aria-label="Text color"
                  @input="updateTheme('text', ($event.target as HTMLInputElement).value)"
                />
              </label>
            </div>
          </section>
          <label class="flex items-center justify-between gap-5 py-5 text-sm">
            <span>
              <strong class="block">Show chat sidebar</strong>
              <small class="mt-1 block text-[var(--theme-muted)]"
                >Keep your saved conversations visible beside the chat.</small
              >
            </span>
            <input
              :checked="sidebarVisible"
              type="checkbox"
              class="size-5 accent-[var(--theme-accent)]"
              @change="store.setSidebarVisible(($event.target as HTMLInputElement).checked)"
            />
          </label>
          <form class="space-y-4 py-6" @submit.prevent="saveAccount">
            <h2 class="text-sm font-bold">Profile</h2>
            <label class="block text-sm font-semibold">
              Username
              <input
                v-model="username"
                type="text"
                required
                autocomplete="username"
                class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
              />
            </label>
            <label class="block text-sm font-semibold">
              About Me
              <textarea
                v-model="aboutMe"
                rows="4"
                placeholder="Share details that help your assistant understand you."
                class="mt-2 w-full resize-y rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
              ></textarea>
            </label>
            <label class="block text-sm font-semibold">
              Custom Behavior
              <textarea
                v-model="customBehavior"
                rows="4"
                placeholder="Describe how you want the assistant to respond."
                class="mt-2 w-full resize-y rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
              ></textarea>
            </label>
            <label class="block text-sm font-semibold">
              Current password
              <input
                v-model="currentPassword"
                type="password"
                required
                autocomplete="current-password"
                class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
              />
            </label>
            <label class="block text-sm font-semibold">
              New password <span class="font-normal text-[var(--theme-muted)]">(optional)</span>
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
              Account updated.
            </p>
            <button
              type="submit"
              class="rounded-lg bg-[var(--theme-accent)] px-4 py-2.5 text-sm font-bold text-white hover:opacity-80"
            >
              Save account
            </button>
          </form>
        </div>
      </div>
    </section>
  </main>
</template>
