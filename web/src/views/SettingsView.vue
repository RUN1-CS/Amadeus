<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";

import { useOllamaStore } from "../stores/ollama";

const router = useRouter();
const store = useOllamaStore();
const { user, sidebarVisible } = storeToRefs(store);
const username = ref(user.value?.username ?? "");
const currentPassword = ref("");
const newPassword = ref("");
const saveError = ref("");
const saved = ref(false);

async function saveAccount() {
  saveError.value = "";
  saved.value = false;
  try {
    await store.updateAccount(username.value, currentPassword.value, newPassword.value);
    currentPassword.value = "";
    newPassword.value = "";
    saved.value = true;
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : "Could not update account.";
  }
}
</script>

<template>
  <main class="min-h-screen bg-[#f7f5f0] px-5 py-8 text-[#24221f] sm:px-10">
    <section class="mx-auto max-w-2xl">
      <button class="mb-8 text-sm text-[#a95737] hover:underline" @click="router.push('/')">
        ← Back to chat
      </button>
      <div class="rounded-2xl border border-[#ddd8ce] bg-[#fffdf9] p-7 shadow-sm sm:p-9">
        <p class="font-mono text-[10px] uppercase tracking-widest text-[#9a948b]">Settings</p>
        <h1 class="mt-2 text-2xl font-bold">Account settings</h1>
        <p class="mt-2 text-sm text-[#81796f]">Signed in as {{ user?.username }}</p>

        <div class="mt-8 divide-y divide-[#eeeae3]">
          <label class="flex items-center justify-between gap-5 py-5 text-sm">
            <span>
              <strong class="block">Show chat sidebar</strong>
              <small class="mt-1 block text-[#81796f]"
                >Keep your saved conversations visible beside the chat.</small
              >
            </span>
            <input
              :checked="sidebarVisible"
              type="checkbox"
              class="size-5 accent-[#c36b46]"
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
                class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[#f7f5f0] px-3 py-2.5 outline-none focus:border-[#c36b46]"
              />
            </label>
            <label class="block text-sm font-semibold">
              Current password
              <input
                v-model="currentPassword"
                type="password"
                required
                autocomplete="current-password"
                class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[#f7f5f0] px-3 py-2.5 outline-none focus:border-[#c36b46]"
              />
            </label>
            <label class="block text-sm font-semibold">
              New password <span class="font-normal text-[#81796f]">(optional)</span>
              <input
                v-model="newPassword"
                type="password"
                minlength="8"
                autocomplete="new-password"
                class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[#f7f5f0] px-3 py-2.5 outline-none focus:border-[#c36b46]"
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
              class="rounded-lg bg-[#c36b46] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#a95737]"
            >
              Save account
            </button>
          </form>
        </div>
      </div>
    </section>
  </main>
</template>
