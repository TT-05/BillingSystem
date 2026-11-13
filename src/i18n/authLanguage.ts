import type { Auth } from 'firebase/auth';
import i18n from './index';
// Firebase uses this locale for verification/reset emails and supported OAuth UI.
export function bindAuthLanguage(auth: Pick<Auth, 'languageCode'>): () => void {
  const update = (language: string) => {
    auth.languageCode = language;
  };
  update(i18n.language);
  i18n.on('languageChanged', update);
  return () => {
    i18n.off('languageChanged', update);
  };
}
