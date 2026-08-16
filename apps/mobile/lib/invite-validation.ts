/**
 * Pure validation helpers for the member-invite form. Extracted so the email
 * check is unit-testable (the members page exercises it on-device, but a
 * workspace has no second real address to type during dev).
 */
export const INVITE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidInviteEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length > 0 && INVITE_EMAIL_RE.test(trimmed);
}