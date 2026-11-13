export function dateText(value: { toDate: () => Date } | null | undefined) {
  return (
    value?.toDate().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) ||
    'Waiting for server'
  );
}
