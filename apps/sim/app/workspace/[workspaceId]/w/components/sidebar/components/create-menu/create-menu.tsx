'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { logger } from '@sentry/nextjs'
import { File, Folder, Plus, Upload } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { generateFolderName } from '@/lib/naming'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/components/providers/workspace-permissions-provider'
import { useFolderStore } from '@/stores/folders/store'
import { ImportControls, type ImportControlsRef } from './import-controls'

interface CreateMenuProps {
  onCreateWorkflow: (folderId?: string) => Promise<string>
  isCollapsed?: boolean
  isCreatingWorkflow?: boolean
}

export function CreateMenu({
  onCreateWorkflow,
  isCollapsed,
  isCreatingWorkflow = false,
}: CreateMenuProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [pressTimer, setPressTimer] = useState<NodeJS.Timeout | null>(null)

  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const { createFolder } = useFolderStore()
  const userPermissions = useUserPermissionsContext()

  // Ref for the file input that will be used by ImportControls
  const importControlsRef = useRef<ImportControlsRef>(null)

  const handleCreateWorkflow = useCallback(async () => {
    if (isCreatingWorkflow) {
      logger.info('Workflow creation already in progress, ignoring request')
      return
    }

    setIsOpen(false)

    try {
      // Call the parent's workflow creation function and wait for the ID
      const workflowId = await onCreateWorkflow()

      // Navigate to the new workflow
      if (workflowId) {
        router.push(`/workspace/${workspaceId}/w/${workflowId}`)
      }
    } catch (error) {
      logger.error('Error creating workflow:', { error })
    }
  }, [onCreateWorkflow, isCreatingWorkflow, router, workspaceId])

  const handleCreateFolder = useCallback(async () => {
    setIsOpen(false)

    if (isCreating) {
      logger.info('Folder creation already in progress, ignoring request')
      return
    }

    if (!workspaceId) {
      logger.error('No workspaceId available for folder creation')
      return
    }

    try {
      setIsCreating(true)

      // Generate folder name using fresh data from API
      const folderName = await generateFolderName(workspaceId)

      await createFolder({
        name: folderName,
        workspaceId: workspaceId,
      })

      logger.info(`Created folder: ${folderName}`)
    } catch (error) {
      logger.error('Failed to create folder:', { error })
    } finally {
      setIsCreating(false)
    }
  }, [createFolder, workspaceId])

  const handleImportWorkflow = useCallback(() => {
    setIsOpen(false)
    // Trigger the file upload from ImportControls component
    importControlsRef.current?.triggerFileUpload()
  }, [])

  // Handle direct click for workflow creation
  const handleButtonClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // Clear any existing press timer
      if (pressTimer) {
        window.clearTimeout(pressTimer)
        setPressTimer(null)
      }

      // Direct workflow creation on click
      handleCreateWorkflow()
    },
    [handleCreateWorkflow, pressTimer]
  )

  // Handle hover to show popover
  const handleMouseEnter = useCallback(() => {
    setIsOpen(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (pressTimer) {
      window.clearTimeout(pressTimer)
      setPressTimer(null)
    }
    setIsOpen(false)
  }, [pressTimer])

  // Handle dropdown content hover
  const handlePopoverMouseEnter = useCallback(() => {
    setIsOpen(true)
  }, [])

  const handlePopoverMouseLeave = useCallback(() => {
    setIsOpen(false)
  }, [])

  // Handle right-click to show popover
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsOpen(true)
  }, [])

  // Handle long press to show popover
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      // Left mouse button
      const timer = setTimeout(() => {
        setIsOpen(true)
        setPressTimer(null)
      }, 500) // 500ms for long press
      setPressTimer(timer)
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    if (pressTimer) {
      window.clearTimeout(pressTimer)
      setPressTimer(null)
    }
  }, [pressTimer])

  useEffect(() => {
    return () => {
      if (pressTimer) {
        window.clearTimeout(pressTimer)
      }
    }
  }, [pressTimer])

  return (
    <>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='h-9 w-9 shrink-0 rounded-lg border bg-card shadow-xs hover:bg-accent focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
            title='Create Workflow (Hover, right-click, or long press for more options)'
            disabled={isCreatingWorkflow}
            onClick={handleButtonClick}
            onContextMenu={handleContextMenu}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <Plus className='h-[18px] w-[18px] stroke-[2px]' />
            <span className='sr-only'>Create Workflow</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align={isCollapsed ? 'center' : 'end'}
          side={isCollapsed ? 'right' : undefined}
          sideOffset={0}
          className={cn(
            'fade-in-0 zoom-in-95 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
            'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
            'z-50 animate-in overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
            'data-[state=closed]:animate-out',
            'w-48'
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onMouseEnter={handlePopoverMouseEnter}
          onMouseLeave={handlePopoverMouseLeave}
        >
          <button
            className={cn(
              'flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 font-[380] text-card-foreground text-sm outline-none hover:bg-secondary/50 focus:bg-secondary/50',
              isCreatingWorkflow && 'cursor-not-allowed opacity-50'
            )}
            onClick={handleCreateWorkflow}
            disabled={isCreatingWorkflow}
          >
            <File className='h-4 w-4' />
            {isCreatingWorkflow ? 'Creating...' : 'New workflow'}
          </button>

          <button
            className={cn(
              'flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 font-[380] text-card-foreground text-sm outline-none hover:bg-secondary/50 focus:bg-secondary/50',
              isCreating && 'cursor-not-allowed opacity-50'
            )}
            onClick={handleCreateFolder}
            disabled={isCreating}
          >
            <Folder className='h-4 w-4' />
            {isCreating ? 'Creating...' : 'New folder'}
          </button>

          {userPermissions.canEdit && (
            <button
              className='flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 font-[380] text-card-foreground text-sm outline-none hover:bg-secondary/50 focus:bg-secondary/50'
              onClick={handleImportWorkflow}
            >
              <Upload className='h-4 w-4' />
              Import workflow
            </button>
          )}
        </PopoverContent>
      </Popover>

      {/* Import Controls Component - handles all import functionality */}
      <ImportControls
        ref={importControlsRef}
        disabled={!userPermissions.canEdit}
        onClose={() => setIsOpen(false)}
      />
    </>
  )
}
