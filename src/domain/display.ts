import { locale, t } from '../i18n';
export function dateText(value: { toDate: () => Date } | null | undefined) {
  return (
    value?.toDate().toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) ||
    t('Waiting for server')
  );
}
