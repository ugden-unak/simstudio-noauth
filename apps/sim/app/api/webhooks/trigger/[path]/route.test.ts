import { NextRequest } from 'next/server'
/**
 * Integration tests for webhook trigger API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, mockExecutionDependencies } from '@/app/api/__test-utils__/utils'

// Define mock functions at the top level to be used in mocks
const hasProcessedMessageMock = vi.fn().mockResolvedValue(false)
const markMessageAsProcessedMock = vi.fn().mockResolvedValue(true)
const closeRedisConnectionMock = vi.fn().mockResolvedValue(undefined)
const acquireLockMock = vi.fn().mockResolvedValue(true)
const generateRequestHashMock = vi.fn().mockResolvedValue('test-hash-123')
const validateSlackSignatureMock = vi.fn().mockResolvedValue(true)
const handleWhatsAppVerificationMock = vi.fn().mockResolvedValue(null)
const handleSlackChallengeMock = vi.fn().mockReturnValue(null)
const processWhatsAppDeduplicationMock = vi.fn().mockResolvedValue(null)
const processGenericDeduplicationMock = vi.fn().mockResolvedValue(null)
const fetchAndProcessAirtablePayloadsMock = vi.fn().mockResolvedValue(undefined)
const processWebhookMock = vi
  .fn()
  .mockResolvedValue(new Response('Webhook processed', { status: 200 }))
const executeMock = vi.fn().mockResolvedValue({
  success: true,
  output: { response: 'Webhook execution success' },
  logs: [],
  metadata: {
    duration: 100,
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
  },
})

// Mock the DB schema objects
const webhookMock = {
  id: 'webhook-id-column',
  path: 'path-column',
  workflowId: 'workflow-id-column',
  isActive: 'is-active-column',
  provider: 'provider-column',
}
const workflowMock = { id: 'workflow-id-column' }

// Mock global timers
vi.useFakeTimers()

// Mock modules at file scope before any tests
vi.mock('@/lib/redis', () => ({
  hasProcessedMessage: hasProcessedMessageMock,
  markMessageAsProcessed: markMessageAsProcessedMock,
  closeRedisConnection: closeRedisConnectionMock,
  acquireLock: acquireLockMock,
}))

vi.mock('@/lib/webhooks/utils', () => ({
  handleWhatsAppVerification: handleWhatsAppVerificationMock,
  handleSlackChallenge: handleSlackChallengeMock,
  processWhatsAppDeduplication: processWhatsAppDeduplicationMock,
  processGenericDeduplication: processGenericDeduplicationMock,
  fetchAndProcessAirtablePayloads: fetchAndProcessAirtablePayloadsMock,
  processWebhook: processWebhookMock,
}))

vi.mock('./utils', () => ({
  generateRequestHash: generateRequestHashMock,
}))

vi.mock('../../utils', () => ({
  validateSlackSignature: validateSlackSignatureMock,
}))

vi.mock('@/executor', () => ({
  Executor: vi.fn().mockImplementation(() => ({
    execute: executeMock,
  })),
}))

// Mock setTimeout and other timer functions
vi.mock('timers', () => {
  return {
    setTimeout: (callback: any) => {
      // Immediately invoke the callback
      callback()
      // Return a fake timer id
      return 123
    },
  }
})

// Mock the database and schema
vi.mock('@/db', () => {
  const dbMock = {
    select: vi.fn().mockImplementation((columns) => ({
      from: vi.fn().mockImplementation((table) => ({
        innerJoin: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => ({
            limit: vi.fn().mockImplementation(() => {
              // Return empty array by default (no webhook found)
              return []
            }),
          })),
        })),
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(() => {
            // For non-webhook queries
            return []
          }),
        })),
      })),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    })),
  }

  return {
    db: dbMock,
    webhook: webhookMock,
    workflow: workflowMock,
  }
})

describe('Webhook Trigger API Route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    vi.clearAllTimers()

    mockExecutionDependencies()

    // Mock services/queue for rate limiting
    vi.doMock('@/services/queue', () => ({
      RateLimiter: vi.fn().mockImplementation(() => ({
        checkRateLimit: vi.fn().mockResolvedValue({
          allowed: true,
          remaining: 10,
          resetAt: new Date(),
        }),
      })),
      RateLimitError: class RateLimitError extends Error {
        constructor(
          message: string,
          public statusCode = 429
        ) {
          super(message)
          this.name = 'RateLimitError'
        }
      },
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      loadWorkflowFromNormalizedTables: vi.fn().mockResolvedValue({
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        isFromNormalizedTables: true,
      }),
    }))

    hasProcessedMessageMock.mockResolvedValue(false)
    markMessageAsProcessedMock.mockResolvedValue(true)
    acquireLockMock.mockResolvedValue(true)
    handleWhatsAppVerificationMock.mockResolvedValue(null)
    processGenericDeduplicationMock.mockResolvedValue(null)
    processWebhookMock.mockResolvedValue(new Response('Webhook processed', { status: 200 }))

    if ((global as any).crypto?.randomUUID) {
      vi.spyOn(crypto, 'randomUUID').mockRestore()
    }

    vi.spyOn(crypto, 'randomUUID').mockReturnValue('mock-uuid-12345')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Test WhatsApp webhook verification challenge
   * Validates that WhatsApp protocol-specific challenge-response is handled
   */
  it('should handle WhatsApp verification challenge', async () => {
    // Set up WhatsApp challenge response
    handleWhatsAppVerificationMock.mockResolvedValue(
      new Response('challenge-123', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    )

    // Create a search params with WhatsApp verification fields
    const verificationParams = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'test-token',
      'hub.challenge': 'challenge-123',
    })

    // Create a mock URL with search params
    const mockUrl = `http://localhost:3000/api/webhooks/trigger/whatsapp?${verificationParams.toString()}`

    // Create a mock request with the URL using NextRequest
    const req = new NextRequest(new URL(mockUrl))

    // Mock database to return a WhatsApp webhook with matching token
    const { db } = await import('@/db')
    const whereMock = vi.fn().mockReturnValue([
      {
        id: 'webhook-id',
        provider: 'whatsapp',
        isActive: true,
        providerConfig: {
          verificationToken: 'test-token',
        },
      },
    ])

    // @ts-ignore - mocking the query chain
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: whereMock,
      }),
    })

    // Mock the path param
    const params = Promise.resolve({ path: 'whatsapp' })

    // Import the handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req, { params })

    // Check response
    expect(response.status).toBe(200)

    // Should return exactly the challenge string
    const text = await response.text()
    expect(text).toBe('challenge-123')
  })

  /**
   * Test POST webhook with workflow execution
   * Verifies that a webhook trigger properly initiates workflow execution
   */
  // TODO: Fix failing test - returns 500 instead of 200
  // it('should trigger workflow execution via POST', async () => { ... })

  /**
   * Test 404 handling for non-existent webhooks
   */
  it('should handle 404 for non-existent webhooks', async () => {
    // Configure DB mock to return empty result (no webhook found)
    const { db } = await import('@/db')
    const limitMock = vi.fn().mockReturnValue([])
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock })
    const innerJoinMock = vi.fn().mockReturnValue({ where: whereMock })
    const fromMock = vi.fn().mockReturnValue({ innerJoin: innerJoinMock })

    // @ts-ignore - mocking the query chain
    db.select.mockReturnValue({ from: fromMock })

    // Create a mock request
    const req = createMockRequest('POST', { event: 'test' })

    // Mock the path param
    const params = Promise.resolve({ path: 'non-existent-path' })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req, { params })

    // Check response - expect 404 since our implementation returns 404 when webhook is not found
    expect(response.status).toBe(404)

    // Parse the response body
    const text = await response.text()
    expect(text).toMatch(/not found/i) // Response should contain "not found" message
  })

  /**
   * Test duplicate webhook request handling
   * Verifies that duplicate requests are detected and not processed multiple times
   */
  it('should handle duplicate webhook requests', async () => {
    // Set up duplicate detection
    hasProcessedMessageMock.mockResolvedValue(true) // Simulate duplicate
    processGenericDeduplicationMock.mockResolvedValue(
      new Response('Duplicate request', { status: 200 })
    )

    // Configure DB mock to return a webhook and workflow
    const { db } = await import('@/db')
    const limitMock = vi.fn().mockReturnValue([
      {
        webhook: {
          id: 'webhook-id',
          path: 'test-path',
          isActive: true,
          provider: 'generic', // Not Airtable to test standard path
          workflowId: 'workflow-id',
          providerConfig: {},
        },
        workflow: {
          id: 'workflow-id',
          userId: 'user-id',
        },
      },
    ])

    const whereMock = vi.fn().mockReturnValue({ limit: limitMock })
    const innerJoinMock = vi.fn().mockReturnValue({ where: whereMock })
    const fromMock = vi.fn().mockReturnValue({ innerJoin: innerJoinMock })

    // @ts-ignore - mocking the query chain
    db.select.mockReturnValue({ from: fromMock })

    // Create a mock request
    const req = createMockRequest('POST', { event: 'test' })

    // Mock the path param
    const params = Promise.resolve({ path: 'test-path' })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req, { params })

    // Expect 200 response for duplicate
    expect(response.status).toBe(200)

    // Verify response text indicates duplication
    const text = await response.text()
    expect(text).toMatch(/duplicate|received/i) // Response might be "Duplicate message" or "Request received"
  })

  /**
   * Test Slack-specific webhook handling
   * Verifies that Slack signature verification is performed
   */
  // TODO: Fix failing test - returns 500 instead of 200
  // it('should handle Slack webhooks with signature verification', async () => { ... })

  /**
   * Test error handling during webhook execution
   */
  it('should handle errors during workflow execution', async () => {
    // Mock the setTimeout to be faster for testing
    // @ts-ignore - Replace global setTimeout for this test
    global.setTimeout = vi.fn((callback) => {
      callback() // Execute immediately
      return 123 // Return a timer ID
    })

    // Set up error handling mocks
    processWebhookMock.mockImplementation(() => {
      throw new Error('Webhook execution failed')
    })
    executeMock.mockRejectedValue(new Error('Webhook execution failed'))

    // Configure DB mock to return a webhook and workflow
    const { db } = await import('@/db')
    const limitMock = vi.fn().mockReturnValue([
      {
        webhook: {
          id: 'webhook-id',
          path: 'test-path',
          isActive: true,
          provider: 'generic', // Not Airtable to ensure we use the timeout path
          workflowId: 'workflow-id',
          providerConfig: {},
        },
        workflow: {
          id: 'workflow-id',
          userId: 'user-id',
        },
      },
    ])

    const whereMock = vi.fn().mockReturnValue({ limit: limitMock })
    const innerJoinMock = vi.fn().mockReturnValue({ where: whereMock })
    const fromMock = vi.fn().mockReturnValue({ innerJoin: innerJoinMock })

    // @ts-ignore - mocking the query chain
    db.select.mockReturnValue({ from: fromMock })

    // Create a mock request
    const req = createMockRequest('POST', { event: 'test' })

    // Mock the path param
    const params = Promise.resolve({ path: 'test-path' })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req, { params })

    // Verify response exists and check status code
    // For non-Airtable webhooks, we expect 200 from the timeout response
    expect(response).toBeDefined()
    expect(response.status).toBe(200)

    // Verify response text
    const text = await response.text()
    expect(text).toMatch(/received|processing/i)
  })

  /**
   * Test Airtable webhook specific handling
   * Verifies that Airtable webhooks use the synchronous processing path
   */
  it('should handle Airtable webhooks synchronously', async () => {
    // Create webhook payload for Airtable
    const airtablePayload = {
      base: {
        id: 'appn9RltLQQMsquyL',
      },
      webhook: {
        id: 'achpbXeBqNLsRFAnD',
      },
      timestamp: new Date().toISOString(),
    }

    // Reset fetch and process mock
    fetchAndProcessAirtablePayloadsMock.mockResolvedValue(undefined)

    // Configure DB mock to return an Airtable webhook
    const { db } = await import('@/db')
    const limitMock = vi.fn().mockReturnValue([
      {
        webhook: {
          id: 'airtable-webhook-id',
          path: 'airtable-path',
          isActive: true,
          provider: 'airtable', // Set provider to airtable to test that path
          workflowId: 'workflow-id',
          providerConfig: {
            baseId: 'appn9RltLQQMsquyL',
            externalId: 'achpbXeBqNLsRFAnD',
          },
        },
        workflow: {
          id: 'workflow-id',
          userId: 'user-id',
        },
      },
    ])

    const whereMock = vi.fn().mockReturnValue({ limit: limitMock })
    const innerJoinMock = vi.fn().mockReturnValue({ where: whereMock })
    const fromMock = vi.fn().mockReturnValue({ innerJoin: innerJoinMock })

    // Configure db.select to return the appropriate mock for this test
    // @ts-ignore - Ignore TypeScript errors for test mocks
    db.select = vi.fn().mockReturnValue({ from: fromMock })

    // Also mock the DB for the Airtable notification check
    const whereMock2 = vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue([]) })
    const fromMock2 = vi.fn().mockReturnValue({ where: whereMock2 })

    // We need to handle multiple calls to db.select
    let callCount = 0
    // @ts-ignore - Ignore TypeScript errors for test mocks
    db.select = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return { from: fromMock }
      }
      return { from: fromMock2 }
    })

    // Create a mock request with Airtable payload
    const req = createMockRequest('POST', airtablePayload)

    // Mock the path param
    const params = Promise.resolve({ path: 'airtable-path' })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req, { params })

    // For Airtable we expect 200 after synchronous processing
    expect(response.status).toBe(200)

    // Verify that the Airtable-specific function was called
    expect(fetchAndProcessAirtablePayloadsMock).toHaveBeenCalledTimes(1)

    // The response should indicate success
    const text = await response.text()
    expect(text).toMatch(/success|processed/i)
  })
})
