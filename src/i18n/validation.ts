import type { FormEvent } from 'react';
import { t } from './index';
import { number } from './format';
function control(
  target: EventTarget | null,
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
    ? target
    : null;
}
export const localizedValidation = {
  onInvalidCapture(event: FormEvent<HTMLFormElement>) {
    const field = control(event.target);
    if (!field) return;
    const validity = field.validity;
    const length = 'minLength' in field ? field.minLength : 0;
    const max = 'maxLength' in field ? field.maxLength : 0;
    field.setCustomValidity(
      validity.valueMissing
        ? t('This field is required.')
        : validity.typeMismatch
          ? t('Enter a valid email address.')
          : validity.tooShort
            ? t('Use at least {{countText}} characters.', { countText: number(length) })
            : validity.tooLong
              ? t('Use no more than {{countText}} characters.', { countText: number(max) })
              : t('Enter a valid value.'),
    );
  },
  onInputCapture(event: FormEvent<HTMLFormElement>) {
    control(event.target)?.setCustomValidity('');
  },
};
