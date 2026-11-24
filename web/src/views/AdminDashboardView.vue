<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import BackToChatButton from "@/components/common/BackToChatButton.vue";
import AdminLogsPanel from "@/components/admin/AdminLogsPanel.vue";
import AdminBackupsPanel from "@/components/admin/AdminBackupsPanel.vue";
import AdminModelAccessPanel from "@/components/admin/AdminModelAccessPanel.vue";
import AdminUsersPanel from "@/components/admin/AdminUsersPanel.vue";
import { createApiClient } from "@/services/api";
import { localizeServerError } from "@/services/serverErrors";
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
    ollama: {
      status: string;
      models: string[];
      error?: string;
      errorLocalizationCode?: string;
      errorLocalizationParams?: Record<string, string | number>;
    };
    comfyui: {
      status: string;
      models: string[];
      error?: string;
      errorLocalizationCode?: string;
      errorLocalizationParams?: Record<string, string | number>;
    };
  };
};

const store = useOllamaStore();
const { t } = useI18n();
const { user, token } = storeToRefs(store);
const api = createApiClient(() => token.value);
const overview = ref<AdminOverview | null>(null);
const loading = ref(false);
const error = ref("");
const refreshedAt = ref<Date | null>(null);

const metrics = [
  { key: "users", label: "admin.registeredUsers" },
  { key: "admins", label: "admin.administrators" },
  { key: "chats", label: "admin.conversations" },
  { key: "messages", label: "admin.messages" },
  { key: "memories", label: "admin.savedMemories" },
] as const;

async function loadOverview() {
  loading.value = true;
  error.value = "";
  try {
    overview.value = await api.request<AdminOverview>("/api/admin/overview");
    refreshedAt.value = new Date();
  } catch (requestError) {
    error.value =
      requestError instanceof Error ? requestError.message : t("admin.couldNotLoadDashboard");
  } finally {
    loading.value = false;
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function serviceStatusLabel(status: string) {
  const labels: Record<string, string> = {
    available: t("admin.statusAvailable"),
    degraded: t("admin.statusDegraded"),
    unavailable: t("admin.statusUnavailable"),
  };
  return labels[status] ?? status;
}

onMounted(() => void loadOverview());
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
            {{ $t("admin.administration") }}
          </p>
          <h1 class="mt-2 text-3xl font-bold tracking-tight">{{ $t("admin.dashboard") }}</h1>
          <p class="mt-2 text-sm text-[var(--theme-muted)]">
            {{ $t("admin.description") }}
            <span v-if="user">· {{ $t("settings.signedInAs", { username: user.username }) }}</span>
          </p>
        </div>
        <button
          class="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-2 text-sm font-semibold transition hover:border-[var(--theme-accent)] disabled:opacity-50"
          :disabled="loading"
          @click="loadOverview"
        >
          {{ loading ? $t("admin.refreshing") : $t("admin.refreshData") }}
        </button>
      </header>

      <p v-if="refreshedAt" class="mt-3 text-xs text-[var(--theme-subtle)]">
        {{ $t("admin.snapshotRefreshed", { time: refreshedAt.toLocaleTimeString() }) }}
      </p>

      <div
        v-if="error"
        role="alert"
        class="mt-6 rounded-xl border border-[#e7b6a4] bg-[#f9e4dc] px-4 py-3 text-sm text-[#853c2a]"
      >
        {{ error }}
        <p v-if="error.includes('Administrator access')" class="mt-1">
          {{ $t("admin.adminGrantDescription") }}
        </p>
      </div>

      <template v-if="overview">
        <section
          :aria-label="$t('admin.applicationMetrics')"
          class="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          <article
            v-for="metric in metrics"
            :key="metric.key"
            class="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-5"
          >
            <p class="text-sm text-[var(--theme-muted)]">{{ $t(metric.label) }}</p>
            <p class="mt-3 text-3xl font-bold tabular-nums">{{ overview.stats[metric.key] }}</p>
          </article>
        </section>

        <AdminUsersPanel :total-users="overview.stats.users" />
        <AdminModelAccessPanel />
        <AdminLogsPanel />
        <AdminBackupsPanel />

        <div class="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section
            class="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-6"
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="text-lg font-bold">{{ $t("admin.aiServices") }}</h2>
                <p class="mt-1 text-sm text-[var(--theme-muted)]">
                  {{ $t("admin.serviceDiscovery") }}
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
                    {{ serviceStatusLabel(service.status) }}
                  </span>
                </div>
                <p class="mt-2 text-sm text-[var(--theme-muted)]">
                  {{ service.models.length ? service.models.join(", ") : $t("admin.noModels") }}
                </p>
                <p v-if="service.error" class="mt-2 text-xs text-[#853c2a]">
                  {{
                    localizeServerError({
                      error: service.error,
                      localizationCode: service.errorLocalizationCode,
                      localizationParams: service.errorLocalizationParams,
                    })
                  }}
                </p>
              </article>
            </div>
          </section>

          <section
            class="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-6"
          >
            <h2 class="text-lg font-bold">{{ $t("admin.recentlyRegistered") }}</h2>
            <p class="mt-1 text-sm text-[var(--theme-muted)]">{{ $t("admin.latestAccounts") }}</p>
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
            <p v-else class="mt-4 text-sm text-[var(--theme-muted)]">
              {{ $t("admin.noAccounts") }}
            </p>
          </section>
        </div>

        <section
          class="mt-6 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-6"
        >
          <h2 class="text-lg font-bold">{{ $t("admin.quickLinks") }}</h2>
          <div class="mt-4 flex flex-wrap gap-3">
            <RouterLink
              to="/settings"
              class="rounded-lg border border-[var(--theme-border)] px-4 py-2 text-sm font-semibold hover:border-[var(--theme-accent)]"
            >
              {{ $t("admin.accountSettings") }}
            </RouterLink>
            <RouterLink
              to="/memory"
              class="rounded-lg border border-[var(--theme-border)] px-4 py-2 text-sm font-semibold hover:border-[var(--theme-accent)]"
            >
              {{ $t("admin.memoryManager") }}
            </RouterLink>
          </div>
          <p class="mt-3 text-xs text-[var(--theme-muted)]">
            {{ $t("admin.toolsDescription") }}
          </p>
        </section>
      </template>
    </section>
  </main>
</template>
