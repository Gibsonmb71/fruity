/** Compatibility import for Fruity's room host; QBSheet owns correction semantics. */
export {
  conversion,
  editableQuestionFromEvents,
  eventsFromEditableQuestion,
  replaceQuestionEvents,
  validateEditableQuestion,
} from 'qbsheet';
export type { EditableAttemptKind, IEditableAttempt, IEditableBonus, IEditableQuestion } from 'qbsheet';
