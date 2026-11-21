export const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English', nativeLabel: 'English', direction: 'ltr' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español', direction: 'ltr' },
  { code: 'fr', label: 'French', nativeLabel: 'Français', direction: 'ltr' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português', direction: 'ltr' },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch', direction: 'ltr' },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', direction: 'rtl' },
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語', direction: 'ltr' },
  { code: 'zh-CN', label: 'Simplified Chinese', nativeLabel: '简体中文', direction: 'ltr' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी', direction: 'ltr' },
] as const;

export type CowboyLocale = (typeof SUPPORTED_LOCALES)[number]['code'];

export function resolveLocale(value: string | null | undefined): CowboyLocale {
  const primary = value?.toLowerCase().split('-')[0];
  return SUPPORTED_LOCALES.find(locale => locale.code.toLowerCase() === value?.toLowerCase()
    || locale.code === primary)?.code ?? 'en';
}

export function localeMetadata(locale: CowboyLocale) {
  return SUPPORTED_LOCALES.find(item => item.code === locale) ?? SUPPORTED_LOCALES[0];
}
