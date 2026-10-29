/** Field errors remain visible after blur/submit until the value is corrected. */
export function fieldValidation(value: string, required: boolean, email: boolean, show: boolean): string {
  if (!show) return '';
  if (required && !value.trim()) return 'This field is required.';
  if (email && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return 'Enter a valid email address.';
  return '';
}
