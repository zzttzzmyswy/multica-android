import * as React from 'react'
import {
  StreamingMarkdown as StreamingMarkdownBase,
  type StreamingMarkdownProps as StreamingMarkdownBaseProps
} from '@multica/ui/markdown'
import { IssueMentionCard } from '@/features/issues/components/issue-mention-card'

export type StreamingMarkdownProps = StreamingMarkdownBaseProps

function defaultRenderMention({ type, id }: { type: string; id: string }): React.ReactNode {
  if (type === 'issue') {
    return <IssueMentionCard issueId={id} />
  }
  return null
}

/**
 * App-level StreamingMarkdown wrapper that injects IssueMentionCard via renderMention.
 */
export function StreamingMarkdown(props: StreamingMarkdownProps): React.JSX.Element {
  return <StreamingMarkdownBase renderMention={defaultRenderMention} {...props} />
}
