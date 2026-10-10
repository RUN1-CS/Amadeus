<script setup lang="ts">
import { computed, nextTick, ref, watch, watchEffect } from "vue";
import { storeToRefs } from "pinia";
import { useRoute, useRouter } from "vue-router";

import { useOllamaStore } from "./stores/ollama";

const ollamaStore = useOllamaStore();
const route = useRoute();
const router = useRouter();
const {
  user,
  authLoading,
  draft,
  isGenerating,
  messageList,
  tsundere,
  thinking,
  streaming,
  chats,
  activeChatId,
  sidebarVisible,
} = storeToRefs(ollamaStore);
const {
  selectPrompt,
  sendMessage,
  initializeAuth,
  createNewChat,
  deleteChat,
  renameChat,
  selectChat,
  setSidebarVisible,
  logout,
} = ollamaStore;

const activeChat = computed(() => chats.value.find((chat) => chat.id === activeChatId.value));
const chatScroll = ref<HTMLElement | null>(null);
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

async function scrollToLatest() {
  await nextTick();
  if (chatScroll.value) chatScroll.value.scrollTop = chatScroll.value.scrollHeight;
}

watch(messageList, () => void scrollToLatest(), { deep: true, flush: "post" });

void initializeAuth();
watchEffect(() => {
  if (authLoading.value) return;
  if (!user.value && route.path !== "/login" && route.path !== "/register") {
    void router.replace("/login");
  }
  if (user.value && (route.path === "/login" || route.path === "/register")) {
    void router.replace("/");
  }
});

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendMessage();
  }
}
</script>
<template>
  <RouterView v-if="route.path !== '/'" />
  <main v-else-if="user" class="flex h-screen overflow-hidden bg-[#f7f5f0] text-[#24221f]">
    <aside
      v-if="sidebarVisible"
      class="hidden w-[278px] shrink-0 flex-col border-r border-[#ddd8ce] bg-[#ebe8e1] px-[18px] py-7 md:flex"
    >
      <div class="flex items-center gap-3 px-2 pb-8">
        <div
          class="grid size-8 place-items-center rounded-lg bg-[#c36b46] font-mono text-lg font-medium text-[#f9f7f2]"
        >
          O
        </div>
        <div>
          <p class="text-[13px] font-extrabold">Ollama desk</p>
          <p class="mt-1 font-mono text-[10px] uppercase tracking-[0.09em] text-[#888177]">
            Local intelligence
          </p>
        </div>
        <button
          class="ml-auto bg-transparent text-2xl leading-none text-[#8b867e]"
          aria-label="Collapse sidebar"
          @click="setSidebarVisible(false)"
        >
          ‹
        </button>
      </div>

      <button
        class="flex w-full items-center gap-2.5 rounded-lg border border-[#d8d2c7] bg-[#f5f2ec] px-3.5 py-3 text-left text-xs font-bold text-[#4d4841] shadow-sm transition hover:border-[#bc8061] hover:text-[#a35232]"
        @click="createNewChat"
      >
        <span class="text-lg leading-3 text-[#bf6745]">+</span> New conversation
      </button>

      <div class="mt-9">
        <div
          class="flex items-center justify-between px-2.5 pb-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[#9a948b]"
        >
          <span>Today</span>
          <span class="text-[#b2aca3]">{{ chats.length }}</span>
        </div>
        <div class="space-y-1">
          <button
            v-for="chat in chats"
            :key="chat.id"
            class="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-3 text-left text-[#4d4841] transition hover:bg-[#f7f5f0]"
            :class="chat.id === activeChatId ? 'bg-[#f7f5f0] shadow-sm' : ''"
            @click="selectChat(chat.id)"
          >
            <span class="size-1.5 shrink-0 rounded-full bg-[#ca7652]"></span>
            <span class="flex min-w-0 flex-1 flex-col gap-1">
              <strong class="truncate text-[11px]">{{ chat.title }}</strong>
              <small class="font-mono text-[9px] text-[#a19a90]">{{
                new Date(chat.createdAt).toLocaleDateString()
              }}</small>
            </span>
            <span
              role="button"
              tabindex="0"
              class="hidden px-1 text-xs text-[#aaa39a] hover:text-[#a95737] group-hover:inline"
              aria-label="Delete chat"
              @click.stop="openDelete(chat)"
              @keydown.enter.stop="openDelete(chat)"
            >
              ×
            </span>
            <span
              role="button"
              tabindex="0"
              class="hidden px-1 text-xs text-[#aaa39a] hover:text-[#a95737] group-hover:inline"
              aria-label="Rename chat"
              @click.stop="openRename(chat)"
              @keydown.enter.stop="openRename(chat)"
            >
              ✎
            </span>
          </button>
        </div>
      </div>

      <div class="mt-auto border-t border-[#d9d4ca] px-2 pt-4">
        <div class="flex items-center gap-2 font-mono text-[10px] text-[#777068]">
          <span class="size-1.5 rounded-full bg-[#74a66d]"></span> Ollama connected
        </div>
        <div class="mt-4 flex gap-2 text-[10px] text-[#b1aba2]">
          <span class="max-w-[130px] truncate text-[#777068]">{{ user.username }}</span>
          <span>·</span>
          <button class="text-[#9e988f] hover:text-[#a95737]" @click="router.push('/settings')">
            Settings
          </button>
          <span>·</span>
          <button class="text-[#9e988f] hover:text-[#a95737]" @click="logout">Log out</button>
        </div>
      </div>
    </aside>

    <section class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <header
        class="flex items-center justify-between gap-5 border-b border-[#e5e1d9] px-5 py-6 sm:px-[6.5%]"
      >
        <div>
          <div
            class="mb-2.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[#9b948b]"
          >
            <span class="size-1.5 rounded-full bg-[#74a66d]"></span> Private workspace
          </div>
          <h1 class="text-xl font-bold tracking-tight sm:text-2xl">
            {{ activeChat?.title ?? "Conversation" }}
          </h1>
        </div>
        <div class="flex items-center gap-3">
          <button
            v-if="!sidebarVisible"
            class="rounded-md border border-[#d8d2c7] px-2 py-1 text-xs text-[#6b645b] hover:border-[#bc8061]"
            @click="setSidebarVisible(true)"
          >
            Chats
          </button>
          <span
            class="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[#8e9888] sm:flex"
            ><span class="size-1.5 rounded-full bg-[#74a66d]"></span> Ready</span
          >
          <button
            class="bg-transparent text-lg text-[#8b867e]"
            aria-label="More conversation options"
          >
            •••
          </button>
        </div>
      </header>

      <div class="flex min-h-0 flex-1 flex-col px-5 py-7 sm:px-[6.5%]">
        <div ref="chatScroll" class="min-h-0 flex-1 overflow-y-auto pr-1">
          <div
            v-if="messageList.length === 0"
            class="flex min-h-full flex-col items-center justify-center py-16 text-center"
          >
            <div
              class="mb-4 grid size-12 place-items-center rounded-xl bg-[#c36b46] font-mono text-2xl text-[#f9f7f2]"
            >
              ✦
            </div>
            <h2 class="text-xl font-bold">Start a fresh conversation</h2>
            <p class="mt-2 max-w-md text-sm leading-6 text-[#8a837a]">
              Bring a question, a half-formed idea, or a problem you want to untangle.
            </p>
          </div>
          <div v-else class="mx-auto w-full max-w-3xl space-y-7">
            <article v-for="message in messageList" :key="message.id" class="flex gap-3">
              <div
                class="grid size-8 shrink-0 place-items-center rounded-lg font-mono text-xs font-medium"
                :class="
                  message.role === 'assistant'
                    ? 'bg-[#c36b46] text-[#fffaf4]'
                    : 'bg-[#ddd8ce] text-[#625b52]'
                "
              >
                {{ message.role === "assistant" ? "O" : "Y" }}
              </div>
              <div class="min-w-0 flex-1">
                <div class="mb-1.5 flex items-baseline gap-2 text-xs">
                  <strong>{{
                    message.role === "assistant" ? message.model || "Assistant" : "You"
                  }}</strong>
                  <span class="font-mono text-[10px] text-[#aaa39a]">{{ message.time }}</span>
                </div>
                <p class="whitespace-pre-wrap text-sm leading-7 text-[#514b44]">
                  {{ message.content }}
                </p>
              </div>
            </article>
            <div v-if="isGenerating" class="flex items-center gap-3">
              <span
                class="grid size-8 place-items-center rounded-lg bg-[#c36b46] font-mono text-xs text-[#fffaf4]"
                >O</span
              >
              <span class="flex gap-1 rounded-full bg-[#ebe8e1] px-3 py-2"
                ><i class="size-1.5 animate-pulse rounded-full bg-[#a99f94]"></i
                ><i
                  class="size-1.5 animate-pulse rounded-full bg-[#a99f94] [animation-delay:150ms]"
                ></i
                ><i
                  class="size-1.5 animate-pulse rounded-full bg-[#a99f94] [animation-delay:300ms]"
                ></i
              ></span>
            </div>
          </div>
        </div>

        <div class="mx-auto mt-8 w-full max-w-3xl">
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <span class="mr-1 font-mono text-[10px] uppercase tracking-wider text-[#9a948b]"
              >Try asking</span
            >
            <button
              class="rounded-full border border-[#d8d2c7] px-3 py-1.5 text-[11px] text-[#6b645b] transition hover:border-[#bc8061] hover:text-[#a35232]"
              @click="selectPrompt('Summarize a complex idea for me')"
            >
              Summarize an idea
            </button>
            <button
              class="rounded-full border border-[#d8d2c7] px-3 py-1.5 text-[11px] text-[#6b645b] transition hover:border-[#bc8061] hover:text-[#a35232]"
              @click="selectPrompt('Help me plan my next project')"
            >
              Plan a project
            </button>
            <button
              class="rounded-full border border-[#d8d2c7] px-3 py-1.5 text-[11px] text-[#6b645b] transition hover:border-[#bc8061] hover:text-[#a35232]"
              @click="selectPrompt('Review this code for me')"
            >
              Review some code
            </button>
          </div>
          <form
            class="rounded-xl border border-[#d8d2c7] bg-white/70 p-3 shadow-[0_8px_30px_rgba(122,108,91,0.08)]"
            @submit.prevent="sendMessage"
          >
            <textarea
              v-model="draft"
              rows="1"
              placeholder="Message your local assistant..."
              class="min-h-14 w-full resize-none border-0 bg-transparent px-2 py-1 text-sm leading-6 text-[#3e3934] outline-none placeholder:text-[#aaa39a]"
              aria-label="Message your local assistant"
              @keydown="handleComposerKeydown"
            ></textarea>
            <div
              class="flex flex-wrap items-center justify-between gap-3 border-t border-[#eeeae3] pt-3"
            >
              <div class="flex items-center gap-4">
                <button type="button" class="text-xs text-[#8b8379]" aria-label="Attach a file">
                  ＋ Attach
                </button>
                <label
                  class="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[#9a948b]"
                  for="composer-model"
                >
                  Model
                  <select
                    id="composer-model"
                    v-model="ollamaStore.selectedModel"
                    class="max-w-[150px] rounded-md border border-[#ddd8ce] bg-[#f7f5f0] px-2 py-1.5 font-sans text-xs normal-case tracking-normal text-[#4d4841] outline-none focus:border-[#c36b46]"
                  >
                    <option v-if="ollamaStore.models.length === 0" value="" disabled>
                      Waiting for models...
                    </option>
                    <option v-for="model in ollamaStore.models" :key="model" :value="model">
                      {{ model }}
                    </option>
                  </select>
                </label>
                <label class="flex items-center gap-1.5 text-xs text-[#6b645b]">
                  <input v-model="tsundere" type="checkbox" class="accent-[#c36b46]" />
                  Tsundere
                </label>
                <label class="flex items-center gap-1.5 text-xs text-[#6b645b]">
                  <input v-model="thinking" type="checkbox" class="accent-[#c36b46]" />
                  Thinking
                </label>
                <label class="flex items-center gap-1.5 text-xs text-[#6b645b]">
                  <input v-model="streaming" type="checkbox" class="accent-[#c36b46]" />
                  Stream
                </label>
              </div>
              <button
                class="grid size-9 place-items-center rounded-lg bg-[#c36b46] text-lg text-white transition hover:bg-[#a95737] disabled:cursor-not-allowed disabled:opacity-40"
                type="submit"
                :disabled="!draft.trim() || isGenerating"
                aria-label="Send message"
              >
                ↑
              </button>
            </div>
          </form>
          <p class="mt-3 text-center font-mono text-[10px] text-[#aaa39a]">
            Ollama can make mistakes. Check important information.
          </p>
        </div>
      </div>
    </section>

    <div
      v-if="renameChatId"
      class="fixed inset-0 z-10 grid place-items-center bg-[#24221f]/30 px-5"
    >
      <form
        class="w-full max-w-md rounded-xl bg-[#fffdf9] p-6 shadow-xl"
        @submit.prevent="submitRename"
      >
        <h2 class="text-lg font-bold">Rename chat</h2>
        <label class="mt-4 block text-sm font-semibold">
          Chat name
          <input
            v-model="renameValue"
            type="text"
            required
            class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[#f7f5f0] px-3 py-2.5 outline-none focus:border-[#c36b46]"
          />
        </label>
        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="px-3 py-2 text-sm text-[#81796f]"
            @click="renameChatId = null"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="rounded-lg bg-[#c36b46] px-4 py-2 text-sm font-bold text-white"
          >
            Save
          </button>
        </div>
      </form>
    </div>

    <div
      v-if="deleteChatId"
      class="fixed inset-0 z-10 grid place-items-center bg-[#24221f]/30 px-5"
    >
      <form
        class="w-full max-w-md rounded-xl bg-[#fffdf9] p-6 shadow-xl"
        @submit.prevent="confirmDelete"
      >
        <h2 class="text-lg font-bold">Delete chat?</h2>
        <p class="mt-2 text-sm leading-6 text-[#81796f]">
          Type <strong class="text-[#4d4841]">{{ deleteChatName }}</strong> to permanently delete
          this conversation.
        </p>
        <input
          v-model="deleteConfirmation"
          type="text"
          autocomplete="off"
          class="mt-4 w-full rounded-lg border border-[#d8d2c7] bg-[#f7f5f0] px-3 py-2.5 outline-none focus:border-[#c36b46]"
        />
        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="px-3 py-2 text-sm text-[#81796f]"
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
  </main>
</template>
