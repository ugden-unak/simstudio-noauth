import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console-logger'
import { generateWorkflowYaml } from '@/lib/workflows/yaml-generator'
import { useSubBlockStore } from '../subblock/store'
import { useWorkflowStore } from '../workflow/store'

const logger = createLogger('WorkflowYamlStore')

interface WorkflowYamlState {
  yaml: string
  lastGenerated?: number
}

interface WorkflowYamlActions {
  generateYaml: () => void
  getYaml: () => string
  refreshYaml: () => void
}

type WorkflowYamlStore = WorkflowYamlState & WorkflowYamlActions

/**
 * Get subblock values organized by block for the shared utility
 */
function getSubBlockValues() {
  const workflowState = useWorkflowStore.getState()
  const subBlockStore = useSubBlockStore.getState()

  const subBlockValues: Record<string, Record<string, any>> = {}
  Object.entries(workflowState.blocks).forEach(([blockId]) => {
    subBlockValues[blockId] = {}
    // Get all subblock values for this block
    Object.keys(workflowState.blocks[blockId].subBlocks || {}).forEach((subBlockId) => {
      const value = subBlockStore.getValue(blockId, subBlockId)
      if (value !== undefined) {
        subBlockValues[blockId][subBlockId] = value
      }
    })
  })

  return subBlockValues
}

// Track if subscriptions have been initialized
let subscriptionsInitialized = false

// Track timeout IDs for cleanup
let workflowRefreshTimeoutId: NodeJS.Timeout | null = null
let subBlockRefreshTimeoutId: NodeJS.Timeout | null = null

// Initialize subscriptions lazily
function initializeSubscriptions() {
  if (subscriptionsInitialized) return
  subscriptionsInitialized = true

  // Auto-refresh YAML when workflow state changes
  let lastWorkflowState: { blockCount: number; edgeCount: number } | null = null

  useWorkflowStore.subscribe((state) => {
    const currentState = {
      blockCount: Object.keys(state.blocks).length,
      edgeCount: state.edges.length,
    }

    // Only refresh if the structure has changed
    if (
      !lastWorkflowState ||
      lastWorkflowState.blockCount !== currentState.blockCount ||
      lastWorkflowState.edgeCount !== currentState.edgeCount
    ) {
      lastWorkflowState = currentState

      // Clear existing timeout to properly debounce
      if (workflowRefreshTimeoutId) {
        clearTimeout(workflowRefreshTimeoutId)
      }

      // Debounce the refresh to avoid excessive updates
      const refreshYaml = useWorkflowYamlStore.getState().refreshYaml
      workflowRefreshTimeoutId = setTimeout(() => {
        refreshYaml()
        workflowRefreshTimeoutId = null
      }, 100)
    }
  })

  // Subscribe to subblock store changes
  let lastSubBlockChangeTime = 0

  useSubBlockStore.subscribe((state) => {
    const currentTime = Date.now()

    // Debounce rapid changes
    if (currentTime - lastSubBlockChangeTime > 100) {
      lastSubBlockChangeTime = currentTime

      // Clear existing timeout to properly debounce
      if (subBlockRefreshTimeoutId) {
        clearTimeout(subBlockRefreshTimeoutId)
      }

      const refreshYaml = useWorkflowYamlStore.getState().refreshYaml
      subBlockRefreshTimeoutId = setTimeout(() => {
        refreshYaml()
        subBlockRefreshTimeoutId = null
      }, 100)
    }
  })
}

export const useWorkflowYamlStore = create<WorkflowYamlStore>()(
  devtools(
    (set, get) => ({
      yaml: '',
      lastGenerated: undefined,

      generateYaml: () => {
        // Initialize subscriptions on first use
        initializeSubscriptions()

        const workflowState = useWorkflowStore.getState()
        const subBlockValues = getSubBlockValues()
        const yaml = generateWorkflowYaml(workflowState, subBlockValues)

        set({
          yaml,
          lastGenerated: Date.now(),
        })
      },

      getYaml: () => {
        // Initialize subscriptions on first use
        initializeSubscriptions()

        const currentTime = Date.now()
        const { yaml, lastGenerated } = get()

        // Auto-refresh if data is stale (older than 1 second) or never generated
        if (!lastGenerated || currentTime - lastGenerated > 1000) {
          get().generateYaml()
          return get().yaml
        }

        return yaml
      },

      refreshYaml: () => {
        get().generateYaml()
      },
    }),
    {
      name: 'workflow-yaml-store',
    }
  )
)
