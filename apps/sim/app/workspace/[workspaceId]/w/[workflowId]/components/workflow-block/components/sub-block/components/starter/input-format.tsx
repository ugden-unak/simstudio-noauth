import { useRef, useState } from 'react'
import { ChevronDown, Plus, Trash } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'

interface Field {
  id: string
  name: string
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array'
  value?: string
  collapsed?: boolean
}

interface FieldFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: Field[] | null
  disabled?: boolean
  title?: string
  placeholder?: string
  emptyMessage?: string
  showType?: boolean
  showValue?: boolean
  valuePlaceholder?: string
  isConnecting?: boolean
  config?: any
}

// Default values
const DEFAULT_FIELD: Field = {
  id: crypto.randomUUID(),
  name: '',
  type: 'string',
  value: '',
  collapsed: false,
}

export function FieldFormat({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  title = 'Field',
  placeholder = 'fieldName',
  emptyMessage = 'No fields defined',
  showType = true,
  showValue = false,
  valuePlaceholder = 'Enter value or <variable.name>',
  isConnecting = false,
  config,
}: FieldFormatProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<Field[]>(blockId, subBlockId)
  const [tagDropdownStates, setTagDropdownStates] = useState<
    Record<
      string,
      {
        visible: boolean
        cursorPosition: number
      }
    >
  >({})
  const [dragHighlight, setDragHighlight] = useState<Record<string, boolean>>({})
  const valueInputRefs = useRef<Record<string, HTMLInputElement>>({})

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue
  const fields: Field[] = value || []

  // Field operations
  const addField = () => {
    if (isPreview || disabled) return

    const newField: Field = {
      ...DEFAULT_FIELD,
      id: crypto.randomUUID(),
    }
    setStoreValue([...fields, newField])
  }

  const removeField = (id: string) => {
    if (isPreview || disabled) return
    setStoreValue(fields.filter((field: Field) => field.id !== id))
  }

  // Validate field name for API safety
  const validateFieldName = (name: string): string => {
    // Remove only truly problematic characters for JSON/API usage
    // Allow most characters but remove control characters, quotes, and backslashes
    return name.replace(/[\x00-\x1F"\\]/g, '').trim()
  }

  // Tag dropdown handlers
  const handleValueInputChange = (fieldId: string, newValue: string) => {
    const input = valueInputRefs.current[fieldId]
    if (!input) return

    const cursorPosition = input.selectionStart || 0
    const shouldShow = checkTagTrigger(newValue, cursorPosition)

    setTagDropdownStates((prev) => ({
      ...prev,
      [fieldId]: {
        visible: shouldShow.show,
        cursorPosition,
      },
    }))

    updateField(fieldId, 'value', newValue)
  }

  const handleTagSelect = (fieldId: string, newValue: string) => {
    updateField(fieldId, 'value', newValue)
    setTagDropdownStates((prev) => ({
      ...prev,
      [fieldId]: { ...prev[fieldId], visible: false },
    }))
  }

  const handleTagDropdownClose = (fieldId: string) => {
    setTagDropdownStates((prev) => ({
      ...prev,
      [fieldId]: { ...prev[fieldId], visible: false },
    }))
  }

  // Drag and drop handlers for connection blocks
  const handleDragOver = (e: React.DragEvent, fieldId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragHighlight((prev) => ({ ...prev, [fieldId]: true }))
  }

  const handleDragLeave = (e: React.DragEvent, fieldId: string) => {
    e.preventDefault()
    setDragHighlight((prev) => ({ ...prev, [fieldId]: false }))
  }

  const handleDrop = (e: React.DragEvent, fieldId: string) => {
    e.preventDefault()
    setDragHighlight((prev) => ({ ...prev, [fieldId]: false }))

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type === 'connectionBlock' && data.connectionData) {
        const input = valueInputRefs.current[fieldId]
        if (!input) return

        // Focus the input first
        input.focus()

        // Get current cursor position or use end of field
        const dropPosition = input.selectionStart ?? (input.value?.length || 0)

        // Insert '<' at drop position to trigger the dropdown
        const currentValue = input.value || ''
        const newValue = `${currentValue.slice(0, dropPosition)}<${currentValue.slice(dropPosition)}`

        // Update the field value
        updateField(fieldId, 'value', newValue)

        // Set cursor position and show dropdown
        setTimeout(() => {
          input.selectionStart = dropPosition + 1
          input.selectionEnd = dropPosition + 1

          // Trigger dropdown by simulating the tag check
          const cursorPosition = dropPosition + 1
          const shouldShow = checkTagTrigger(newValue, cursorPosition)

          setTagDropdownStates((prev) => ({
            ...prev,
            [fieldId]: {
              visible: shouldShow.show,
              cursorPosition,
            },
          }))
        }, 0)
      }
    } catch (error) {
      console.error('Error handling drop:', error)
    }
  }

  // Update handlers
  const updateField = (id: string, field: keyof Field, value: any) => {
    if (isPreview || disabled) return

    // Validate field name if it's being updated
    if (field === 'name' && typeof value === 'string') {
      value = validateFieldName(value)
    }

    setStoreValue(fields.map((f: Field) => (f.id === id ? { ...f, [field]: value } : f)))
  }

  const toggleCollapse = (id: string) => {
    if (isPreview || disabled) return
    setStoreValue(fields.map((f: Field) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)))
  }

  // Field header
  const renderFieldHeader = (field: Field, index: number) => {
    const isUnconfigured = !field.name || field.name.trim() === ''

    return (
      <div
        className='flex h-9 cursor-pointer items-center justify-between px-3 py-1'
        onClick={() => toggleCollapse(field.id)}
      >
        <div className='flex items-center'>
          <span
            className={cn(
              'text-sm',
              isUnconfigured ? 'text-muted-foreground/50' : 'text-foreground'
            )}
          >
            {field.name ? field.name : `${title} ${index + 1}`}
          </span>
          {field.name && showType && (
            <Badge variant='outline' className='ml-2 h-5 bg-muted py-0 font-normal text-xs'>
              {field.type}
            </Badge>
          )}
        </div>
        <div className='flex items-center gap-1' onClick={(e) => e.stopPropagation()}>
          <Button
            variant='ghost'
            size='icon'
            onClick={addField}
            disabled={isPreview || disabled}
            className='h-6 w-6 rounded-full'
          >
            <Plus className='h-3.5 w-3.5' />
            <span className='sr-only'>Add {title}</span>
          </Button>

          <Button
            variant='ghost'
            size='icon'
            onClick={() => removeField(field.id)}
            disabled={isPreview || disabled}
            className='h-6 w-6 rounded-full text-destructive hover:text-destructive'
          >
            <Trash className='h-3.5 w-3.5' />
            <span className='sr-only'>Delete Field</span>
          </Button>
        </div>
      </div>
    )
  }

  // Main render
  return (
    <div className='space-y-2'>
      {fields.length === 0 ? (
        <div className='flex flex-col items-center justify-center rounded-md border border-input/50 border-dashed py-8'>
          <p className='mb-3 text-muted-foreground text-sm'>{emptyMessage}</p>
          <Button
            variant='outline'
            size='sm'
            onClick={addField}
            disabled={isPreview || disabled}
            className='h-8'
          >
            <Plus className='mr-1.5 h-3.5 w-3.5' />
            Add {title}
          </Button>
        </div>
      ) : (
        fields.map((field, index) => {
          const isUnconfigured = !field.name || field.name.trim() === ''

          return (
            <div
              key={field.id}
              data-field-id={field.id}
              className={cn(
                'rounded-md border shadow-sm',
                isUnconfigured ? 'border-input/50' : 'border-input',
                field.collapsed ? 'overflow-hidden' : 'overflow-visible'
              )}
            >
              {renderFieldHeader(field, index)}

              {!field.collapsed && (
                <div className='space-y-2 border-t px-3 pt-1.5 pb-2'>
                  <div className='space-y-1.5'>
                    <Label className='text-xs'>Name</Label>
                    <Input
                      name='name'
                      value={field.name}
                      onChange={(e) => updateField(field.id, 'name', e.target.value)}
                      placeholder={placeholder}
                      disabled={isPreview || disabled}
                      className='h-9 placeholder:text-muted-foreground/50'
                    />
                  </div>

                  {showType && (
                    <div className='space-y-1.5'>
                      <Label className='text-xs'>Type</Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant='outline'
                            disabled={isPreview || disabled}
                            className='h-9 w-full justify-between font-normal'
                          >
                            <div className='flex items-center'>
                              <span>{field.type}</span>
                            </div>
                            <ChevronDown className='h-4 w-4 opacity-50' />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end' className='w-[200px]'>
                          <DropdownMenuItem
                            onClick={() => updateField(field.id, 'type', 'string')}
                            className='cursor-pointer'
                          >
                            <span className='mr-2 font-mono'>Aa</span>
                            <span>String</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateField(field.id, 'type', 'number')}
                            className='cursor-pointer'
                          >
                            <span className='mr-2 font-mono'>123</span>
                            <span>Number</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateField(field.id, 'type', 'boolean')}
                            className='cursor-pointer'
                          >
                            <span className='mr-2 font-mono'>0/1</span>
                            <span>Boolean</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateField(field.id, 'type', 'object')}
                            className='cursor-pointer'
                          >
                            <span className='mr-2 font-mono'>{'{}'}</span>
                            <span>Object</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateField(field.id, 'type', 'array')}
                            className='cursor-pointer'
                          >
                            <span className='mr-2 font-mono'>[]</span>
                            <span>Array</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  {showValue && (
                    <div className='space-y-1.5'>
                      <Label className='text-xs'>Value</Label>
                      <div className='relative'>
                        <Input
                          ref={(el) => {
                            if (el) valueInputRefs.current[field.id] = el
                          }}
                          name='value'
                          value={field.value || ''}
                          onChange={(e) => handleValueInputChange(field.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              handleTagDropdownClose(field.id)
                            }
                          }}
                          onDragOver={(e) => handleDragOver(e, field.id)}
                          onDragLeave={(e) => handleDragLeave(e, field.id)}
                          onDrop={(e) => handleDrop(e, field.id)}
                          placeholder={valuePlaceholder}
                          disabled={isPreview || disabled}
                          className={cn(
                            'h-9 text-transparent caret-foreground placeholder:text-muted-foreground/50',
                            dragHighlight[field.id] && 'ring-2 ring-blue-500 ring-offset-2',
                            isConnecting &&
                              config?.connectionDroppable !== false &&
                              'ring-2 ring-blue-500 ring-offset-2 focus-visible:ring-blue-500'
                          )}
                        />
                        {field.value && (
                          <div className='pointer-events-none absolute inset-0 flex items-center px-3 py-2'>
                            <div className='w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm'>
                              {formatDisplayText(field.value, true)}
                            </div>
                          </div>
                        )}
                        <TagDropdown
                          visible={tagDropdownStates[field.id]?.visible || false}
                          onSelect={(newValue) => handleTagSelect(field.id, newValue)}
                          blockId={blockId}
                          activeSourceBlockId={null}
                          inputValue={field.value || ''}
                          cursorPosition={tagDropdownStates[field.id]?.cursorPosition || 0}
                          onClose={() => handleTagDropdownClose(field.id)}
                          style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            right: 0,
                            zIndex: 9999,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

// Export specific components for backward compatibility
export function InputFormat(
  props: Omit<FieldFormatProps, 'title' | 'placeholder' | 'emptyMessage'>
) {
  return (
    <FieldFormat
      {...props}
      title='Field'
      placeholder='firstName'
      emptyMessage='No input fields defined'
    />
  )
}

export function ResponseFormat(
  props: Omit<
    FieldFormatProps,
    'title' | 'placeholder' | 'emptyMessage' | 'showType' | 'showValue' | 'valuePlaceholder'
  >
) {
  return (
    <FieldFormat
      {...props}
      title='Field'
      placeholder='output'
      emptyMessage='No response fields defined'
      showType={false}
      showValue={true}
      valuePlaceholder='Enter value or <variable.name>'
    />
  )
}

export type { Field as InputField, Field as ResponseField }
