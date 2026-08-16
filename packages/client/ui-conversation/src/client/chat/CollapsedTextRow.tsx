/** Default-collapsed disclosure for secondary Assistant text output. */
import { useState, type ReactNode } from 'react'
import { DisclosureRow, IconChecklistOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './CollapsedTextRow.module.css'

/**
 * Hide secondary Assistant text until the user explicitly expands it.
 * @param props.title - localized disclosure label.
 * @param props.children - complete Assistant text presentation.
 * @returns the collapsed text disclosure.
 */
export function CollapsedTextRow({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={css.root}>
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconChecklistOutline14 size={14} />}
        title={title}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
      >
        <div className={css.body}>{children}</div>
      </DisclosureRow>
    </div>
  )
}
