import { createI18n } from "vue-i18n";

import en from "./locales/en.json";

const savedLocale = localStorage.getItem("amadeus_locale");
const locale = savedLocale === "en" ? savedLocale : "en";

const i18n = createI18n({
  legacy: false,
  locale,
  fallbackLocale: "en",
  messages: { en },
});

export default i18n;
