<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 RUN1-CS -->

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import { createApiClient } from "@/services/api";
import { useOllamaStore } from "@/stores/ollama";

defineProps<{ totalUsers: number }>();

type UserPage = {
  users: {
    id: string;
    username: string;
    createdAt: string;
    isAdmin: boolean;
    isOwner: boolean;
  }[];
  nextCursor: string | null;
};

type ManagedRole = "user" | "admin" | "owner";

const store = useOllamaStore();
const { t } = useI18n();
const { token, user } = storeToRefs(store);
const api = createApiClient(() => token.value);
const users = ref<UserPage["users"]>([]);
const cursor = ref<string | null>(null);
const hasMore = ref(true);
const loading = ref(false);
const error = ref("");
const roleError = ref("");
const updatingUserId = ref<string | null>(null);
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

function accountRole(account: UserPage["users"][number]): ManagedRole {
  if (account.isOwner) return "owner";
  return account.isAdmin ? "admin" : "user";
}

async function changeRole(account: UserPage["users"][number], event: Event) {
  const select = event.currentTarget;
  if (!(select instanceof HTMLSelectElement)) return;
  const selectedRole = select.value;
  if (
    selectedRole !== "user" &&
    selectedRole !== "admin" &&
    selectedRole !== "owner"
  ) {
    select.value = accountRole(account);
    return;
  }
  const role: ManagedRole = selectedRole;
  if (role === "owner" && !window.confirm(t("admin.users.transferConfirm", {
    username: account.username,
  }))) {
    select.value = accountRole(account);
    return;
  }

  updatingUserId.value = account.id;
  roleError.value = "";
  try {
    await api.request<{ updated: boolean }>(`/api/admin/users/${encodeURIComponent(account.id)}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
    account.isAdmin = role !== "user";
    account.isOwner = role === "owner";
    const signedInUser = user.value;

    if (role === "owner" && signedInUser) {
      const previousOwner = users.value.find(
        (entry) => entry.id === String(signedInUser.id),
      );
      if (previousOwner && previousOwner.id !== account.id) {
        previousOwner.isAdmin = true;
        previousOwner.isOwner = false;
      }
      signedInUser.isAdmin = true;
      signedInUser.isOwner = false;
    }
    if (signedInUser && String(signedInUser.id) === account.id) {
      signedInUser.isAdmin = role !== "user";
      signedInUser.isOwner = role === "owner";
    }
  } catch (requestError) {
    roleError.value =
      requestError instanceof Error ? requestError.message : t("admin.users.couldNotUpdate");
    select.value = accountRole(account);
  } finally {
    updatingUserId.value = null;
  }
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

    <p
      v-if="roleError"
      role="alert"
      class="mt-3 rounded-lg border border-[#e7b6a4] bg-[#f9e4dc] px-3 py-2 text-sm text-[#853c2a]"
    >
      {{ roleError }}
    </p>

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
              <select
                :value="accountRole(account)"
                :aria-label="$t('admin.users.roleFor', { username: account.username })"
                :disabled="account.isOwner || updatingUserId !== null || (accountRole(account) === 'owner' && !user?.isOwner)"
                class="max-w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-70"
                @change="changeRole(account, $event)"
              >
                <option value="user">{{ $t("admin.users.userRole") }}</option>
                <option value="admin">{{ $t("admin.users.admin") }}</option>
                <option v-if="user?.isOwner || account.isOwner" value="owner">
                  {{ $t("admin.users.owner") }}
                </option>
              </select>
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
