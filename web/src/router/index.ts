// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// Route map for login, registration, settings, and the main chat view.
import { createRouter, createWebHistory } from "vue-router";
import AuthView from "../views/AuthView.vue";
import SettingsView from "../views/SettingsView.vue";
import MemoryView from "../views/MemoryView.vue";
import AdminDashboardView from "../views/AdminDashboardView.vue";
import ErrorView from "../views/ErrorView.vue";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/login", component: AuthView },
    { path: "/register", component: AuthView },
    { path: "/settings", component: SettingsView },
    { path: "/memory", component: MemoryView },
    { path: "/admin", component: AdminDashboardView },
    { path: "/403", component: ErrorView, props: { code: 403 }, meta: { errorPage: true } },
    { path: "/404", component: ErrorView, props: { code: 404 }, meta: { errorPage: true } },
    { path: "/500", component: ErrorView, props: { code: 500 }, meta: { errorPage: true } },
    { path: "/503", component: ErrorView, props: { code: 503 }, meta: { errorPage: true } },
    { path: "/:pathMatch(.*)*", component: ErrorView, props: { code: 404 }, meta: { errorPage: true } },
  ],
});

export default router;
