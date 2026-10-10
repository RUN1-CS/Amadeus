<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";

import { useOllamaStore } from "../stores/ollama";

const route = useRoute();
const router = useRouter();
const store = useOllamaStore();
const { authError, authLoading } = storeToRefs(store);
const username = ref("");
const password = ref("");
const isRegister = computed(() => route.path === "/register");

async function submit() {
  try {
    if (isRegister.value) await store.registerUser(username.value, password.value);
    else await store.loginUser(username.value, password.value);
    await router.push("/");
  } catch {
    // The store exposes the request error to the form.
  }
}
</script>

<template>
  <main
    class="flex min-h-screen items-center justify-center bg-[#f7f5f0] px-5 py-10 text-[#24221f]"
  >
    <section
      class="w-full max-w-md rounded-2xl border border-[#ddd8ce] bg-[#fffdf9] p-7 shadow-[0_20px_60px_rgba(122,108,91,0.12)] sm:p-9"
    >
      <div class="mb-8 flex items-center gap-3">
        <div
          class="grid size-10 place-items-center rounded-xl bg-[#c36b46] font-mono text-xl text-white"
        >
          O
        </div>
        <div>
          <p class="font-extrabold">Ollama desk</p>
          <p class="font-mono text-[10px] uppercase tracking-widest text-[#9a948b]">
            Private workspace
          </p>
        </div>
      </div>

      <h1 class="text-2xl font-bold">{{ isRegister ? "Create your account" : "Welcome back" }}</h1>
      <p class="mt-2 text-sm leading-6 text-[#81796f]">
        {{
          isRegister
            ? "Save your conversations and pick them up anywhere."
            : "Sign in to load your saved conversations."
        }}
      </p>

      <form class="mt-7 space-y-4" @submit.prevent="submit">
        <label class="block text-sm font-semibold">
          Username
          <input
            v-model="username"
            type="text"
            autocomplete="username"
            required
            class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[#f7f5f0] px-3 py-2.5 outline-none focus:border-[#c36b46]"
          />
        </label>
        <label class="block text-sm font-semibold">
          Password
          <input
            v-model="password"
            type="password"
            :autocomplete="isRegister ? 'new-password' : 'current-password'"
            minlength="8"
            required
            class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[#f7f5f0] px-3 py-2.5 outline-none focus:border-[#c36b46]"
          />
        </label>
        <p v-if="authError" class="rounded-lg bg-[#f9e4dc] px-3 py-2 text-sm text-[#9e422c]">
          {{ authError }}
        </p>
        <button
          type="submit"
          :disabled="authLoading"
          class="w-full rounded-lg bg-[#c36b46] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#a95737] disabled:cursor-wait disabled:opacity-50"
        >
          {{ authLoading ? "Working..." : isRegister ? "Register" : "Sign in" }}
        </button>
      </form>

      <button
        class="mt-6 w-full text-sm text-[#a95737] hover:underline"
        @click="router.push(isRegister ? '/login' : '/register')"
      >
        {{ isRegister ? "Already have an account? Sign in" : "Need an account? Register" }}
      </button>
    </section>
  </main>
</template>
