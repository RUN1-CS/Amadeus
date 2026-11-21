<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";

import { useOllamaStore } from "@/stores/ollama";

const store = useOllamaStore();
const router = useRouter();
const { chats, activeChatId, sidebarVisible, user } = storeToRefs(store);
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
</script>

<template>
  <aside
    v-if="sidebarVisible"
    class="hidden w-[278px] shrink-0 flex-col border-r border-[var(--theme-border)] bg-[var(--theme-sidebar)] px-[18px] py-7 md:flex"
  >
    <div class="flex items-center gap-3 px-2 pb-8">
      <div
        class="grid size-8 place-items-center rounded-lg bg-[var(--theme-accent)] font-mono text-lg font-medium text-[#f9f7f2]"
      >
        O
      </div>
      <div>
        <p class="text-[13px] font-extrabold">Ollama desk</p>
        <p class="mt-1 font-mono text-[10px] uppercase tracking-[0.09em] text-[var(--theme-muted)]">
          Local intelligence
        </p>
      </div>
      <button
        class="ml-auto bg-transparent text-2xl leading-none text-[var(--theme-muted)]"
        aria-label="Collapse sidebar"
        @click="setSidebarVisible(false)"
      >
        ‹
      </button>
    </div>

    <button
      class="flex w-full items-center gap-2.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-3.5 py-3 text-left text-xs font-bold text-[var(--theme-text)] shadow-sm transition hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]"
      @click="createNewChat"
    >
      <span class="text-lg leading-3 text-[var(--theme-accent)]">+</span> New conversation
    </button>

    <div class="mt-9">
      <div
        class="flex items-center justify-between px-2.5 pb-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--theme-muted)]"
      >
        <span>Today</span>
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
            aria-label="Delete chat"
            @click.stop="openDelete(chat)"
            @keydown.enter.stop="openDelete(chat)"
          >
            ×
          </span>
          <span
            role="button"
            tabindex="0"
            class="hidden px-1 text-xs text-[var(--theme-subtle)] hover:text-[var(--theme-accent)] group-hover:inline"
            aria-label="Rename chat"
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
        <span class="size-1.5 rounded-full bg-[var(--theme-accent)]"></span> Ollama connected
      </div>
      <div class="mt-4 flex gap-2 text-[10px] text-[var(--theme-subtle)]">
        <span class="max-w-[130px] truncate text-[var(--theme-muted)]">{{ user?.username }}</span>
        <span>·</span>
        <button
          class="text-[var(--theme-muted)] hover:text-[var(--theme-accent)]"
          @click="router.push('/settings')"
        >
          Settings
        </button>
        <span>·</span>
        <button class="text-[var(--theme-muted)] hover:text-[var(--theme-accent)]" @click="logout">
          Log out
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
      <h2 class="text-lg font-bold">Rename chat</h2>
      <label class="mt-4 block text-sm font-semibold">
        Chat name
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
          Cancel
        </button>
        <button
          type="submit"
          class="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-bold text-white"
        >
          Save
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
      <h2 class="text-lg font-bold">Delete chat?</h2>
      <p class="mt-2 text-sm leading-6 text-[var(--theme-muted)]">
        Type <strong class="text-[#4d4841]">{{ deleteChatName }}</strong> to permanently delete this
        conversation.
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
          Cancel
        </button>
        <button
          type="submit"
          :disabled="deleteConfirmation !== deleteChatName"
          class="rounded-lg bg-[#a9432c] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Delete permanently
        </button>
      </div>
    </form>
  </div>
</template>
