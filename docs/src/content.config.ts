import { defineCollection } from "astro:content";
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  // Starlight 不会自注册 i18n 集合（其 dist 内无 defineCollection），
  // 但 utils/translations.js 会 getCollection("i18n") 取 UI 字符串，
  // 且取数时把 console.warn 临时屏蔽 —— 集合缺失只会静默退回内置英文，
  // 不报错。故 src/content/i18n/*.json 必须在此注册才会生效。
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
