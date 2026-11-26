<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 RUN1-CS -->

<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";

import { useOllamaStore } from "@/stores/ollama";

const store = useOllamaStore();
const router = useRouter();
const { chats, activeChatId, sidebarVisible, user, comfyStatus } = storeToRefs(store);
const { createNewChat, deleteChat, renameChat, selectChat, setSidebarVisible, logout } = store;
const renameChatId = ref<number | null>(null);
const renameValue = ref("");
const deleteChatId = ref<number | null>(null);
const deleteChatName = ref("");
const deleteConfirmation = ref("");

function openRename(chat: { id: number; title: string }) {
  renameChatId.value = chat.id;
  renameValue.value = chat.title;
}

async function submitRename() {
  if (!renameChatId.value || !renameValue.value.trim()) return;
  await renameChat(renameChatId.value, renameValue.value);
  renameChatId.value = null;
}

function openDelete(chat: { id: number; title: string }) {
  deleteChatId.value = chat.id;
  deleteChatName.value = chat.title;
  deleteConfirmation.value = "";
}

async function confirmDelete() {
  if (!deleteChatId.value || deleteConfirmation.value !== deleteChatName.value) return;
  await deleteChat(deleteChatId.value);
  deleteChatId.value = null;
}

function signOut() {
  logout();
  void router.replace("/login");
}
</script>

<template>
  <aside
    v-if="sidebarVisible"
    class="hidden w-[278px] shrink-0 flex-col border-r border-[var(--theme-border)] bg-[var(--theme-sidebar)] px-[18px] py-7 md:flex"
  >
    <div class="flex items-center gap-3 px-2 pb-8">
      <img src="/amadeus.svg" :alt="$t('chat.sidebar.amadeusLogo')" class="w-48" />
      <button
        class="ml-auto bg-transparent text-2xl leading-none text-[var(--theme-muted)]"
        :aria-label="$t('chat.sidebar.collapse')"
        @click="setSidebarVisible(false)"
      >
        ‹
      </button>
    </div>

    <button
      class="flex w-full items-center gap-2.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-3.5 py-3 text-left text-xs font-bold text-[var(--theme-text)] shadow-sm transition hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]"
      @click="createNewChat"
    >
      <span class="text-lg leading-3 text-[var(--theme-accent)]">+</span>
      {{ $t("chat.newConversation") }}
    </button>

    <div class="mt-9">
      <div
        class="flex items-center justify-between px-2.5 pb-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--theme-muted)]"
      >
        <span>{{ $t("chat.sidebar.today") }}</span>
        <span class="text-[var(--theme-subtle)]">{{ chats.length }}</span>
      </div>
      <div class="space-y-1">
        <button
          v-for="chat in chats"
          :key="chat.id"
          class="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-3 text-left text-[var(--theme-text)] transition hover:bg-[var(--theme-background)]"
          :class="chat.id === activeChatId ? 'bg-[var(--theme-background)] shadow-sm' : ''"
          @click="selectChat(chat.id)"
        >
          <span class="size-1.5 shrink-0 rounded-full bg-[var(--theme-accent)]"></span>
          <span class="flex min-w-0 flex-1 flex-col gap-1">
            <strong class="truncate text-[11px]">{{ chat.title }}</strong>
            <small class="font-mono text-[9px] text-[var(--theme-subtle)]">
              {{ new Date(chat.createdAt).toLocaleDateString() }}
            </small>
          </span>
          <span
            role="button"
            tabindex="0"
            class="hidden px-1 text-xs text-[var(--theme-subtle)] hover:text-[var(--theme-accent)] group-hover:inline"
            :aria-label="$t('chat.sidebar.deleteChat')"
            @click.stop="openDelete(chat)"
            @keydown.enter.stop="openDelete(chat)"
          >
            ×
          </span>
          <span
            role="button"
            tabindex="0"
            class="hidden px-1 text-xs text-[var(--theme-subtle)] hover:text-[var(--theme-accent)] group-hover:inline"
            :aria-label="$t('chat.sidebar.renameChat')"
            @click.stop="openRename(chat)"
            @keydown.enter.stop="openRename(chat)"
          >
            ✎
          </span>
        </button>
      </div>
    </div>

    <div class="mt-auto border-t border-[var(--theme-border)] px-2 pt-4">
      <div class="flex items-center gap-2 font-mono text-[10px] text-[var(--theme-muted)]">
        <span class="size-1.5 rounded-full bg-[var(--theme-accent)]"></span>
        {{ $t("chat.sidebar.ollamaConnected") }}
      </div>
      <div class="mt-2 flex items-center gap-2 font-mono text-[10px] text-[var(--theme-muted)]">
        <span
          class="size-1.5 rounded-full"
          :class="
            comfyStatus === 'connected'
              ? 'bg-[var(--theme-accent)]'
              : comfyStatus === 'checking'
                ? 'bg-[var(--theme-subtle)]'
                : 'bg-[#c96a4a]'
          "
        ></span>
        <span>
          {{
            comfyStatus === "connected"
              ? $t("chat.sidebar.comfyConnected")
              : comfyStatus === "checking"
                ? $t("chat.sidebar.comfyChecking")
                : $t("chat.sidebar.comfyUnavailable")
          }}
        </span>
      </div>
      <div class="mt-4 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-input)] p-3">
        <div class="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            class="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--theme-background)] text-sm font-bold uppercase text-[var(--theme-accent)]"
          >
            {{ user?.username?.charAt(0) }}
          </span>
          <strong class="min-w-0 truncate text-xs text-[var(--theme-text)]">
            {{ user?.username }}
          </strong>
        </div>
      </div>
      <div
        class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--theme-subtle)]"
      >
        <button
          class="text-[var(--theme-muted)] hover:text-[var(--theme-accent)]"
          @click="router.push('/settings')"
        >
          {{ $t("chat.sidebar.settings") }}
        </button>
        <template v-if="user?.isAdmin">
          <span>·</span>
          <button
            class="text-[var(--theme-muted)] hover:text-[var(--theme-accent)]"
            @click="router.push('/admin')"
          >
            {{ $t("chat.sidebar.admin") }}
          </button>
        </template>
        <span>·</span>
        <button class="text-[var(--theme-muted)] hover:text-[var(--theme-accent)]" @click="signOut">
          {{ $t("chat.sidebar.logout") }}
        </button>
      </div>
    </div>
  </aside>

  <div
    v-if="renameChatId"
    class="fixed inset-0 z-10 grid place-items-center bg-[var(--theme-text)]/30 px-5"
  >
    <form
      class="w-full max-w-md rounded-xl bg-[var(--theme-surface)] p-6 shadow-xl"
      @submit.prevent="submitRename"
    >
      <h2 class="text-lg font-bold">{{ $t("chat.sidebar.renameTitle") }}</h2>
      <label class="mt-4 block text-sm font-semibold">
        {{ $t("chat.sidebar.chatName") }}
        <input
          v-model="renameValue"
          type="text"
          required
          class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
        />
      </label>
      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="px-3 py-2 text-sm text-[var(--theme-muted)]"
          @click="renameChatId = null"
        >
          {{ $t("chat.sidebar.cancel") }}
        </button>
        <button
          type="submit"
          class="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-bold text-white"
        >
          {{ $t("chat.sidebar.save") }}
        </button>
      </div>
    </form>
  </div>

  <div
    v-if="deleteChatId"
    class="fixed inset-0 z-10 grid place-items-center bg-[var(--theme-text)]/30 px-5"
  >
    <form
      class="w-full max-w-md rounded-xl bg-[var(--theme-surface)] p-6 shadow-xl"
      @submit.prevent="confirmDelete"
    >
      <h2 class="text-lg font-bold">{{ $t("chat.sidebar.deleteTitle") }}</h2>
      <p class="mt-2 text-sm leading-6 text-[var(--theme-muted)]">
        {{ $t("chat.sidebar.deletePromptBefore") }}
        <strong class="text-[#4d4841]">{{ deleteChatName }}</strong>
        {{ $t("chat.sidebar.deletePromptAfter") }}
      </p>
      <input
        v-model="deleteConfirmation"
        type="text"
        autocomplete="off"
        class="mt-4 w-full rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
      />
      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="px-3 py-2 text-sm text-[var(--theme-muted)]"
          @click="deleteChatId = null"
        >
          {{ $t("chat.sidebar.cancel") }}
        </button>
        <button
          type="submit"
          :disabled="deleteConfirmation !== deleteChatName"
          class="rounded-lg bg-[#a9432c] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {{ $t("chat.sidebar.deletePermanently") }}
        </button>
      </div>
    </form>
  </div>
</template>
