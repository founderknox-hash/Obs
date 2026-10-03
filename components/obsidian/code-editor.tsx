'use client'

import { useMemo, useRef } from 'react'

function highlight(source: string) {
  const pattern = /(--[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:local|function|end|if|then|else|elseif|return|for|do|while|break|and|or|not|true|false|nil|in|repeat|until)\b|\b\d+(?:\.\d+)?\b)/g
  return source.split(pattern).map((part, index) => {
    const kind = part.startsWith('--') ? 'comment' : /^["']/.test(part) ? 'string' : /^\d/.test(part) ? 'number' : /^(local|function|end|if|then|else|elseif|return|for|do|while|break|and|or|not|true|false|nil|in|repeat|until)$/.test(part) ? 'keyword' : undefined
    return <span key={index} className={kind ? `syntax-${kind}` : undefined}>{part}</span>
  })
}

export function CodeEditor({ value, onChange, readOnly = false, label }: {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  label: string
}) {
  const lines = value.split('\n').length
  const highlighted = useMemo(() => value.length > 80000 ? value : highlight(value), [value])
  const backdrop = useRef<HTMLPreElement>(null)
  const gutter = useRef<HTMLDivElement>(null)

  return (
    <div className="code-editor">
      <div className="editor-gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: Math.max(lines, 19) }, (_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <div className="editor-surface">
        <pre ref={backdrop} aria-hidden="true" className="editor-highlight"><code>{highlighted}{'\n'}</code></pre>
        <textarea
          aria-label={label}
          value={value}
          onChange={event => onChange?.(event.target.value)}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          className="editor-input"
          onScroll={event => {
            if (backdrop.current) {
              backdrop.current.scrollTop = event.currentTarget.scrollTop
              backdrop.current.scrollLeft = event.currentTarget.scrollLeft
            }
            if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop
          }}
        />
      </div>
    </div>
  )
}
