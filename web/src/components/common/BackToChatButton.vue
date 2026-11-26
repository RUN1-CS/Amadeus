<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 RUN1-CS -->

<script setup lang="ts">
import { useRouter } from "vue-router";

const router = useRouter();
</script>

<template>
  <button class="mb-8 text-sm text-[var(--theme-accent)] hover:underline" @click="router.push('/')">
    {{ $t("common.backToChat") }}
  </button>
</template>
