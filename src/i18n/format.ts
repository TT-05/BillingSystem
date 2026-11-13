import { locale, t } from './index';
import type { Currency, FinancialData } from '../domain/types';
export function money(cents: number, currency: Currency): string {
  return new Intl.NumberFormat(locale(), { style: 'currency', currency }).format(cents / 100);
}
export function number(value: number): string {
  return new Intl.NumberFormat(locale()).format(value);
}
export function percent(basisPoints: number): string {
  return new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 2 }).format(
    basisPoints / 10000,
  );
}
export function localDateISO(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function ledgerDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(date + 'T00:00:00Z'),
  );
}
// Only canonical, system-generated settlement copy is localized. User descriptions
// and notes (including edits to a settlement) are rendered verbatim.
export function financialText(data: FinancialData, field: 'description' | 'notes'): string {
  const value = data[field];
  return data.settlementKey &&
    ((field === 'description' && value === 'Settlement payment') ||
      (field === 'notes' && value === 'Confirmed from settlement recommendation'))
    ? t(value)
    : value;
}
