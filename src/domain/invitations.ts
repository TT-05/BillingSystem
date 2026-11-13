import { Timestamp } from 'firebase/firestore';
import type { Invitation } from './types';
export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export function invitationExpiresAt(invitation: Invitation): Timestamp {
  return (
    invitation.expiresAt ??
    Timestamp.fromMillis(invitation.createdAt.toMillis() + INVITATION_LIFETIME_MS)
  );
}
