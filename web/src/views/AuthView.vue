<!-- Login and registration screen that authenticates users and switches modes. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";

import { useOllamaStore } from "@/stores/ollama";

const route = useRoute();
const router = useRouter();
const store = useOllamaStore();
const { authError, authLoading } = storeToRefs(store);
const username = ref("");
const password = ref("");
const confirmPassword = ref("");
const isRegister = computed(() => route.path === "/register");
const passwordMismatch = computed(
  () =>
    isRegister.value &&
    confirmPassword.value.length > 0 &&
    password.value !== confirmPassword.value,
);

// Sign the user in or create an account and then send them to the main chat.
async function submit() {
  if (passwordMismatch.value) return;

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
    class="flex min-h-screen items-center justify-center bg-[var(--theme-background)] px-5 py-10 text-[var(--theme-text)]"
  >
    <section
      class="w-full max-w-md rounded-2xl border border-[#ddd8ce] bg-[var(--theme-surface)] p-7 shadow-[0_20px_60px_rgba(122,108,91,0.12)] sm:p-9"
    >
      <div class="mb-8 flex items-center gap-3">
        <div
          class="grid size-10 place-items-center rounded-xl bg-[var(--theme-accent)] font-mono text-xl text-white"
        >
          O
        </div>
        <div>
          <p class="font-extrabold">{{ $t("auth.brand") }}</p>
          <p class="font-mono text-[10px] uppercase tracking-widest text-[#9a948b]">
            {{ $t("app.privateWorkspace") }}
          </p>
        </div>
      </div>

      <h1 class="text-2xl font-bold">
        {{ isRegister ? $t("auth.createAccount") : $t("auth.welcomeBack") }}
      </h1>
      <p class="mt-2 text-sm leading-6 text-[#81796f]">
        {{ isRegister ? $t("auth.registerDescription") : $t("auth.loginDescription") }}
      </p>

      <form class="mt-7 space-y-4" @submit.prevent="submit">
        <label class="block text-sm font-semibold">
          {{ $t("auth.username") }}
          <input
            v-model="username"
            type="text"
            autocomplete="username"
            required
            class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
          />
        </label>
        <label class="block text-sm font-semibold">
          {{ $t("auth.password") }}
          <input
            v-model="password"
            type="password"
            :autocomplete="isRegister ? 'new-password' : 'current-password'"
            minlength="8"
            required
            class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
          />
        </label>
        <label v-if="isRegister" class="block text-sm font-semibold">
          {{ $t("auth.confirmPassword") }}
          <input
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            minlength="8"
            required
            :aria-invalid="passwordMismatch"
            class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
          />
        </label>
        <p v-if="passwordMismatch" class="text-sm text-[#9e422c]" role="alert">
          {{ $t("auth.passwordsMismatch") }}
        </p>
        <p v-if="authError" class="rounded-lg bg-[#f9e4dc] px-3 py-2 text-sm text-[#9e422c]">
          {{ authError }}
        </p>
        <button
          type="submit"
          :disabled="authLoading"
          class="w-full rounded-lg bg-[var(--theme-accent)] px-4 py-3 text-sm font-bold text-white transition hover:opacity-80 disabled:cursor-wait disabled:opacity-50"
        >
          {{
            authLoading ? $t("auth.working") : isRegister ? $t("auth.register") : $t("auth.signIn")
          }}
        </button>
      </form>

      <button
        class="mt-6 w-full text-sm text-[var(--theme-accent)] hover:underline"
        @click="router.push(isRegister ? '/login' : '/register')"
      >
        {{ isRegister ? $t("auth.alreadyHaveAccount") : $t("auth.needAccount") }}
      </button>
    </section>
  </main>
</template>
