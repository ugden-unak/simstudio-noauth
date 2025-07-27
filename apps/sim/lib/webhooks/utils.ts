import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { EnhancedLoggingSession } from '@/lib/logs/enhanced-logging-session'
import { hasProcessedMessage, markMessageAsProcessed } from '@/lib/redis'
import { decryptSecret } from '@/lib/utils'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'
import { db } from '@/db'
import { environment as environmentTable, userStats, webhook } from '@/db/schema'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'
import { mergeSubblockStateAsync } from '@/stores/workflows/server-utils'

const logger = createLogger('WebhookUtils')

/**
 * Handle WhatsApp verification requests
 */
export async function handleWhatsAppVerification(
  requestId: string,
  path: string,
  mode: string | null,
  token: string | null,
  challenge: string | null
): Promise<NextResponse | null> {
  if (mode && token && challenge) {
    // This is a WhatsApp verification request
    logger.info(`[${requestId}] WhatsApp verification request received for path: ${path}`)

    if (mode !== 'subscribe') {
      logger.warn(`[${requestId}] Invalid WhatsApp verification mode: ${mode}`)
      return new NextResponse('Invalid mode', { status: 400 })
    }

    // Find all active WhatsApp webhooks
    const webhooks = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.provider, 'whatsapp'), eq(webhook.isActive, true)))

    // Check if any webhook has a matching verification token
    for (const wh of webhooks) {
      const providerConfig = (wh.providerConfig as Record<string, any>) || {}
      const verificationToken = providerConfig.verificationToken

      if (!verificationToken) {
        logger.debug(`[${requestId}] Webhook ${wh.id} has no verification token, skipping`)
        continue
      }

      if (token === verificationToken) {
        logger.info(`[${requestId}] WhatsApp verification successful for webhook ${wh.id}`)
        // Return ONLY the challenge as plain text (exactly as WhatsApp expects)
        return new NextResponse(challenge, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
          },
        })
      }
    }

    logger.warn(`[${requestId}] No matching WhatsApp verification token found`)
    return new NextResponse('Verification failed', { status: 403 })
  }

  return null
}

/**
 * Handle Slack verification challenges
 */
export function handleSlackChallenge(body: any): NextResponse | null {
  if (body.type === 'url_verification' && body.challenge) {
    return NextResponse.json({ challenge: body.challenge })
  }

  return null
}

/**
 * Validates a Slack webhook request signature using HMAC SHA-256
 * @param signingSecret - Slack signing secret for validation
 * @param signature - X-Slack-Signature header value
 * @param timestamp - X-Slack-Request-Timestamp header value
 * @param body - Raw request body string
 * @returns Whether the signature is valid
 */

export async function validateSlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string
): Promise<boolean> {
  try {
    // Basic validation first
    if (!signingSecret || !signature || !timestamp || !body) {
      return false
    }

    // Check if the timestamp is too old (> 5 minutes)
    const currentTime = Math.floor(Date.now() / 1000)
    if (Math.abs(currentTime - Number.parseInt(timestamp)) > 300) {
      return false
    }

    // Compute the signature
    const encoder = new TextEncoder()
    const baseString = `v0:${timestamp}:${body}`

    // Create the HMAC with the signing secret
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(signingSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(baseString))

    // Convert the signature to hex
    const signatureHex = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    // Prepare the expected signature format
    const computedSignature = `v0=${signatureHex}`

    // Constant-time comparison to prevent timing attacks
    if (computedSignature.length !== signature.length) {
      return false
    }

    let result = 0
    for (let i = 0; i < computedSignature.length; i++) {
      result |= computedSignature.charCodeAt(i) ^ signature.charCodeAt(i)
    }

    return result === 0
  } catch (error) {
    console.error('Error validating Slack signature:', error)
    return false
  }
}

/**
 * Process WhatsApp message deduplication
 */
export async function processWhatsAppDeduplication(
  requestId: string,
  messages: any[]
): Promise<NextResponse | null> {
  if (messages.length > 0) {
    const message = messages[0]
    const messageId = message.id

    if (messageId) {
      const whatsappMsgKey = `whatsapp:msg:${messageId}`

      try {
        const isDuplicate = await hasProcessedMessage(whatsappMsgKey)
        if (isDuplicate) {
          logger.info(`[${requestId}] Duplicate WhatsApp message detected: ${messageId}`)
          return new NextResponse('Duplicate message', { status: 200 })
        }

        // Mark as processed BEFORE processing
        await markMessageAsProcessed(whatsappMsgKey, 60 * 60 * 24)
      } catch (error) {
        logger.error(`[${requestId}] Error in WhatsApp deduplication`, error)
        // Continue processing
      }
    }
  }

  return null
}

/**
 * Process generic deduplication using request hash
 */
export async function processGenericDeduplication(
  requestId: string,
  path: string,
  body: any
): Promise<NextResponse | null> {
  try {
    const requestHash = await generateRequestHash(path, body)
    const genericMsgKey = `generic:${requestHash}`

    const isDuplicate = await hasProcessedMessage(genericMsgKey)
    if (isDuplicate) {
      logger.info(`[${requestId}] Duplicate request detected with hash: ${requestHash}`)
      return new NextResponse('Duplicate request', { status: 200 })
    }

    // Mark as processed
    await markMessageAsProcessed(genericMsgKey, 60 * 60 * 24)
  } catch (error) {
    logger.error(`[${requestId}] Error in generic deduplication`, error)
    // Continue processing
  }

  return null
}

/**
 * Format webhook input based on provider
 */
export function formatWebhookInput(
  foundWebhook: any,
  foundWorkflow: any,
  body: any,
  request: NextRequest
): any {
  if (foundWebhook.provider === 'whatsapp') {
    // WhatsApp input formatting logic
    const data = body?.entry?.[0]?.changes?.[0]?.value
    const messages = data?.messages || []

    if (messages.length > 0) {
      const message = messages[0]
      const phoneNumberId = data.metadata?.phone_number_id
      const from = message.from
      const messageId = message.id
      const timestamp = message.timestamp
      const text = message.text?.body

      return {
        whatsapp: {
          data: {
            messageId,
            from,
            phoneNumberId,
            text,
            timestamp,
            raw: message,
          },
        },
        webhook: {
          data: {
            provider: 'whatsapp',
            path: foundWebhook.path,
            providerConfig: foundWebhook.providerConfig,
            payload: body,
            headers: Object.fromEntries(request.headers.entries()),
            method: request.method,
          },
        },
        workflowId: foundWorkflow.id,
      }
    }
    return null
  }

  if (foundWebhook.provider === 'telegram') {
    // Telegram input formatting logic
    const message =
      body?.message || body?.edited_message || body?.channel_post || body?.edited_channel_post

    if (message) {
      // Extract message text with fallbacks for different content types
      let input = ''

      if (message.text) {
        input = message.text
      } else if (message.caption) {
        input = message.caption
      } else if (message.photo) {
        input = 'Photo message'
      } else if (message.document) {
        input = `Document: ${message.document.file_name || 'file'}`
      } else if (message.audio) {
        input = `Audio: ${message.audio.title || 'audio file'}`
      } else if (message.video) {
        input = 'Video message'
      } else if (message.voice) {
        input = 'Voice message'
      } else if (message.sticker) {
        input = `Sticker: ${message.sticker.emoji || '🎭'}`
      } else if (message.location) {
        input = 'Location shared'
      } else if (message.contact) {
        input = `Contact: ${message.contact.first_name || 'contact'}`
      } else if (message.poll) {
        input = `Poll: ${message.poll.question}`
      } else {
        input = 'Message received'
      }

      return {
        input, // Primary workflow input - the message content
        telegram: {
          message: {
            id: message.message_id,
            text: message.text,
            caption: message.caption,
            date: message.date,
            messageType: message.photo
              ? 'photo'
              : message.document
                ? 'document'
                : message.audio
                  ? 'audio'
                  : message.video
                    ? 'video'
                    : message.voice
                      ? 'voice'
                      : message.sticker
                        ? 'sticker'
                        : message.location
                          ? 'location'
                          : message.contact
                            ? 'contact'
                            : message.poll
                              ? 'poll'
                              : 'text',
            raw: message,
          },
          sender: message.from
            ? {
                id: message.from.id,
                firstName: message.from.first_name,
                lastName: message.from.last_name,
                username: message.from.username,
                languageCode: message.from.language_code,
                isBot: message.from.is_bot,
              }
            : null,
          chat: message.chat
            ? {
                id: message.chat.id,
                type: message.chat.type,
                title: message.chat.title,
                username: message.chat.username,
                firstName: message.chat.first_name,
                lastName: message.chat.last_name,
              }
            : null,
          updateId: body.update_id,
          updateType: body.message
            ? 'message'
            : body.edited_message
              ? 'edited_message'
              : body.channel_post
                ? 'channel_post'
                : body.edited_channel_post
                  ? 'edited_channel_post'
                  : 'unknown',
        },
        webhook: {
          data: {
            provider: 'telegram',
            path: foundWebhook.path,
            providerConfig: foundWebhook.providerConfig,
            payload: body,
            headers: Object.fromEntries(request.headers.entries()),
            method: request.method,
          },
        },
        workflowId: foundWorkflow.id,
      }
    }

    // Fallback for unknown Telegram update types
    logger.warn('Unknown Telegram update type', {
      updateId: body.update_id,
      bodyKeys: Object.keys(body || {}),
    })

    return {
      input: 'Telegram update received',
      telegram: {
        updateId: body.update_id,
        updateType: 'unknown',
        raw: body,
      },
      webhook: {
        data: {
          provider: 'telegram',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'gmail') {
    if (body && typeof body === 'object' && 'email' in body) {
      return body // { email: {...}, timestamp: ... }
    }
    return body
  }

  if (foundWebhook.provider === 'microsoftteams') {
    // Microsoft Teams outgoing webhook - Teams sending data to us
    const messageText = body?.text || ''
    const messageId = body?.id || ''
    const timestamp = body?.timestamp || body?.localTimestamp || ''
    const from = body?.from || {}
    const conversation = body?.conversation || {}

    return {
      input: messageText, // Primary workflow input - the message text
      microsoftteams: {
        message: {
          id: messageId,
          text: messageText,
          timestamp,
          type: body?.type || 'message',
          serviceUrl: body?.serviceUrl,
          channelId: body?.channelId,
          raw: body,
        },
        from: {
          id: from.id,
          name: from.name,
          aadObjectId: from.aadObjectId,
        },
        conversation: {
          id: conversation.id,
          name: conversation.name,
          conversationType: conversation.conversationType,
          tenantId: conversation.tenantId,
        },
        activity: {
          type: body?.type,
          id: body?.id,
          timestamp: body?.timestamp,
          localTimestamp: body?.localTimestamp,
          serviceUrl: body?.serviceUrl,
          channelId: body?.channelId,
        },
      },
      webhook: {
        data: {
          provider: 'microsoftteams',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  // Generic format for Slack and other providers
  return {
    webhook: {
      data: {
        path: foundWebhook.path,
        provider: foundWebhook.provider,
        providerConfig: foundWebhook.providerConfig,
        payload: body,
        headers: Object.fromEntries(request.headers.entries()),
        method: request.method,
      },
    },
    workflowId: foundWorkflow.id,
  }
}

/**
 * Execute workflow with the provided input
 */
export async function executeWorkflowFromPayload(
  foundWorkflow: any,
  input: any,
  executionId: string,
  requestId: string,
  startBlockId?: string | null
): Promise<void> {
  // Add log at the beginning of this function for clarity
  logger.info(`[${requestId}] Preparing to execute workflow`, {
    workflowId: foundWorkflow.id,
    executionId,
    triggerSource: 'webhook-payload',
  })

  const loggingSession = new EnhancedLoggingSession(
    foundWorkflow.id,
    executionId,
    'webhook',
    requestId
  )

  try {
    // Load workflow data from normalized tables
    logger.debug(`[${requestId}] Loading workflow ${foundWorkflow.id} from normalized tables`)
    const normalizedData = await loadWorkflowFromNormalizedTables(foundWorkflow.id)

    if (!normalizedData) {
      logger.error(`[${requestId}] TRACE: No normalized data found for workflow`, {
        workflowId: foundWorkflow.id,
        hasNormalizedData: false,
      })
      throw new Error(`Workflow ${foundWorkflow.id} data not found in normalized tables`)
    }

    // Use normalized data for execution
    const { blocks, edges, loops, parallels } = normalizedData
    logger.info(`[${requestId}] Loaded workflow ${foundWorkflow.id} from normalized tables`)

    // DEBUG: Log state information
    logger.debug(`[${requestId}] TRACE: Retrieved workflow state from normalized tables`, {
      workflowId: foundWorkflow.id,
      blockCount: Object.keys(blocks || {}).length,
      edgeCount: (edges || []).length,
      loopCount: Object.keys(loops || {}).length,
    })

    logger.debug(
      `[${requestId}] Merging subblock states for workflow ${foundWorkflow.id} (Execution: ${executionId})`
    )

    const mergeStartTime = Date.now()
    const mergedStates = await mergeSubblockStateAsync(blocks, foundWorkflow.id)
    logger.debug(`[${requestId}] TRACE: State merging complete`, {
      duration: `${Date.now() - mergeStartTime}ms`,
      mergedBlockCount: Object.keys(mergedStates).length,
    })

    // Retrieve and decrypt environment variables
    const [userEnv] = await db
      .select()
      .from(environmentTable)
      .where(eq(environmentTable.userId, foundWorkflow.userId))
      .limit(1)
    let decryptedEnvVars: Record<string, string> = {}
    if (userEnv) {
      // Decryption logic
      const decryptionPromises = Object.entries((userEnv.variables as any) || {}).map(
        async ([key, encryptedValue]) => {
          try {
            const { decrypted } = await decryptSecret(encryptedValue as string)
            return [key, decrypted] as const
          } catch (error: any) {
            logger.error(
              `[${requestId}] Failed to decrypt environment variable "${key}" (Execution: ${executionId})`,
              error
            )
            throw new Error(`Failed to decrypt environment variable "${key}": ${error.message}`)
          }
        }
      )
      const decryptedEntries = await Promise.all(decryptionPromises)
      decryptedEnvVars = Object.fromEntries(decryptedEntries)
    } else {
      logger.debug(`[${requestId}] TRACE: No environment variables found for user`, {
        userId: foundWorkflow.userId,
      })
    }

    await loggingSession.safeStart({
      userId: foundWorkflow.userId,
      workspaceId: foundWorkflow.workspaceId,
      variables: decryptedEnvVars,
    })

    // Process block states (extract subBlock values, parse responseFormat)
    const blockStatesStartTime = Date.now()
    const currentBlockStates = Object.entries(mergedStates).reduce(
      (acc, [id, block]) => {
        acc[id] = Object.entries(block.subBlocks).reduce(
          (subAcc, [key, subBlock]) => {
            subAcc[key] = subBlock.value
            return subAcc
          },
          {} as Record<string, any>
        )
        return acc
      },
      {} as Record<string, Record<string, any>>
    )

    const processedBlockStates = Object.entries(currentBlockStates).reduce(
      (acc, [blockId, blockState]) => {
        const processedState = { ...blockState }
        if (processedState.responseFormat) {
          try {
            if (typeof processedState.responseFormat === 'string') {
              processedState.responseFormat = JSON.parse(processedState.responseFormat)
            }
            if (
              processedState.responseFormat &&
              typeof processedState.responseFormat === 'object'
            ) {
              if (!processedState.responseFormat.schema && !processedState.responseFormat.name) {
                processedState.responseFormat = {
                  name: 'response_schema',
                  schema: processedState.responseFormat,
                  strict: true,
                }
              }
            }
            acc[blockId] = processedState
          } catch (error) {
            logger.warn(
              `[${requestId}] Failed to parse responseFormat for block ${blockId} (Execution: ${executionId})`,
              error
            )
            acc[blockId] = blockState
          }
        } else {
          acc[blockId] = blockState
        }
        return acc
      },
      {} as Record<string, Record<string, any>>
    )

    // DEBUG: Log block state processing
    logger.debug(`[${requestId}] TRACE: Block states processed`, {
      duration: `${Date.now() - blockStatesStartTime}ms`,
      blockCount: Object.keys(processedBlockStates).length,
    })

    // Serialize and get workflow variables
    const serializeStartTime = Date.now()
    const serializedWorkflow = new Serializer().serializeWorkflow(
      mergedStates as any,
      edges,
      loops,
      parallels
    )
    let workflowVariables = {}
    if (foundWorkflow.variables) {
      try {
        if (typeof foundWorkflow.variables === 'string') {
          workflowVariables = JSON.parse(foundWorkflow.variables)
        } else {
          workflowVariables = foundWorkflow.variables
        }
      } catch (error) {
        logger.error(
          `[${requestId}] Failed to parse workflow variables: ${foundWorkflow.id} (Execution: ${executionId})`,
          error
        )
      }
    }

    // DEBUG: Log serialization completion
    logger.debug(`[${requestId}] TRACE: Workflow serialized`, {
      duration: `${Date.now() - serializeStartTime}ms`,
      hasWorkflowVars: Object.keys(workflowVariables).length > 0,
    })

    logger.debug(`[${requestId}] Starting workflow execution`, {
      executionId,
      blockCount: Object.keys(processedBlockStates).length,
    })

    // Log blocks for debugging (if any missing or invalid)
    if (Object.keys(processedBlockStates).length === 0) {
      logger.error(`[${requestId}] No blocks found in workflow state - this will likely fail`)
    } else {
      logger.debug(`[${requestId}] Block IDs for execution:`, {
        blockIds: Object.keys(processedBlockStates).slice(0, 5), // Log just a few block IDs for debugging
        totalBlocks: Object.keys(processedBlockStates).length,
      })
    }

    // Ensure workflow variables exist
    if (!workflowVariables || Object.keys(workflowVariables).length === 0) {
      logger.debug(`[${requestId}] No workflow variables defined, using empty object`)
      workflowVariables = {}
    }

    // Validate input format for Airtable webhooks to prevent common errors
    if (
      input?.airtableChanges &&
      (!Array.isArray(input.airtableChanges) || input.airtableChanges.length === 0)
    ) {
      logger.warn(
        `[${requestId}] Invalid Airtable input format - airtableChanges should be a non-empty array`
      )
    }

    // DEBUG: Log critical moment before executor creation
    logger.info(`[${requestId}] TRACE: Creating workflow executor`, {
      workflowId: foundWorkflow.id,
      hasSerializedWorkflow: !!serializedWorkflow,
      blockCount: Object.keys(processedBlockStates).length,
      timestamp: new Date().toISOString(),
    })

    const executor = new Executor(
      serializedWorkflow,
      processedBlockStates,
      decryptedEnvVars,
      input,
      workflowVariables
    )

    // Set up enhanced logging on the executor
    loggingSession.setupExecutor(executor)

    // Log workflow execution start time for tracking
    const executionStartTime = Date.now()
    logger.info(`[${requestId}] TRACE: Executor instantiated, starting workflow execution now`, {
      workflowId: foundWorkflow.id,
      timestamp: new Date().toISOString(),
    })

    // Add direct detailed logging right before executing
    logger.info(
      `[${requestId}] EXECUTION_MONITOR: About to call executor.execute() - CRITICAL POINT`,
      {
        workflowId: foundWorkflow.id,
        executionId: executionId,
        timestamp: new Date().toISOString(),
      }
    )

    // This is THE critical line where the workflow actually executes
    const result = await executor.execute(foundWorkflow.id, startBlockId || undefined)

    // Check if we got a StreamingExecution result (with stream + execution properties)
    // For webhook executions, we only care about the ExecutionResult part, not the stream
    const executionResult = 'stream' in result && 'execution' in result ? result.execution : result

    // Add direct detailed logging right after executing
    logger.info(`[${requestId}] EXECUTION_MONITOR: executor.execute() completed with result`, {
      workflowId: foundWorkflow.id,
      executionId: executionId,
      success: executionResult.success,
      resultType: result ? typeof result : 'undefined',
      timestamp: new Date().toISOString(),
    })

    // Log completion and timing
    const executionDuration = Date.now() - executionStartTime
    logger.info(`[${requestId}] TRACE: Workflow execution completed`, {
      workflowId: foundWorkflow.id,
      success: executionResult.success,
      duration: `${executionDuration}ms`,
      actualDurationMs: executionDuration,
      timestamp: new Date().toISOString(),
    })

    logger.info(`[${requestId}] Workflow execution finished`, {
      executionId,
      success: executionResult.success,
      durationMs: executionResult.metadata?.duration || executionDuration,
      actualDurationMs: executionDuration,
    })

    // Update counts and stats if successful
    if (executionResult.success) {
      await updateWorkflowRunCounts(foundWorkflow.id)
      await db
        .update(userStats)
        .set({
          totalWebhookTriggers: sql`total_webhook_triggers + 1`,
          lastActive: new Date(),
        })
        .where(eq(userStats.userId, foundWorkflow.userId))
    }

    // Calculate total duration for enhanced logging
    const totalDuration = executionResult.metadata?.duration || 0

    const traceSpans = (executionResult.logs || []).map((blockLog: any, index: number) => {
      let output = blockLog.output
      if (!blockLog.success && blockLog.error) {
        output = {
          error: blockLog.error,
          success: false,
          ...(blockLog.output || {}),
        }
      }

      return {
        id: blockLog.blockId,
        name: `Block ${blockLog.blockName || blockLog.blockType} (${blockLog.blockType || 'unknown'})`,
        type: blockLog.blockType || 'unknown',
        duration: blockLog.durationMs || 0,
        startTime: blockLog.startedAt,
        endTime: blockLog.endedAt || blockLog.startedAt,
        status: blockLog.success ? 'success' : 'error',
        blockId: blockLog.blockId,
        input: blockLog.input,
        output: output,
        tokens: blockLog.output?.tokens?.total || 0,
        relativeStartMs: index * 100,
        children: [],
        toolCalls: (blockLog as any).toolCalls || [],
      }
    })

    await loggingSession.safeComplete({
      endedAt: new Date().toISOString(),
      totalDurationMs: totalDuration || 0,
      finalOutput: executionResult.output || {},
      traceSpans: (traceSpans || []) as any,
    })

    // DEBUG: Final success log
    logger.info(`[${requestId}] TRACE: Execution logs persisted successfully`, {
      workflowId: foundWorkflow.id,
      executionId,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    // DEBUG: Detailed error information
    logger.error(`[${requestId}] TRACE: Error during workflow execution`, {
      workflowId: foundWorkflow.id,
      executionId,
      errorType: error.constructor.name,
      errorMessage: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    })

    logger.error(`[${requestId}] Error executing workflow`, {
      workflowId: foundWorkflow.id,
      executionId,
      error: error.message,
      stack: error.stack,
    })
    // Error logging handled by enhanced logging session

    await loggingSession.safeCompleteWithError({
      endedAt: new Date().toISOString(),
      totalDurationMs: 0,
      error: {
        message: error.message || 'Webhook workflow execution failed',
        stackTrace: error.stack,
      },
    })

    // Re-throw the error so the caller knows it failed
    throw error
  }
}

/**
 * Validates a Microsoft Teams outgoing webhook request signature using HMAC SHA-256
 * @param hmacSecret - Microsoft Teams HMAC secret (base64 encoded)
 * @param signature - Authorization header value (should start with 'HMAC ')
 * @param body - Raw request body string
 * @returns Whether the signature is valid
 */
export function validateMicrosoftTeamsSignature(
  hmacSecret: string,
  signature: string,
  body: string
): boolean {
  try {
    // Basic validation first
    if (!hmacSecret || !signature || !body) {
      return false
    }

    // Check if signature has correct format
    if (!signature.startsWith('HMAC ')) {
      return false
    }

    const providedSignature = signature.substring(5) // Remove 'HMAC ' prefix

    // Compute HMAC SHA256 signature using Node.js crypto
    const crypto = require('crypto')
    const secretBytes = Buffer.from(hmacSecret, 'base64')
    const bodyBytes = Buffer.from(body, 'utf8')
    const computedHash = crypto.createHmac('sha256', secretBytes).update(bodyBytes).digest('base64')

    // Constant-time comparison to prevent timing attacks
    if (computedHash.length !== providedSignature.length) {
      return false
    }

    let result = 0
    for (let i = 0; i < computedHash.length; i++) {
      result |= computedHash.charCodeAt(i) ^ providedSignature.charCodeAt(i)
    }

    return result === 0
  } catch (error) {
    console.error('Error validating Microsoft Teams signature:', error)
    return false
  }
}

/**
 * Process webhook provider-specific verification
 */
export function verifyProviderWebhook(
  foundWebhook: any,
  request: NextRequest,
  requestId: string
): NextResponse | null {
  const authHeader = request.headers.get('authorization')
  const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
  // Keep existing switch statement for github, stripe, generic, default
  switch (foundWebhook.provider) {
    case 'github':
      break // No specific auth here
    case 'stripe':
      break // Stripe verification would go here
    case 'gmail':
      if (providerConfig.secret) {
        const secretHeader = request.headers.get('X-Webhook-Secret')
        if (!secretHeader || secretHeader.length !== providerConfig.secret.length) {
          logger.warn(`[${requestId}] Invalid Gmail webhook secret`)
          return new NextResponse('Unauthorized', { status: 401 })
        }
        let result = 0
        for (let i = 0; i < secretHeader.length; i++) {
          result |= secretHeader.charCodeAt(i) ^ providerConfig.secret.charCodeAt(i)
        }
        if (result !== 0) {
          logger.warn(`[${requestId}] Invalid Gmail webhook secret`)
          return new NextResponse('Unauthorized', { status: 401 })
        }
      }
      break
    case 'telegram': {
      // Check User-Agent to ensure it's not blocked by middleware
      // Log the user agent for debugging purposes
      const userAgent = request.headers.get('user-agent') || ''
      logger.debug(`[${requestId}] Telegram webhook request received with User-Agent: ${userAgent}`)

      // Check if the user agent is empty and warn about it
      if (!userAgent) {
        logger.warn(
          `[${requestId}] Telegram webhook request has empty User-Agent header. This may be blocked by middleware.`
        )
      }

      // We'll accept the request anyway since we're in the provider-specific logic,
      // but we'll log the information for debugging

      // Telegram uses IP addresses in specific ranges
      // This is optional verification that could be added if IP verification is needed
      const clientIp =
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        request.headers.get('x-real-ip') ||
        'unknown'

      logger.debug(`[${requestId}] Telegram webhook request from IP: ${clientIp}`)

      break
    }
    case 'microsoftteams':
      // Microsoft Teams webhook authentication is handled separately in the main flow
      // due to the need for raw body access for HMAC verification
      break
    case 'generic':
      // Generic auth logic: requireAuth, token, secretHeaderName, allowedIps
      if (providerConfig.requireAuth) {
        let isAuthenticated = false
        // Check for token in Authorization header (Bearer token)
        if (providerConfig.token) {
          const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
          if (providedToken === providerConfig.token) {
            isAuthenticated = true
          }
          // Check for token in custom header if specified
          if (!isAuthenticated && providerConfig.secretHeaderName) {
            const customHeaderValue = request.headers.get(providerConfig.secretHeaderName)
            if (customHeaderValue === providerConfig.token) {
              isAuthenticated = true
            }
          }
          // Return 401 if authentication failed
          if (!isAuthenticated) {
            logger.warn(`[${requestId}] Unauthorized webhook access attempt - invalid token`)
            return new NextResponse('Unauthorized', { status: 401 })
          }
        }
      }
      // IP restriction check
      if (
        providerConfig.allowedIps &&
        Array.isArray(providerConfig.allowedIps) &&
        providerConfig.allowedIps.length > 0
      ) {
        const clientIp =
          request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
          request.headers.get('x-real-ip') ||
          'unknown'

        if (clientIp === 'unknown' || !providerConfig.allowedIps.includes(clientIp)) {
          logger.warn(
            `[${requestId}] Forbidden webhook access attempt - IP not allowed: ${clientIp}`
          )
          return new NextResponse('Forbidden - IP not allowed', {
            status: 403,
          })
        }
      }
      break
    default:
      if (providerConfig.token) {
        const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
        if (!providedToken || providedToken !== providerConfig.token) {
          logger.warn(`[${requestId}] Unauthorized webhook access attempt - invalid token`)
          return new NextResponse('Unauthorized', { status: 401 })
        }
      }
  }

  return null
}

/**
 * Process Airtable payloads
 */
export async function fetchAndProcessAirtablePayloads(
  webhookData: any,
  workflowData: any,
  requestId: string // Original request ID from the ping, used for the final execution log
) {
  // Enhanced logging handles all error logging
  let currentCursor: number | null = null
  let mightHaveMore = true
  let payloadsFetched = 0 // Track total payloads fetched
  let apiCallCount = 0
  // Use a Map to consolidate changes per record ID
  const consolidatedChangesMap = new Map<string, AirtableChange>()
  const localProviderConfig = {
    ...((webhookData.providerConfig as Record<string, any>) || {}),
  } // Local copy

  // DEBUG: Log start of function execution with critical info
  logger.debug(`[${requestId}] TRACE: fetchAndProcessAirtablePayloads started`, {
    webhookId: webhookData.id,
    workflowId: workflowData.id,
    hasBaseId: !!localProviderConfig.baseId,
    hasExternalId: !!localProviderConfig.externalId,
  })

  try {
    // --- Essential IDs & Config from localProviderConfig ---
    const baseId = localProviderConfig.baseId
    const airtableWebhookId = localProviderConfig.externalId

    if (!baseId || !airtableWebhookId) {
      logger.error(
        `[${requestId}] Missing baseId or externalId in providerConfig for webhook ${webhookData.id}. Cannot fetch payloads.`
      )
      // Error logging handled by enhanced logging session
      return // Exit early
    }

    // --- Retrieve Stored Cursor from localProviderConfig ---
    const storedCursor = localProviderConfig.externalWebhookCursor

    // Initialize cursor in provider config if missing
    if (storedCursor === undefined || storedCursor === null) {
      logger.info(
        `[${requestId}] No cursor found in providerConfig for webhook ${webhookData.id}, initializing...`
      )
      // Update the local copy
      localProviderConfig.externalWebhookCursor = null

      // Add cursor to the database immediately to fix the configuration
      try {
        await db
          .update(webhook)
          .set({
            providerConfig: {
              ...localProviderConfig,
              externalWebhookCursor: null,
            },
            updatedAt: new Date(),
          })
          .where(eq(webhook.id, webhookData.id))

        localProviderConfig.externalWebhookCursor = null // Update local copy too
        logger.info(`[${requestId}] Successfully initialized cursor for webhook ${webhookData.id}`)
      } catch (initError: any) {
        logger.error(`[${requestId}] Failed to initialize cursor in DB`, {
          webhookId: webhookData.id,
          error: initError.message,
          stack: initError.stack,
        })
        // Error logging handled by enhanced logging session
      }
    }

    if (storedCursor && typeof storedCursor === 'number') {
      currentCursor = storedCursor
      logger.debug(
        `[${requestId}] Using stored cursor: ${currentCursor} for webhook ${webhookData.id}`
      )
    } else {
      currentCursor = null // Airtable API defaults to 1 if omitted
      logger.debug(
        `[${requestId}] No valid stored cursor for webhook ${webhookData.id}, starting from beginning`
      )
    }

    // --- Get OAuth Token ---
    let accessToken: string | null = null
    try {
      accessToken = await getOAuthToken(workflowData.userId, 'airtable')
      if (!accessToken) {
        logger.error(
          `[${requestId}] Failed to obtain valid Airtable access token. Cannot proceed.`,
          { userId: workflowData.userId }
        )
        throw new Error('Airtable access token not found.')
      }

      logger.info(`[${requestId}] Successfully obtained Airtable access token`)
    } catch (tokenError: any) {
      logger.error(
        `[${requestId}] Failed to get Airtable OAuth token for user ${workflowData.userId}`,
        {
          error: tokenError.message,
          stack: tokenError.stack,
          userId: workflowData.userId,
        }
      )
      // Error logging handled by enhanced logging session
      return // Exit early
    }

    const airtableApiBase = 'https://api.airtable.com/v0'

    // --- Polling Loop ---
    while (mightHaveMore) {
      apiCallCount++
      // Safety break
      if (apiCallCount > 10) {
        logger.warn(`[${requestId}] Reached maximum polling limit (10 calls)`, {
          webhookId: webhookData.id,
          consolidatedCount: consolidatedChangesMap.size,
        })
        mightHaveMore = false
        break
      }

      const apiUrl = `${airtableApiBase}/bases/${baseId}/webhooks/${airtableWebhookId}/payloads`
      const queryParams = new URLSearchParams()
      if (currentCursor !== null) {
        queryParams.set('cursor', currentCursor.toString())
      }
      const fullUrl = `${apiUrl}?${queryParams.toString()}`

      logger.debug(`[${requestId}] Fetching Airtable payloads (call ${apiCallCount})`, {
        url: fullUrl,
        webhookId: webhookData.id,
      })

      try {
        const fetchStartTime = Date.now()
        const response = await fetch(fullUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        })

        // DEBUG: Log API response time
        logger.debug(`[${requestId}] TRACE: Airtable API response received`, {
          status: response.status,
          duration: `${Date.now() - fetchStartTime}ms`,
          hasBody: true,
          apiCall: apiCallCount,
        })

        const responseBody = await response.json()

        if (!response.ok || responseBody.error) {
          const errorMessage =
            responseBody.error?.message ||
            responseBody.error ||
            `Airtable API error Status ${response.status}`
          logger.error(
            `[${requestId}] Airtable API request to /payloads failed (Call ${apiCallCount})`,
            {
              webhookId: webhookData.id,
              status: response.status,
              error: errorMessage,
            }
          )
          // Error logging handled by enhanced logging session
          mightHaveMore = false
          break
        }

        const receivedPayloads = responseBody.payloads || []
        logger.debug(
          `[${requestId}] Received ${receivedPayloads.length} payloads from Airtable (call ${apiCallCount})`
        )

        // --- Process and Consolidate Changes ---
        if (receivedPayloads.length > 0) {
          payloadsFetched += receivedPayloads.length
          let changeCount = 0
          for (const payload of receivedPayloads) {
            if (payload.changedTablesById) {
              // DEBUG: Log tables being processed
              const tableIds = Object.keys(payload.changedTablesById)
              logger.debug(`[${requestId}] TRACE: Processing changes for tables`, {
                tables: tableIds,
                payloadTimestamp: payload.timestamp,
              })

              for (const [tableId, tableChangesUntyped] of Object.entries(
                payload.changedTablesById
              )) {
                const tableChanges = tableChangesUntyped as any // Assert type

                // Handle created records
                if (tableChanges.createdRecordsById) {
                  const createdCount = Object.keys(tableChanges.createdRecordsById).length
                  changeCount += createdCount
                  // DEBUG: Log created records count
                  logger.debug(
                    `[${requestId}] TRACE: Processing ${createdCount} created records for table ${tableId}`
                  )

                  for (const [recordId, recordDataUntyped] of Object.entries(
                    tableChanges.createdRecordsById
                  )) {
                    const recordData = recordDataUntyped as any // Assert type
                    const existingChange = consolidatedChangesMap.get(recordId)
                    if (existingChange) {
                      // Record was created and possibly updated within the same batch
                      existingChange.changedFields = {
                        ...existingChange.changedFields,
                        ...(recordData.cellValuesByFieldId || {}),
                      }
                      // Keep changeType as 'created' if it started as created
                    } else {
                      // New creation
                      consolidatedChangesMap.set(recordId, {
                        tableId: tableId,
                        recordId: recordId,
                        changeType: 'created',
                        changedFields: recordData.cellValuesByFieldId || {},
                      })
                    }
                  }
                }

                // Handle updated records
                if (tableChanges.changedRecordsById) {
                  const updatedCount = Object.keys(tableChanges.changedRecordsById).length
                  changeCount += updatedCount
                  // DEBUG: Log updated records count
                  logger.debug(
                    `[${requestId}] TRACE: Processing ${updatedCount} updated records for table ${tableId}`
                  )

                  for (const [recordId, recordDataUntyped] of Object.entries(
                    tableChanges.changedRecordsById
                  )) {
                    const recordData = recordDataUntyped as any // Assert type
                    const existingChange = consolidatedChangesMap.get(recordId)
                    const currentFields = recordData.current?.cellValuesByFieldId || {}

                    if (existingChange) {
                      // Existing record was updated again
                      existingChange.changedFields = {
                        ...existingChange.changedFields,
                        ...currentFields,
                      }
                      // Ensure type is 'updated' if it was previously 'created'
                      existingChange.changeType = 'updated'
                      // Do not update previousFields again
                    } else {
                      // First update for this record in the batch
                      const newChange: AirtableChange = {
                        tableId: tableId,
                        recordId: recordId,
                        changeType: 'updated',
                        changedFields: currentFields,
                      }
                      if (recordData.previous?.cellValuesByFieldId) {
                        newChange.previousFields = recordData.previous.cellValuesByFieldId
                      }
                      consolidatedChangesMap.set(recordId, newChange)
                    }
                  }
                }
                // TODO: Handle deleted records (`destroyedRecordIds`) if needed
              }
            }
          }

          // DEBUG: Log totals for this batch
          logger.debug(
            `[${requestId}] TRACE: Processed ${changeCount} changes in API call ${apiCallCount}`,
            {
              currentMapSize: consolidatedChangesMap.size,
            }
          )
        }

        const nextCursor = responseBody.cursor
        mightHaveMore = responseBody.mightHaveMore || false

        if (nextCursor && typeof nextCursor === 'number' && nextCursor !== currentCursor) {
          logger.debug(`[${requestId}] Updating cursor from ${currentCursor} to ${nextCursor}`)
          currentCursor = nextCursor

          // Follow exactly the old implementation - use awaited update instead of parallel
          const updatedConfig = {
            ...localProviderConfig,
            externalWebhookCursor: currentCursor,
          }
          try {
            // Force a complete object update to ensure consistency in serverless env
            await db
              .update(webhook)
              .set({
                providerConfig: updatedConfig, // Use full object
                updatedAt: new Date(),
              })
              .where(eq(webhook.id, webhookData.id))

            localProviderConfig.externalWebhookCursor = currentCursor // Update local copy too
          } catch (dbError: any) {
            logger.error(`[${requestId}] Failed to persist Airtable cursor to DB`, {
              webhookId: webhookData.id,
              cursor: currentCursor,
              error: dbError.message,
            })
            // Error logging handled by enhanced logging session
            mightHaveMore = false
            throw new Error('Failed to save Airtable cursor, stopping processing.') // Re-throw to break loop clearly
          }
        } else if (!nextCursor || typeof nextCursor !== 'number') {
          logger.warn(`[${requestId}] Invalid or missing cursor received, stopping poll`, {
            webhookId: webhookData.id,
            apiCall: apiCallCount,
            receivedCursor: nextCursor,
          })
          mightHaveMore = false
        } else if (nextCursor === currentCursor) {
          logger.debug(`[${requestId}] Cursor hasn't changed (${currentCursor}), stopping poll`)
          mightHaveMore = false // Explicitly stop if cursor hasn't changed
        }
      } catch (fetchError: any) {
        logger.error(
          `[${requestId}] Network error calling Airtable GET /payloads (Call ${apiCallCount}) for webhook ${webhookData.id}`,
          fetchError
        )
        // Error logging handled by enhanced logging session
        mightHaveMore = false
        break
      }
    }
    // --- End Polling Loop ---

    // Convert map values to array for final processing
    const finalConsolidatedChanges = Array.from(consolidatedChangesMap.values())
    logger.info(
      `[${requestId}] Consolidated ${finalConsolidatedChanges.length} Airtable changes across ${apiCallCount} API calls`
    )

    // --- Execute Workflow if we have changes (simplified - no lock check) ---
    if (finalConsolidatedChanges.length > 0) {
      try {
        // Format the input for the executor using the consolidated changes
        const input = { airtableChanges: finalConsolidatedChanges } // Use the consolidated array

        // CRITICAL EXECUTION TRACE POINT
        logger.info(
          `[${requestId}] CRITICAL_TRACE: Beginning workflow execution with ${finalConsolidatedChanges.length} Airtable changes`,
          {
            workflowId: workflowData.id,
            recordCount: finalConsolidatedChanges.length,
            timestamp: new Date().toISOString(),
            firstRecordId: finalConsolidatedChanges[0]?.recordId || 'none',
          }
        )

        await executeWorkflowFromPayload(workflowData, input, requestId, requestId, null)

        // COMPLETION LOG - This will only appear if execution succeeds
        logger.info(`[${requestId}] CRITICAL_TRACE: Workflow execution completed successfully`, {
          workflowId: workflowData.id,
          timestamp: new Date().toISOString(),
        })
      } catch (executionError: any) {
        // Errors logged within executeWorkflowFromPayload
        logger.error(`[${requestId}] CRITICAL_TRACE: Workflow execution failed with error`, {
          workflowId: workflowData.id,
          error: executionError.message,
          stack: executionError.stack,
          timestamp: new Date().toISOString(),
        })

        logger.error(
          `[${requestId}] Error during workflow execution triggered by Airtable polling`,
          executionError
        )
      }
    } else {
      // DEBUG: Log when no changes are found
      logger.info(`[${requestId}] TRACE: No Airtable changes to process`, {
        workflowId: workflowData.id,
        apiCallCount,
        webhookId: webhookData.id,
      })
    }
  } catch (error) {
    // Catch any unexpected errors during the setup/polling logic itself
    logger.error(
      `[${requestId}] Unexpected error during asynchronous Airtable payload processing task`,
      {
        webhookId: webhookData.id,
        workflowId: workflowData.id,
        error: (error as Error).message,
      }
    )
    // Error logging handled by enhanced logging session
  }

  // DEBUG: Log function completion
  logger.debug(`[${requestId}] TRACE: fetchAndProcessAirtablePayloads completed`, {
    totalFetched: payloadsFetched,
    totalApiCalls: apiCallCount,
    totalChanges: consolidatedChangesMap.size,
    timestamp: new Date().toISOString(),
  })
}

/**
 * Process webhook verification and authorization
 */
/**
 * Handle Microsoft Teams webhooks with immediate acknowledgment
 */
async function processMicrosoftTeamsWebhook(
  foundWebhook: any,
  foundWorkflow: any,
  input: any,
  executionId: string,
  requestId: string
): Promise<NextResponse> {
  logger.info(
    `[${requestId}] Acknowledging Microsoft Teams webhook ${foundWebhook.id} and executing workflow ${foundWorkflow.id} asynchronously (Execution: ${executionId})`
  )

  // Execute workflow asynchronously without waiting for completion
  executeWorkflowFromPayload(
    foundWorkflow,
    input,
    executionId,
    requestId,
    foundWebhook.blockId
  ).catch((error) => {
    // Log any errors that occur during async execution
    logger.error(
      `[${requestId}] Error during async workflow execution for webhook ${foundWebhook.id} (Execution: ${executionId})`,
      error
    )
  })

  // Return immediate acknowledgment for Microsoft Teams
  return NextResponse.json(
    {
      type: 'message',
      text: 'Sim Studio',
    },
    { status: 200 }
  )
}

/**
 * Handle standard webhooks with synchronous execution
 */
async function processStandardWebhook(
  foundWebhook: any,
  foundWorkflow: any,
  input: any,
  executionId: string,
  requestId: string
): Promise<NextResponse> {
  logger.info(
    `[${requestId}] Executing workflow ${foundWorkflow.id} for webhook ${foundWebhook.id} (Execution: ${executionId})`
  )

  await executeWorkflowFromPayload(
    foundWorkflow,
    input,
    executionId,
    requestId,
    foundWebhook.blockId
  )

  // Since executeWorkflowFromPayload handles logging and errors internally,
  // we just need to return a standard success response for synchronous webhooks.
  // Note: The actual result isn't typically returned in the webhook response itself.

  return NextResponse.json({ message: 'Webhook processed' }, { status: 200 })
}

/**
 * Handle webhook processing errors with provider-specific responses
 */
function handleWebhookError(
  error: any,
  foundWebhook: any,
  executionId: string,
  requestId: string
): NextResponse {
  logger.error(
    `[${requestId}] Error in processWebhook for ${foundWebhook.id} (Execution: ${executionId})`,
    error
  )

  // For Microsoft Teams outgoing webhooks, return the expected error format
  if (foundWebhook.provider === 'microsoftteams') {
    return NextResponse.json(
      {
        type: 'message',
        text: 'Webhook processing failed',
      },
      { status: 200 }
    ) // Still return 200 to prevent Teams from showing additional error messages
  }

  return new NextResponse(`Internal Server Error: ${error.message}`, {
    status: 500,
  })
}

export async function processWebhook(
  foundWebhook: any,
  foundWorkflow: any,
  body: any,
  request: NextRequest,
  executionId: string,
  requestId: string
): Promise<NextResponse> {
  try {
    // --- Handle Airtable differently - it should always use fetchAndProcessAirtablePayloads ---
    if (foundWebhook.provider === 'airtable') {
      logger.info(`[${requestId}] Routing Airtable webhook through dedicated processor`)
      await fetchAndProcessAirtablePayloads(foundWebhook, foundWorkflow, requestId)
      return NextResponse.json({ message: 'Airtable webhook processed' }, { status: 200 })
    }

    // --- Provider-specific Auth/Verification (excluding Airtable/WhatsApp/Slack/MicrosoftTeams handled earlier) ---
    if (
      foundWebhook.provider &&
      !['airtable', 'whatsapp', 'slack', 'microsoftteams'].includes(foundWebhook.provider)
    ) {
      const verificationResponse = verifyProviderWebhook(foundWebhook, request, requestId)
      if (verificationResponse) {
        return verificationResponse
      }
    }

    // --- Format Input based on provider (excluding Airtable) ---
    const input = formatWebhookInput(foundWebhook, foundWorkflow, body, request)

    if (!input && foundWebhook.provider === 'whatsapp') {
      return new NextResponse('No messages in WhatsApp payload', { status: 200 })
    }

    // --- Route to appropriate processor based on provider ---
    if (foundWebhook.provider === 'microsoftteams') {
      return await processMicrosoftTeamsWebhook(
        foundWebhook,
        foundWorkflow,
        input,
        executionId,
        requestId
      )
    }

    return await processStandardWebhook(foundWebhook, foundWorkflow, input, executionId, requestId)
  } catch (error: any) {
    return handleWebhookError(error, foundWebhook, executionId, requestId)
  }
}

/**
 * Generate a hash for request deduplication
 */
export async function generateRequestHash(path: string, body: any): Promise<string> {
  try {
    const normalizedBody = normalizeBody(body)
    const requestString = `${path}:${JSON.stringify(normalizedBody)}`
    let hash = 0
    for (let i = 0; i < requestString.length; i++) {
      const char = requestString.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }
    return `request:${path}:${hash}`
  } catch (_error) {
    return `request:${path}:${uuidv4()}`
  }
}

/**
 * Normalize the body for consistent hashing
 */
export function normalizeBody(body: any): any {
  if (!body || typeof body !== 'object') return body
  const result = Array.isArray(body) ? [...body] : { ...body }
  const fieldsToRemove = [
    'timestamp',
    'random',
    'nonce',
    'requestId',
    'event_id',
    'event_time' /* Add other volatile fields */,
  ] // Made case-insensitive check below
  if (Array.isArray(result)) {
    return result.map((item) => normalizeBody(item))
  }
  for (const key in result) {
    // Use lowercase check for broader matching
    if (fieldsToRemove.includes(key.toLowerCase())) {
      delete result[key]
    } else if (typeof result[key] === 'object' && result[key] !== null) {
      result[key] = normalizeBody(result[key])
    }
  }
  return result
}

// Define an interface for AirtableChange
export interface AirtableChange {
  tableId: string
  recordId: string
  changeType: 'created' | 'updated'
  changedFields: Record<string, any> // { fieldId: newValue }
  previousFields?: Record<string, any> // { fieldId: previousValue } (optional)
}

/**
 * Configure Gmail polling for a webhook
 */
export async function configureGmailPolling(
  userId: string,
  webhookData: any,
  requestId: string
): Promise<boolean> {
  const logger = createLogger('GmailWebhookSetup')
  logger.info(`[${requestId}] Setting up Gmail polling for webhook ${webhookData.id}`)

  try {
    const accessToken = await getOAuthToken(userId, 'google-email')
    if (!accessToken) {
      logger.error(`[${requestId}] Failed to retrieve Gmail access token for user ${userId}`)
      return false
    }

    const providerConfig = (webhookData.providerConfig as Record<string, any>) || {}

    const maxEmailsPerPoll =
      typeof providerConfig.maxEmailsPerPoll === 'string'
        ? Number.parseInt(providerConfig.maxEmailsPerPoll, 10) || 25
        : providerConfig.maxEmailsPerPoll || 25

    const pollingInterval =
      typeof providerConfig.pollingInterval === 'string'
        ? Number.parseInt(providerConfig.pollingInterval, 10) || 5
        : providerConfig.pollingInterval || 5

    const now = new Date()

    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...providerConfig,
          userId, // Store user ID for OAuth access during polling
          maxEmailsPerPoll,
          pollingInterval,
          markAsRead: providerConfig.markAsRead || false,
          includeRawEmail: providerConfig.includeRawEmail || false,
          labelIds: providerConfig.labelIds || ['INBOX'],
          labelFilterBehavior: providerConfig.labelFilterBehavior || 'INCLUDE',
          lastCheckedTimestamp: now.toISOString(),
          setupCompleted: true,
        },
        updatedAt: now,
      })
      .where(eq(webhook.id, webhookData.id))

    logger.info(
      `[${requestId}] Successfully configured Gmail polling for webhook ${webhookData.id}`
    )
    return true
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to configure Gmail polling`, {
      webhookId: webhookData.id,
      error: error.message,
      stack: error.stack,
    })
    return false
  }
}
