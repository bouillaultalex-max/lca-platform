/**
 * Retours utilisateurs (bug/idée/amélioration/question) — collecte simple pendant
 * les premiers tests réels, sans commentaires, sans assignation, sans notifications.
 */

export type FeedbackType = 'BUG' | 'IDEE' | 'AMELIORATION' | 'QUESTION';

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  BUG: 'Bug',
  IDEE: 'Idée',
  AMELIORATION: 'Amélioration',
  QUESTION: 'Question',
};

export type FeedbackPriority = 'NORMALE' | 'IMPORTANTE' | 'BLOQUANTE';

export const FEEDBACK_PRIORITY_LABELS: Record<FeedbackPriority, string> = {
  NORMALE: 'Normale',
  IMPORTANTE: 'Importante',
  BLOQUANTE: 'Bloquante',
};

export type FeedbackStatus = 'NOUVEAU' | 'TRAITE';

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  NOUVEAU: 'Nouveau',
  TRAITE: 'Traité',
};

export interface FeedbackAuthor {
  id: string;
  fullName: string;
}

export interface Feedback {
  id: string;
  siteId: string;
  userId: string;
  user: FeedbackAuthor;
  type: FeedbackType;
  priority: FeedbackPriority;
  message: string;
  pageUrl: string;
  appVersion: string;
  status: FeedbackStatus;
  createdAt: string;
}

export interface CreateFeedbackRequest {
  type: FeedbackType;
  priority?: FeedbackPriority;
  message: string;
  pageUrl: string;
}
