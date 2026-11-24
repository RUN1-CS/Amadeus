<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import { createApiClient } from "@/services/api";
import { useOllamaStore } from "@/stores/ollama";

type ModelType = "ollama" | "comfyui";
type ManagedModel = { name: string; enabled: boolean };
type ModelCatalog = {
  ollama: ManagedModel[];
  comfyui: ManagedModel[];
  errors: { ollama?: string; comfyui?: string };
};

const store = useOllamaStore();
const { t } = useI18n();
const { token } = storeToRefs(store);
const api = createApiClient(() => token.value);
const catalog = ref<ModelCatalog>({ ollama: [], comfyui: [], errors: {} });
const loading = ref(false);
const error = ref("");
const savingKeys = ref<string[]>([]);
const groups: { key: ModelType; title: string }[] = [
  { key: "ollama", title: "admin.models.ollama" },
  { key: "comfyui", title: "admin.models.comfyui" },
];

async function loadModels() {
  loading.value = true;
  error.value = "";
  try {
    catalog.value = await api.request<ModelCatalog>("/api/admin/models");
  } catch (requestError) {
    error.value =
      requestError instanceof Error ? requestError.message : t("admin.models.couldNotLoad");
  } finally {
    loading.value = false;
  }
}

async function setEnabled(modelType: ModelType, model: ManagedModel, enabled: boolean) {
  const key = `${modelType}:${model.name}`;
  if (savingKeys.value.includes(key)) return;

  savingKeys.value = [...savingKeys.value, key];
  error.value = "";
  try {
    const response = await api.request<{
      modelType: ModelType;
      modelName: string;
      enabled: boolean;
    }>("/api/admin/models", {
      method: "PATCH",
      body: JSON.stringify({ modelType, modelName: model.name, enabled }),
    });
    const updatedModel = catalog.value[response.modelType].find(
      (entry) => entry.name === response.modelName,
    );
    if (updatedModel) updatedModel.enabled = response.enabled;
  } catch (requestError) {
    error.value =
      requestError instanceof Error ? requestError.message : t("admin.models.couldNotUpdate");
  } finally {
    savingKeys.value = savingKeys.value.filter((entry) => entry !== key);
  }
}

onMounted(() => void loadModels());
</script>

<template>
  <section
    class="mt-6 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-6"
  >
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-lg font-bold">{{ $t("admin.models.access") }}</h2>
        <p class="mt-1 text-sm text-[var(--theme-muted)]">
          {{ $t("admin.models.description") }}
        </p>
      </div>
      <button
        class="rounded-lg border border-[var(--theme-border)] px-3 py-2 text-sm font-semibold transition hover:border-[var(--theme-accent)] disabled:opacity-50"
        :disabled="loading"
        @click="loadModels"
      >
        {{ loading ? $t("admin.models.refreshing") : $t("admin.models.refresh") }}
      </button>
    </div>

    <p
      v-if="error"
      role="alert"
      class="mt-4 rounded-lg bg-[#f9e4dc] px-3 py-2 text-sm text-[#853c2a]"
    >
      {{ error }}
    </p>

    <div class="mt-5 grid gap-5 lg:grid-cols-2">
      <section
        v-for="group in groups"
        :key="group.key"
        class="rounded-lg border border-[var(--theme-border)]"
      >
        <header class="border-b border-[var(--theme-border)] px-4 py-3">
          <h3 class="font-semibold">{{ $t(group.title) }}</h3>
          <p v-if="catalog.errors[group.key]" class="mt-1 text-xs text-[#853c2a]">
            {{ catalog.errors[group.key] }}
          </p>
        </header>
        <ul
          v-if="catalog[group.key].length"
          class="max-h-[50vh] divide-y divide-[var(--theme-border)] overflow-y-auto"
        >
          <li
            v-for="model in catalog[group.key]"
            :key="model.name"
            class="flex items-center justify-between gap-4 px-4 py-3"
          >
            <span class="min-w-0 break-all text-sm font-medium">{{ model.name }}</span>
            <label class="flex shrink-0 items-center gap-2 text-xs text-[var(--theme-muted)]">
              <input
                type="checkbox"
                class="size-4 accent-[var(--theme-accent)]"
                :checked="model.enabled"
                :disabled="savingKeys.includes(`${group.key}:${model.name}`)"
                :aria-label="$t('admin.models.allowRegularUsers', { model: model.name })"
                @change="setEnabled(group.key, model, ($event.target as HTMLInputElement).checked)"
              />
              {{ model.enabled ? $t("admin.models.enabled") : $t("admin.models.disabled") }}
            </label>
          </li>
        </ul>
        <p v-else class="px-4 py-5 text-sm text-[var(--theme-muted)]">
          {{ loading ? $t("admin.models.loading") : $t("admin.models.none") }}
        </p>
      </section>
    </div>
  </section>
</template>
