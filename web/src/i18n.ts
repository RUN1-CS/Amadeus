import { createI18n } from "vue-i18n";
import type { Language } from "@/types/chat.ts";

import en from "./locales/en.json";
import cs from "./locales/cs.json";
import de from "./locales/de.json";
import ja from "./locales/ja.json";
import shakespeare from "./locales/en-GB-x-shakespeare.json";
import tsundere from "./locales/ja-x-tsundere.json";
import lol from "./locales/lol.json";

const availableLanguages: Language[] = [
  { code: "en", name: "English" },
  { code: "cs", name: "Česky" },
  { code: "de", name: "Deutsch" },
  { code: "ja", name: "日本語" },
];

const availableNoveltyLanguages: Language[] = [
  { code: "en-GB-x-shakespeare", name: "Shakespearean English" },
  { code: "ja-x-tsundere", name: "Tsundere Japanese-English" },
  { code: "lol", name: "LOLCat" },
];

export const finalAvailableLanguages: Language[] =
  import.meta.env.VITE_NOVELTY === "true"
    ? [...availableLanguages, ...availableNoveltyLanguages]
    : availableLanguages;

const savedLocale = localStorage.getItem("amadeus_locale");
const locale = finalAvailableLanguages.some((language) => language.code === savedLocale)
  ? (savedLocale as string)
  : "en";

const i18n = createI18n({
  legacy: false,
  locale,
  fallbackLocale: "en",
  messages: {
    en,
    cs,
    de,
    ja,
    "en-GB-x-shakespeare": shakespeare,
    "ja-x-tsundere": tsundere,
    lol,
  },
});

export default i18n;
