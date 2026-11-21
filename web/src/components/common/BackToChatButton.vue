<script setup lang="ts">
import { useRouter } from "vue-router";

const router = useRouter();
</script>

<template>
  <button
    class="mb-8 text-sm text-[var(--theme-accent)] hover:underline"
    @click="router.push('/')"
  >
    ← Back to chat
  </button>
</template>
