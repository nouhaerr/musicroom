export interface PasswordFeedback { message: string; valid: boolean }

export function passwordValidation(password: string, confirm: string) {
  const lengthValid = [...password].length >= 8;
  const numberValid = /[0-9]/.test(password);
  const matches = confirm.length > 0 && password === confirm;
  return {
    valid: lengthValid && numberValid && matches,
    password: [
      { message: 'At least 8 characters.', valid: lengthValid },
      { message: 'At least one number (0–9).', valid: numberValid },
    ],
    confirm: [{ message: !confirm ? 'Confirm your password.' : matches ? 'Passwords match.' : "Passwords don't match.", valid: matches }],
  };
}
