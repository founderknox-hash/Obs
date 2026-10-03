'use client'

import { ArrowUpRight, Cpu, Fingerprint, Layers3, LockKeyhole, Settings2, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { DEFAULT_OPTIONS, type CompilerOptions } from '@/lib/obfuscator/types'

const settings = [
  { key: 'packBytecode', name: 'Packed bytecode', description: 'Rolling encoding for each instruction.', icon: Layers3 },
  { key: 'flattenControlFlow', name: 'Control-flow flattening', description: 'Shuffled records. Nonlinear execution labels.', icon: SlidersHorizontal },
  { key: 'randomizeOpcodes', name: 'Polymorphic handlers', description: 'Remap opcodes, operands, and registers.', icon: Fingerprint },
  { key: 'encodeStrings', name: 'Lazy string decoding', description: 'Independent seeds. Decode on first use.', icon: LockKeyhole },
  { key: 'renameIdentifiers', name: 'Runtime symbol mangling', description: 'Fresh VM identifiers for every build.', icon: Cpu },
  { key: 'compactOutput', name: 'Compact output', description: 'Remove unnecessary whitespace.', icon: Layers3 },
] as const

export function ProtectionPanel({ options, onChange, onDocs, disabled, requireVM, onRequireVMChange }: {
  requireVM: boolean
  onRequireVMChange: (value: boolean) => void
  options: CompilerOptions
  onChange: (options: CompilerOptions) => void
  onDocs: () => void
  disabled: boolean
}) {
  return (
    <aside className="protection-panel panel">
      <div className="panel-heading"><div><SlidersHorizontal className="size-4" /><h2>Configuration</h2></div><Settings2 className="size-4 text-muted-foreground" /></div>
      <div className="config-content">
        <div className="flex flex-col gap-2.5">
          <span className="eyebrow">TARGET ENVIRONMENT</span>
          <div className="runtime-select"><div className="flex items-center gap-2.5"><span className="roblox-mark" aria-hidden="true" /><span>Roblox Luau</span></div><Badge variant="secondary">Fixed</Badge></div>
          <p className="config-hint">{requireVM ? 'Luau VM · VM-only protected build' : 'Native Luau · Script, LocalScript, ModuleScript'}</p>
        </div>
        <Field orientation="horizontal" data-disabled={disabled}>
          <FieldContent>
            <FieldLabel htmlFor="require-vm">Require VM protection</FieldLabel>
            <FieldDescription>{requireVM ? 'Reject unsupported syntax. Never fall back to a source loader.' : 'Native Luau: preserves arbitrary syntax, validates compilation, and needs no loadstring. Not VM protection.'}</FieldDescription>
          </FieldContent>
          <Switch id="require-vm" checked={requireVM} onCheckedChange={onRequireVMChange} disabled={disabled} />
        </Field>
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-2"><span className="eyebrow">TRANSFORMATION PASSES</span><Badge variant="secondary">{requireVM ? Object.values(options).filter(Boolean).length : Number(options.encodeStrings) + Number(options.compactOutput)} / {requireVM ? 6 : 2}</Badge></div>
          <FieldGroup>
            {settings.filter(({ key }) => requireVM || key === 'encodeStrings' || key === 'compactOutput').map(({ key, name, description, icon: Icon }) => (
              <Field key={key} orientation="horizontal" data-disabled={disabled}>
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <FieldContent>
                  <FieldLabel htmlFor={key}>{!requireVM && key === 'encodeStrings' ? 'String byte escaping' : name}</FieldLabel>
                  <FieldDescription>{!requireVM ? (key === 'encodeStrings' ? 'Escape plain quoted literals; preserve complex strings.' : 'Reduce comments and spacing; preserve line breaks.') : description}</FieldDescription>
                </FieldContent>
                <Switch id={key} checked={options[key]} onCheckedChange={checked => onChange({ ...options, [key]: checked })} disabled={disabled} />
              </Field>
            ))}
          </FieldGroup>
        </div>
        <Button variant="outline" size="sm" onClick={() => onChange({ ...DEFAULT_OPTIONS })} disabled={disabled || Object.values(options).every(Boolean)}><ShieldCheck data-icon="inline-start" />Restore hardened defaults</Button>
        <div className="compatibility-note"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /><p>Harder to inspect. Not impossible to reverse.<br /><span>Keep secrets and trusted logic server-side.</span></p></div>
      </div>
      <div className="config-footer"><span>Know what you&apos;re building.</span><Button variant="link" size="sm" onClick={onDocs}>Read the docs <ArrowUpRight data-icon="inline-end" /></Button></div>
    </aside>
  )
}
