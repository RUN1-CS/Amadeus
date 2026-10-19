// Route map for login, registration, settings, and the main chat view.
import { createRouter, createWebHistory } from "vue-router";
import AuthView from "../views/AuthView.vue";
import SettingsView from "../views/SettingsView.vue";
import MemoryView from "../views/MemoryView.vue";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/login", component: AuthView },
    { path: "/register", component: AuthView },
    { path: "/settings", component: SettingsView },
    { path: "/memory", component: MemoryView },
  ],
});

export default router;
