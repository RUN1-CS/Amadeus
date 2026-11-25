<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import { createApiClient } from "@/services/api";
import { useOllamaStore } from "@/stores/ollama";

defineProps<{ totalUsers: number }>();

type UserPage = {
  users: { id: string; username: string; createdAt: string; isAdmin: boolean }[];
  nextCursor: string | null;
};

const store = useOllamaStore();
const { t } = useI18n();
const { token } = storeToRefs(store);
const api = createApiClient(() => token.value);
const users = ref<UserPage["users"]>([]);
const cursor = ref<string | null>(null);
const hasMore = ref(true);
const loading = ref(false);
const error = ref("");
const usersList = ref<HTMLElement | null>(null);

async function loadMore() {
  if (loading.value || !hasMore.value) return;

  loading.value = true;
  error.value = "";
  try {
    const nextCursor = cursor.value ? `?beforeId=${encodeURIComponent(cursor.value)}` : "";
    const page = await api.request<UserPage>(`/api/admin/users${nextCursor}`);
    users.value.push(...page.users);
    cursor.value = page.nextCursor;
    hasMore.value = page.nextCursor !== null;
  } catch (requestError) {
    error.value =
      requestError instanceof Error ? requestError.message : t("admin.users.couldNotLoad");
  } finally {
    loading.value = false;
  }
}

function handleScroll() {
  const element = usersList.value;
  if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 160) {
    void loadMore();
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

onMounted(() => void loadMore());
</script>

<template>
  <section
    class="mt-6 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-6"
  >
    <div class="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 class="text-lg font-bold">{{ $t("admin.users.all") }}</h2>
        <p class="mt-1 text-sm text-[var(--theme-muted)]">
          {{ $t("admin.users.loaded", { loaded: users.length, total: totalUsers }) }}
        </p>
      </div>
    </div>

    <div
      ref="usersList"
      class="mt-4 max-h-[60vh] overflow-y-auto rounded-lg border border-[var(--theme-border)]"
      @scroll.passive="handleScroll"
    >
      <table class="w-full border-collapse text-left text-sm">
        <thead
          class="sticky top-0 z-[1] bg-[var(--theme-sidebar)] text-xs text-[var(--theme-muted)]"
        >
          <tr>
            <th scope="col" class="px-4 py-3 font-semibold">{{ $t("admin.users.user") }}</th>
            <th scope="col" class="px-4 py-3 font-semibold">{{ $t("admin.users.accountId") }}</th>
            <th scope="col" class="px-4 py-3 font-semibold">{{ $t("admin.users.joined") }}</th>
            <th scope="col" class="px-4 py-3 font-semibold">{{ $t("admin.users.role") }}</th>
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
                {{ $t("admin.users.admin") }}
              </span>
              <span v-else class="text-xs text-[var(--theme-muted)]">{{
                $t("admin.users.user")
              }}</span>
            </td>
          </tr>
          <tr v-if="users.length === 0 && !loading && !error">
            <td colspan="4" class="px-4 py-8 text-center text-sm text-[var(--theme-muted)]">
              {{ $t("admin.users.none") }}
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="loading" class="px-4 py-3 text-center text-xs text-[var(--theme-muted)]">
        {{ $t("admin.users.loading") }}
      </div>
      <div
        v-if="error"
        class="flex items-center justify-between gap-3 px-4 py-3 text-sm text-[#853c2a]"
      >
        <span>{{ error }}</span>
        <button class="shrink-0 font-semibold underline" @click="loadMore">
          {{ $t("common.retry") }}
        </button>
      </div>
      <p
        v-if="!hasMore && users.length"
        class="px-4 py-3 text-center text-xs text-[var(--theme-muted)]"
      >
        {{ $t("admin.users.allLoaded") }}
      </p>
    </div>
  </section>
</template>
