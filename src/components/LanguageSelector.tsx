import { useTranslation } from 'react-i18next';
export function LanguageSelector() {
  const { i18n } = useTranslation();
  return (
    <label className="language-selector">
      <span>语言 / Language</span>
      <select
        aria-label="语言 / Language"
        value={i18n.resolvedLanguage ?? 'zh-CN'}
        onChange={(e) => {
          document
            .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
              'input,select,textarea',
            )
            .forEach((field) => field.setCustomValidity(''));
          void i18n.changeLanguage(e.target.value);
        }}
      >
        <option value="zh-CN">简体中文</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
