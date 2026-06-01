import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AccordionItem } from '@/components/ui/accordion'
import { AlertCircle, ChevronDown, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import type { UsageRecord } from '@/types/usage'

interface RequestPayload {
  model: string
  messages: Array<{ role: string; content: string | Array<unknown> }>
  system?: string | Array<unknown>
  max_tokens?: number
  temperature?: number
  top_p?: number
  stream?: boolean
  tools?: unknown[]
  tool_choice?: unknown
  [key: string]: unknown
}

interface RequestDetailDrawerProps {
  record: UsageRecord | null
  onClose: () => void
}

interface LogResponse {
  requestId: string
  payload: Record<string, unknown> | null
  responseBody?: string
  reason?: string
  error?: string
}

// Escape HTML to prevent XSS when rendering user/assistant content
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function RequestDetailDrawer({ record, onClose }: RequestDetailDrawerProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<LogResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!record) return
    let ignored = false
    setLoading(true)
    setData(null)

    api.getUsageRequestLog(record.requestId)
      .then((result) => {
        if (!ignored) setData(result)
      })
      .catch((err: Error) => {
        if (!ignored) setData({ requestId: record.requestId, payload: null, error: err.message || 'Network error' })
      })
      .finally(() => {
        if (!ignored) setLoading(false)
      })

    return () => {
      ignored = true
    }
  }, [record])

  const formatLatency = (ms?: number) => {
    if (!ms) return '-'
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
    return `${Math.round(ms)}ms`
  }

  const payload = data?.payload as RequestPayload | null
  const roleList = payload?.messages?.map((m) => m.role).join(' → ') || ''

  // Message selection state
  const [selectedMessageIndex, setSelectedMessageIndex] = useState<number | null>(null)
  const selectedMessage = selectedMessageIndex !== null ? payload?.messages?.[selectedMessageIndex] : null

  // Extract params (exclude known structural fields)
  const PARAM_KEYS = new Set(['model', 'messages', 'system', 'stream', 'tools', 'tool_choice'])
  const requestParams = payload
    ? Object.entries(payload).filter(([k]) => !PARAM_KEYS.has(k))
    : []

  return (
    <Sheet open={!!record} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col p-0 w-[800px] max-w-full bg-slate-900 border-l border-slate-700/50 text-slate-200">
        <SheetHeader className="px-6 py-4 border-b border-slate-800 shrink-0 bg-slate-900/80 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle className="text-base text-slate-100">Request Detail</SheetTitle>
              <p className="text-xs text-slate-500 font-mono break-all">{record?.requestId}</p>
            </div>
            {payload && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `request-${record?.requestId || 'detail'}.json`
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                }}
                className="px-3 py-1.5 rounded-md text-xs hover:bg-slate-800 transition-colors flex items-center gap-1.5 border border-slate-700/50 text-slate-300 hover:text-white"
                title="Download JSON"
              >
                <Download className="h-4 w-4" />
                <span>Download JSON</span>
              </button>
            )}
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-6 py-4 space-y-4">
            {/* Basic Info */}
            <section>
              <h3 className="text-sm font-semibold mb-3 text-cyan-400">Basic Info</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm bg-slate-800/30 p-4 rounded-lg border border-slate-700/30">
                <span className="text-slate-500">Provider</span>
                <span className="text-slate-200">{record?.provider ?? '-'}</span>
                <span className="text-slate-500">Model</span>
                <span className="font-mono text-xs break-all text-fuchsia-300">{record?.model ?? '-'}</span>
                <span className="text-slate-500">Stream</span>
                <Badge variant="outline" className="w-fit bg-slate-800 border-slate-700 text-slate-300">{payload?.stream ? 'true' : 'false'}</Badge>
                <span className="text-slate-500">Duration</span>
                <span className="text-slate-200">{formatLatency(record?.duration)}</span>
                <span className="text-slate-500">TTFT</span>
                <span className="text-slate-200">{formatLatency(record?.timeToFirstToken)}</span>
                <span className="text-slate-500">Input Tokens</span>
                <span className="text-cyan-300">{record?.inputTokens?.toLocaleString() ?? '-'}</span>
                <span className="text-slate-500">Output Tokens</span>
                <span className="text-fuchsia-300">{record?.outputTokens?.toLocaleString() ?? '-'}</span>
              </div>
            </section>

            {/* Messages */}
            <section>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-cyan-400">
                <span>Messages</span>
                {loading && <Skeleton className="h-4 w-16 inline-block bg-slate-800" />}
              </h3>
              {loading ? (
                <Skeleton className="h-16 w-full bg-slate-800" />
              ) : data?.error ? (
                <div className="p-4 bg-slate-800/50 rounded-lg border border-red-500/20">
                  <div className="flex items-center gap-2 text-red-400 text-sm">
                    <AlertCircle className="h-4 w-4" />
                    <span>Request payload not available in logs</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 ml-6">Payload logging may be disabled or logs have been rotated.</p>
                </div>
              ) : !payload ? (
                <div className="p-4 bg-slate-800/50 rounded-lg border border-amber-500/20">
                  <div className="flex items-center gap-2 text-amber-400 text-sm">
                    <AlertCircle className="h-4 w-4" />
                    <span>No payload found</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Assistant Response (if available) */}
                  {data?.responseBody && (
                    <div key="response" className="rounded-lg overflow-hidden border border-slate-700/50 bg-slate-800/20 mb-2">
                      <button
                        onClick={() => setSelectedMessageIndex(selectedMessageIndex === -2 ? null : -2)}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-slate-700/30 transition-colors text-left',
                          selectedMessageIndex === -2 && 'bg-slate-700/40 border-b border-slate-700/50'
                        )}
                      >
                        <Badge variant="outline" className="text-xs shrink-0 bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500 border-opacity-50">assistant</Badge>
                        <span className="text-xs text-slate-500 shrink-0 font-mono">#{payload.messages?.length ? payload.messages.length + 1 : 1}</span>
                        <ChevronDown className={cn(
                          'h-4 w-4 shrink-0 text-slate-500 transition-transform ml-auto',
                          selectedMessageIndex === -2 && 'rotate-180'
                        )} />
                        <span className="truncate text-xs text-slate-300">
                          {data.responseBody.slice(0, 80) + (data.responseBody.length > 80 ? '...' : '')}
                        </span>
                      </button>
                      {selectedMessageIndex === -2 && (
                        <div className="p-4 bg-slate-950">
                          <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-[600px] overflow-y-auto text-emerald-400 font-mono">
                            {JSON.stringify({
                              role: 'assistant',
                              content: data.responseBody
                            }, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Messages in reverse order (newest first, highest number at top) */}
                  {payload.messages?.map((msg, i) => {
                    const actualIndex = payload.messages!.length - i - 1
                    const actualMsg = payload.messages![actualIndex]
                    const displayIndex = payload.messages!.length - i
                    const isUser = actualMsg.role === 'user'
                    return (
                      <div key={actualIndex} className="rounded-lg overflow-hidden border border-slate-700/50 bg-slate-800/20">
                        <button
                          onClick={() => setSelectedMessageIndex(selectedMessageIndex === actualIndex ? null : actualIndex)}
                          className={cn(
                            'w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-slate-700/30 transition-colors text-left',
                            selectedMessageIndex === actualIndex && 'bg-slate-700/40 border-b border-slate-700/50'
                          )}
                        >
                          <Badge variant="outline" className={cn(
                            "text-xs shrink-0 border-opacity-50",
                            isUser ? "bg-cyan-500/10 text-cyan-400 border-cyan-500" : "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500"
                          )}>
                            {actualMsg.role}
                          </Badge>
                          <span className="text-xs text-slate-500 shrink-0 font-mono">#{displayIndex}</span>
                          <ChevronDown className={cn(
                            'h-4 w-4 shrink-0 text-slate-500 transition-transform ml-auto',
                            selectedMessageIndex === actualIndex && 'rotate-180'
                          )} />
                          <span className="truncate text-xs text-slate-300">
                            {typeof actualMsg.content === 'string'
                              ? actualMsg.content.slice(0, 80) + (actualMsg.content.length > 80 ? '...' : '')
                              : `[${actualMsg.content?.length ?? 0} items]`}
                          </span>
                        </button>
                        {selectedMessageIndex === actualIndex && (
                          <div className="p-4 bg-slate-950">
                            <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-[600px] overflow-y-auto text-emerald-400 font-mono">
                              {JSON.stringify(actualMsg, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {/* System message at the end */}
                  {payload.system && (
                    <div className="rounded-lg overflow-hidden border border-slate-700/50 bg-slate-800/20">
                      <button
                        onClick={() => setSelectedMessageIndex(selectedMessageIndex === -1 ? null : -1)}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-slate-700/30 transition-colors text-left',
                          selectedMessageIndex === -1 && 'bg-slate-700/40 border-b border-slate-700/50'
                        )}
                      >
                        <Badge variant="outline" className="text-xs shrink-0 bg-amber-500/10 text-amber-400 border-amber-500 border-opacity-50">system</Badge>
                        <ChevronDown className={cn(
                          'h-4 w-4 shrink-0 text-slate-500 transition-transform ml-auto',
                          selectedMessageIndex === -1 && 'rotate-180'
                        )} />
                        <span className="truncate text-xs text-slate-300">
                          {typeof payload.system === 'string'
                            ? payload.system.slice(0, 80) + (payload.system.length > 80 ? '...' : '')
                            : `[${payload.system?.length ?? 0} items]`}
                        </span>
                      </button>
                      {selectedMessageIndex === -1 && (
                        <div className="p-4 bg-slate-950">
                          <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-[600px] overflow-y-auto text-emerald-400 font-mono">
                            {JSON.stringify({ role: 'system', content: payload.system }, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Request Parameters */}
              {requestParams.length > 0 && (
                <AccordionItem value="params" trigger={<span className="text-cyan-400">Request Parameters</span>} className="mt-4 border-slate-700/50">
                  <div className="space-y-1 text-sm bg-slate-800/30 p-4 rounded-lg border border-slate-700/30 mt-2">
                    {requestParams.map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <span className="text-slate-500 font-mono text-xs shrink-0">{k}:</span>
                        <span className="font-mono text-xs break-all text-slate-300">
                          {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                        </span>
                      </div>
                    ))}
                  </div>
                </AccordionItem>
              )}

              {/* Raw JSON */}
              {payload && (
                <AccordionItem value="raw-json" trigger={<span className="text-cyan-400">Raw JSON</span>} className="mt-4 border-slate-700/50">
                  <pre className="text-xs bg-slate-950 text-blue-400 rounded-md p-4 mt-2 overflow-x-auto max-h-96 border border-slate-700/50 font-mono">
                    {JSON.stringify(payload, null, 2)}
                  </pre>
                </AccordionItem>
              )}
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
