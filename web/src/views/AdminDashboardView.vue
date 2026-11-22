<script setup lang="ts">
import { onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import BackToChatButton from "@/components/common/BackToChatButton.vue";
import { createApiClient } from "@/services/api";
import { useOllamaStore } from "@/stores/ollama";

type AdminOverview = {
  stats: {
    users: number;
    admins: number;
    chats: number;
    messages: number;
    memories: number;
  };
  recentUsers: { username: string; createdAt: string }[];
  services: {
    ollama: { status: string; models: string[]; error?: string };
    comfyui: { status: string; models: string[]; error?: string };
  };
};

type AdminUserPage = {
  users: { id: string; username: string; createdAt: string; isAdmin: boolean }[];
  nextCursor: string | null;
};

const store = useOllamaStore();
const { user, token } = storeToRefs(store);
const api = createApiClient(() => token.value);
const overview = ref<AdminOverview | null>(null);
const loading = ref(false);
const error = ref("");
const refreshedAt = ref<Date | null>(null);
const users = ref<AdminUserPage["users"]>([]);
const usersCursor = ref<string | null>(null);
const usersHasMore = ref(true);
const usersLoading = ref(false);
const usersError = ref("");
const usersList = ref<HTMLElement | null>(null);

const metrics = [
  { key: "users", label: "Registered users" },
  { key: "admins", label: "Administrators" },
  { key: "chats", label: "Conversations" },
  { key: "messages", label: "Messages" },
  { key: "memories", label: "Saved memories" },
] as const;

async function loadOverview() {
  loading.value = true;
  error.value = "";
  try {
    overview.value = await api.request<AdminOverview>("/api/admin/overview");
    refreshedAt.value = new Date();
  } catch (requestError) {
    error.value =
      requestError instanceof Error ? requestError.message : "Could not load the admin dashboard.";
  } finally {
    loading.value = false;
  }
}

async function loadMoreUsers() {
  if (usersLoading.value || !usersHasMore.value) return;

  usersLoading.value = true;
  usersError.value = "";
  try {
    const cursor = usersCursor.value ? `?beforeId=${encodeURIComponent(usersCursor.value)}` : "";
    const page = await api.request<AdminUserPage>(`/api/admin/users${cursor}`);
    users.value.push(...page.users);
    usersCursor.value = page.nextCursor;
    usersHasMore.value = page.nextCursor !== null;
  } catch (requestError) {
    usersError.value =
      requestError instanceof Error ? requestError.message : "Could not load users.";
  } finally {
    usersLoading.value = false;
  }
}

function handleUsersScroll() {
  const element = usersList.value;
  if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 160) {
    void loadMoreUsers();
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

onMounted(() => {
  void loadOverview();
  void loadMoreUsers();
});
</script>

<template>
  <main
    class="min-h-screen bg-[var(--theme-background)] px-5 py-8 text-[var(--theme-text)] sm:px-10"
  >
    <section class="mx-auto max-w-6xl">
      <BackToChatButton />

      <header class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="font-mono text-[10px] uppercase tracking-widest text-[var(--theme-muted)]">
            Amadeus administration
          </p>
          <h1 class="mt-2 text-3xl font-bold tracking-tight">Admin dashboard</h1>
          <p class="mt-2 text-sm text-[var(--theme-muted)]">
            Service health and high-level application activity
            <span v-if="user">· signed in as {{ user.username }}</span>
          </p>
        </div>
        <button
          class="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-2 text-sm font-semibold transition hover:border-[var(--theme-accent)] disabled:opacity-50"
          :disabled="loading"
          @click="loadOverview"
        >
          {{ loading ? "Refreshing…" : "Refresh data" }}
        </button>
      </header>

      <p v-if="refreshedAt" class="mt-3 text-xs text-[var(--theme-subtle)]">
        Snapshot refreshed {{ refreshedAt.toLocaleTimeString() }}
      </p>

      <div
        v-if="error"
        role="alert"
        class="mt-6 rounded-xl border border-[#e7b6a4] bg-[#f9e4dc] px-4 py-3 text-sm text-[#853c2a]"
      >
        {{ error }}
        <p v-if="error.includes('Administrator access')" class="mt-1">
          Admin access must be granted to your account by a database administrator.
        </p>
      </div>

      <template v-if="overview">
        <section
          aria-label="Application metrics"
          class="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          <article
            v-for="metric in metrics"
            :key="metric.key"
            class="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-5"
          >
            <p class="text-sm text-[var(--theme-muted)]">{{ metric.label }}</p>
            <p class="mt-3 text-3xl font-bold tabular-nums">{{ overview.stats[metric.key] }}</p>
          </article>
        </section>

        <section
          class="mt-6 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-6"
        >
          <div class="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 class="text-lg font-bold">All users</h2>
              <p class="mt-1 text-sm text-[var(--theme-muted)]">
                {{ users.length }} of {{ overview.stats.users }} accounts loaded · scroll to load
                more
              </p>
            </div>
          </div>

          <div
            ref="usersList"
            class="mt-4 max-h-[60vh] overflow-y-auto rounded-lg border border-[var(--theme-border)]"
            @scroll.passive="handleUsersScroll"
          >
            <table class="w-full border-collapse text-left text-sm">
              <thead
                class="sticky top-0 z-[1] bg-[var(--theme-sidebar)] text-xs text-[var(--theme-muted)]"
              >
                <tr>
                  <th scope="col" class="px-4 py-3 font-semibold">User</th>
                  <th scope="col" class="px-4 py-3 font-semibold">Account ID</th>
                  <th scope="col" class="px-4 py-3 font-semibold">Joined</th>
                  <th scope="col" class="px-4 py-3 font-semibold">Role</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--theme-border)]">
                <tr v-for="account in users" :key="account.id">
                  <td class="max-w-56 truncate px-4 py-3 font-semibold">{{ account.username }}</td>
                  <td class="px-4 py-3 font-mono text-xs text-[var(--theme-muted)]">
                    {{ account.id }}
                  </td>
                  <td class="whitespace-nowrap px-4 py-3 text-[var(--theme-muted)]">
                    {{ formatDate(account.createdAt) }}
                  </td>
                  <td class="px-4 py-3">
                    <span
                      v-if="account.isAdmin"
                      class="rounded-full bg-[var(--theme-accent)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--theme-accent)]"
                    >
                      Admin
                    </span>
                    <span v-else class="text-xs text-[var(--theme-muted)]">User</span>
                  </td>
                </tr>
                <tr v-if="users.length === 0 && !usersLoading && !usersError">
                  <td colspan="4" class="px-4 py-8 text-center text-sm text-[var(--theme-muted)]">
                    No user accounts found.
                  </td>
                </tr>
              </tbody>
            </table>
            <div
              v-if="usersLoading"
              class="px-4 py-3 text-center text-xs text-[var(--theme-muted)]"
            >
              Loading users…
            </div>
            <div
              v-if="usersError"
              class="flex items-center justify-between gap-3 px-4 py-3 text-sm text-[#853c2a]"
            >
              <span>{{ usersError }}</span>
              <button class="shrink-0 font-semibold underline" @click="loadMoreUsers">Retry</button>
            </div>
            <p
              v-if="!usersHasMore && users.length"
              class="px-4 py-3 text-center text-xs text-[var(--theme-muted)]"
            >
              All users loaded.
            </p>
          </div>
        </section>

        <div class="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section
            class="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-6"
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="text-lg font-bold">AI services</h2>
                <p class="mt-1 text-sm text-[var(--theme-muted)]">
                  Status from the server’s latest model discovery.
                </p>
              </div>
            </div>

            <div class="mt-5 divide-y divide-[var(--theme-border)]">
              <article
                v-for="(service, name) in overview.services"
                :key="name"
                class="py-4 first:pt-0 last:pb-0"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <h3 class="font-semibold">{{ name === "comfyui" ? "ComfyUI" : "Ollama" }}</h3>
                  <span
                    class="rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider"
                    :class="
                      service.status === 'available'
                        ? 'bg-[#e2f0e5] text-[#356c40]'
                        : service.status === 'degraded'
                          ? 'bg-[#fff1d2] text-[#805c14]'
                          : 'bg-[#f9e4dc] text-[#853c2a]'
                    "
                  >
                    {{ service.status }}
                  </span>
                </div>
                <p class="mt-2 text-sm text-[var(--theme-muted)]">
                  {{ service.models.length ? service.models.join(", ") : "No models discovered" }}
                </p>
                <p v-if="service.error" class="mt-2 text-xs text-[#853c2a]">{{ service.error }}</p>
              </article>
            </div>
          </section>

          <section
            class="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-6"
          >
            <h2 class="text-lg font-bold">Recently registered</h2>
            <p class="mt-1 text-sm text-[var(--theme-muted)]">Latest eight accounts</p>
            <ul
              v-if="overview.recentUsers.length"
              class="mt-4 divide-y divide-[var(--theme-border)]"
            >
              <li
                v-for="account in overview.recentUsers"
                :key="account.username"
                class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <span class="truncate text-sm font-semibold">{{ account.username }}</span>
                <time class="shrink-0 text-xs text-[var(--theme-muted)]">
                  {{ formatDate(account.createdAt) }}
                </time>
              </li>
            </ul>
            <p v-else class="mt-4 text-sm text-[var(--theme-muted)]">No accounts found.</p>
          </section>
        </div>

        <section
          class="mt-6 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-6"
        >
          <h2 class="text-lg font-bold">Quick links</h2>
          <div class="mt-4 flex flex-wrap gap-3">
            <RouterLink
              to="/settings"
              class="rounded-lg border border-[var(--theme-border)] px-4 py-2 text-sm font-semibold hover:border-[var(--theme-accent)]"
            >
              Account settings
            </RouterLink>
            <RouterLink
              to="/memory"
              class="rounded-lg border border-[var(--theme-border)] px-4 py-2 text-sm font-semibold hover:border-[var(--theme-accent)]"
            >
              Memory manager
            </RouterLink>
          </div>
          <p class="mt-3 text-xs text-[var(--theme-muted)]">
            These tools operate on your signed-in account.
          </p>
        </section>
      </template>
    </section>
  </main>
</template>
