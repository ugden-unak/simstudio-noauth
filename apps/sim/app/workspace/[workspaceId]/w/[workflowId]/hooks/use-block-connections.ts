import { shallow } from 'zustand/shallow'
import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { createLogger } from '@/lib/logs/console-logger'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('useBlockConnections')

interface Field {
  name: string
  type: string
  description?: string
}

export interface ConnectedBlock {
  id: string
  type: string
  outputType: string | string[]
  name: string
  responseFormat?: {
    // Support both formats
    fields?: Field[]
    name?: string
    schema?: {
      type: string
      properties: Record<string, any>
      required?: string[]
    }
  }
}

function parseResponseFormatSafely(responseFormatValue: any, blockId: string): any {
  if (!responseFormatValue) {
    return undefined
  }

  if (typeof responseFormatValue === 'object' && responseFormatValue !== null) {
    return responseFormatValue
  }

  if (typeof responseFormatValue === 'string') {
    const trimmedValue = responseFormatValue.trim()

    if (trimmedValue.startsWith('<') && trimmedValue.includes('>')) {
      return trimmedValue
    }

    if (trimmedValue === '') {
      return undefined
    }

    try {
      return JSON.parse(trimmedValue)
    } catch (error) {
      return undefined
    }
  }
  return undefined
}

// Helper function to extract fields from JSON Schema
function extractFieldsFromSchema(schema: any): Field[] {
  if (!schema || typeof schema !== 'object') {
    return []
  }

  // Handle legacy format with fields array
  if (Array.isArray(schema.fields)) {
    return schema.fields
  }

  // Handle new JSON Schema format
  const schemaObj = schema.schema || schema
  if (!schemaObj || !schemaObj.properties || typeof schemaObj.properties !== 'object') {
    return []
  }

  // Extract fields from schema properties
  return Object.entries(schemaObj.properties).map(([name, prop]: [string, any]) => ({
    name,
    type: prop.type || 'string',
    description: prop.description,
  }))
}

export function useBlockConnections(blockId: string) {
  const { edges, blocks } = useWorkflowStore(
    (state) => ({
      edges: state.edges,
      blocks: state.blocks,
    }),
    shallow
  )

  // Find all blocks along paths leading to this block
  const allPathNodeIds = BlockPathCalculator.findAllPathNodes(edges, blockId)

  // Map each path node to a ConnectedBlock structure
  const allPathConnections = allPathNodeIds
    .map((sourceId) => {
      const sourceBlock = blocks[sourceId]
      if (!sourceBlock) return null

      // Get the response format from the subblock store
      const responseFormatValue = useSubBlockStore.getState().getValue(sourceId, 'responseFormat')

      // Safely parse response format with proper error handling
      const responseFormat = parseResponseFormatSafely(responseFormatValue, sourceId)

      // Get the default output type from the block's outputs
      const defaultOutputs: Field[] = Object.entries(sourceBlock.outputs || {}).map(([key]) => ({
        name: key,
        type: 'string',
      }))

      // Extract fields from the response format using our helper function
      const outputFields = responseFormat ? extractFieldsFromSchema(responseFormat) : defaultOutputs

      return {
        id: sourceBlock.id,
        type: sourceBlock.type,
        outputType: outputFields.map((field: Field) => field.name),
        name: sourceBlock.name,
        responseFormat,
      }
    })
    .filter(Boolean) as ConnectedBlock[]

  // Keep the original incoming connections for compatibility
  const directIncomingConnections = edges
    .filter((edge) => edge.target === blockId)
    .map((edge) => {
      const sourceBlock = blocks[edge.source]
      if (!sourceBlock) return null

      // Get the response format from the subblock store instead
      const responseFormatValue = useSubBlockStore
        .getState()
        .getValue(edge.source, 'responseFormat')

      // Safely parse response format with proper error handling
      const responseFormat = parseResponseFormatSafely(responseFormatValue, edge.source)

      // Get the default output type from the block's outputs
      const defaultOutputs: Field[] = Object.entries(sourceBlock.outputs || {}).map(([key]) => ({
        name: key,
        type: 'string',
      }))

      // Extract fields from the response format using our helper function
      const outputFields = responseFormat ? extractFieldsFromSchema(responseFormat) : defaultOutputs

      return {
        id: sourceBlock.id,
        type: sourceBlock.type,
        outputType: outputFields.map((field: Field) => field.name),
        name: sourceBlock.name,
        responseFormat,
      }
    })
    .filter(Boolean) as ConnectedBlock[]

  return {
    incomingConnections: allPathConnections,
    directIncomingConnections,
    hasIncomingConnections: allPathConnections.length > 0,
  }
}
