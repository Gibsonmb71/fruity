/** Compatibility import for Fruity's room host; QBSheet owns correction semantics. */
export {
  conversion,
  editableQuestionFromEvents,
  eventsFromEditableQuestion,
  replaceQuestionEvents,
  validateEditableQuestion,
} from 'qbsheet';
export type { EditableAttemptKind, IEditableAttempt, IEditableBonus, IEditableQuestion } from 'qbsheet';

/** A question has one editable attempt per team; keep the UI cap beside the canonical validator. */
const editableTeams = ['left', 'right'] as const;

export function maximumEditableAttempts(): number {
  return editableTeams.length;
}
