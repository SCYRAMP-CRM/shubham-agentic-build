import { GOAL_DESCRIPTION_MAX } from './goal-add.ts'
import { editFromText, type GoalEdit } from './goal-edit.ts'

// F-370 (Shubham: "also double click title should let us change the description"): the small editor that opens IN a goal's row when he double-clicks its title in the Alt+G goals curtain, instead of going through the Edit goal dialog. It is the
// SAME text field as that dialog's (the first line is the title, the rest the details: shared/goal-edit.ts textOfGoal and editFromText), with the same limits, and it saves through the same route (PATCH of the changed keys), so there is no new door.
// Pure: what the field changed, and the words around it.

/** The editor's name for a screen reader. */
export const INLINE_EDIT_LABEL = 'Edit goal'
/** The line under the field. */
export const INLINE_EDIT_HINT = 'Enter saves · Shift+Enter a new line · Esc cancels'

export type InlineEditPlan =
  /** The text has no title (nothing visible) or is longer than a goal's text may be: the fixed sentence of a goal with no usable text is shown, nothing is sent. */
  | { kind: 'bad' }
  /** The text is what the goal already says: nothing is sent, the editor just closes. */
  | { kind: 'none' }
  /** Send exactly these changed keys (the title when its first line changed, the details when they did). */
  | { kind: 'save'; body: GoalEdit }

/** What saving `text` does for a goal with this title and details. */
export function inlineEditPlan(text: string, title: string, description: string | null | undefined): InlineEditPlan {
  if (text.trim().length > GOAL_DESCRIPTION_MAX) return { kind: 'bad' }
  const changed = editFromText(text, title, description)
  if (changed === null) return { kind: 'bad' }
  return Object.keys(changed).length === 0 ? { kind: 'none' } : { kind: 'save', body: changed }
}
