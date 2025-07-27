import { unstable_noStore as noStore } from 'next/cache'
import { type NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'

export const dynamic = 'force-dynamic'
export const runtime = 'edge'
export const maxDuration = 60

const logger = createLogger('GenerateCodeAPI')

const openai = env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    })
  : null

if (!env.OPENAI_API_KEY) {
  logger.warn('OPENAI_API_KEY not found. Code generation API will not function.')
}

type GenerationType =
  | 'json-schema'
  | 'javascript-function-body'
  | 'typescript-function-body'
  | 'custom-tool-schema'
  | 'json-object'

// Define the structure for a single message in the history
interface ChatMessage {
  role: 'user' | 'assistant' | 'system' // System role might be needed if we include the initial system prompt in history
  content: string
}

interface RequestBody {
  prompt: string
  generationType: GenerationType
  context?: string
  stream?: boolean
  history?: ChatMessage[] // Optional conversation history
}

const systemPrompts: Record<GenerationType, string> = {
  'json-schema': `You are an expert programmer specializing in creating JSON schemas according to a specific format.
Generate ONLY the JSON schema based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.
The JSON object MUST have the following top-level properties: 'name' (string), 'description' (string), 'strict' (boolean, usually true), and 'schema' (object).
The 'schema' object must define the structure and MUST contain 'type': 'object', 'properties': {...}, 'additionalProperties': false, and 'required': [...].
Inside 'properties', use standard JSON Schema properties (type, description, enum, items for arrays, etc.).
Do not include any explanations, markdown formatting, or other text outside the JSON object.

Valid Schema Examples:

Example 1:
{
    "name": "reddit_post",
    "description": "Fetches the reddit posts in the given subreddit",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "The title of the post"
            },
            "content": {
                "type": "string",
                "description": "The content of the post"
            }
        },
        "additionalProperties": false,
        "required": [ "title", "content" ]
    }
}

Example 2:
{
    "name": "get_weather",
    "description": "Fetches the current weather for a specific location.",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "location": {
                "type": "string",
                "description": "The city and state, e.g., San Francisco, CA"
            },
            "unit": {
                "type": "string",
                "description": "Temperature unit",
                "enum": ["celsius", "fahrenheit"]
            }
        },
        "additionalProperties": false,
        "required": ["location", "unit"]
    }
}

Example 3 (Array Input):
{
    "name": "process_items",
    "description": "Processes a list of items with specific IDs.",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "item_ids": {
                "type": "array",
                "description": "A list of unique item identifiers to process.",
                "items": {
                    "type": "string",
                    "description": "An item ID"
                }
            },
            "processing_mode": {
                "type": "string",
                "description": "The mode for processing",
                "enum": ["fast", "thorough"]
            }
        },
        "additionalProperties": false,
        "required": ["item_ids", "processing_mode"]
    }
}
`,
  'custom-tool-schema': `You are an expert programmer specializing in creating OpenAI function calling format JSON schemas for custom tools.
Generate ONLY the JSON schema based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.
The JSON schema MUST follow this specific format:
1. Top-level property "type" must be set to "function"
2. A "function" object containing:
   - "name": A concise, camelCase name for the function
   - "description": A clear description of what the function does
   - "parameters": A JSON Schema object describing the function's parameters with:
     - "type": "object"
     - "properties": An object containing parameter definitions
     - "required": An array of required parameter names

Do not include any explanations, markdown formatting, or other text outside the JSON object.

Valid Schema Examples:

Example 1:
{
  "type": "function",
  "function": {
    "name": "getWeather",
    "description": "Fetches the current weather for a specific location.",
    "parameters": {
      "type": "object",
      "properties": {
        "location": {
          "type": "string",
          "description": "The city and state, e.g., San Francisco, CA"
        },
        "unit": {
          "type": "string",
          "description": "Temperature unit",
          "enum": ["celsius", "fahrenheit"]
        }
      },
      "required": ["location"],
      "additionalProperties": false
    }
  }
}

Example 2:
{
  "type": "function",
  "function": {
    "name": "addItemToOrder",
    "description": "Add one quantity of a food item to the order.",
    "parameters": {
      "type": "object",
      "properties": {
        "itemName": {
          "type": "string",
          "description": "The name of the food item to add to order"
        },
        "quantity": {
          "type": "integer",
          "description": "The quantity of the item to add",
          "default": 1
        }
      },
      "required": ["itemName"],
      "additionalProperties": false
    }
  }
}

Example 3 (Array Input):
{
  "type": "function",
  "function": {
    "name": "processItems",
    "description": "Processes a list of items with specific IDs.",
    "parameters": {
      "type": "object",
      "properties": {
        "itemIds": {
          "type": "array",
          "description": "A list of unique item identifiers to process.",
          "items": {
            "type": "string",
            "description": "An item ID"
          }
        },
        "processingMode": {
          "type": "string",
          "description": "The mode for processing",
          "enum": ["fast", "thorough"]
        }
      },
      "required": ["itemIds"],
      "additionalProperties": false
    }
  }
}
`,
  'javascript-function-body': `You are an expert JavaScript programmer.
Generate ONLY the raw body of a JavaScript function based on the user's request.
The code should be executable within an 'async function(params, environmentVariables) {...}' context.
- 'params' (object): Contains input parameters derived from the JSON schema. Access these directly using the parameter name wrapped in angle brackets, e.g., '<paramName>'. Do NOT use 'params.paramName'.
- 'environmentVariables' (object): Contains environment variables. Reference these using the double curly brace syntax: '{{ENV_VAR_NAME}}'. Do NOT use 'environmentVariables.VAR_NAME' or env.

IMPORTANT FORMATTING RULES:
1.  Reference Environment Variables: Use the exact syntax {{VARIABLE_NAME}}. Do NOT wrap it in quotes (e.g., use 'apiKey = {{SERVICE_API_KEY}}' not 'apiKey = "{{SERVICE_API_KEY}}"'). Our system replaces these placeholders before execution.
2.  Reference Input Parameters/Workflow Variables: Use the exact syntax <variable_name>. Do NOT wrap it in quotes (e.g., use 'userId = <userId>;' not 'userId = "<userId>";'). This includes parameters defined in the block's schema and outputs from previous blocks.
3.  Function Body ONLY: Do NOT include the function signature (e.g., 'async function myFunction() {' or the surrounding '}').
4.  Imports: Do NOT include import/require statements unless they are standard Node.js built-in modules (e.g., 'crypto', 'fs'). External libraries are not supported in this context.
5.  Output: Ensure the code returns a value if the function is expected to produce output. Use 'return'.
6.  Clarity: Write clean, readable code.
7.  No Explanations: Do NOT include markdown formatting, comments explaining the rules, or any text other than the raw JavaScript code for the function body.

Example Scenario:
User Prompt: "Fetch user data from an API. Use the User ID passed in as 'userId' and an API Key stored as the 'SERVICE_API_KEY' environment variable."

Generated Code:
const userId = <block.content>; // Correct: Accessing input parameter without quotes
const apiKey = {{SERVICE_API_KEY}}; // Correct: Accessing environment variable without quotes
const url = \`https://api.example.com/users/\${userId}\`;

try {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': \`Bearer \${apiKey}\`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    // Throwing an error will mark the block execution as failed
    throw new Error(\`API request failed with status \${response.status}: \${await response.text()}\`);
  }

  const data = await response.json();
  console.log('User data fetched successfully.'); // Optional: logging for debugging
  return data; // Return the fetched data which becomes the block's output
} catch (error) {
  console.error(\`Error fetching user data: \${error.message}\`);
  // Re-throwing the error ensures the workflow knows this step failed.
  throw error;
}`,
  'typescript-function-body': `You are an expert TypeScript programmer.
Generate ONLY the body of a TypeScript function based on the user's request.
The code should be executable within an async context. You have access to a 'params' object (typed as Record<string, any>) containing input parameters and an 'environmentVariables' object (typed as Record<string, string>) for env vars.
Do not include the function signature (e.g., 'async function myFunction(): Promise<any> {').
Do not include import/require statements unless absolutely necessary and they are standard Node.js modules.
Do not include markdown formatting or explanations.
Output only the raw TypeScript code. Use modern TypeScript features where appropriate. Do not use semicolons.
Example:
const userId = <block.content> as string
const apiKey = {{SERVICE_API_KEY}}
const response = await fetch(\`https://api.example.com/users/\${userId}\`, { headers: { Authorization: \`Bearer \${apiKey}\` } })
if (!response.ok) {
  throw new Error(\`Failed to fetch user data: \${response.statusText}\`)
}
const data: unknown = await response.json()
// Add type checking/assertion if necessary
return data // Ensure you return a value if expected`,

  'json-object': `You are an expert JSON programmer.
Generate ONLY the raw JSON object based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.

Do not include any explanations, markdown formatting, or other text outside the JSON object.

You have access to the following variables you can use to generate the JSON body:
- 'params' (object): Contains input parameters derived from the JSON schema. Access these directly using the parameter name wrapped in angle brackets, e.g., '<paramName>'. Do NOT use 'params.paramName'.
- 'environmentVariables' (object): Contains environment variables. Reference these using the double curly brace syntax: '{{ENV_VAR_NAME}}'. Do NOT use 'environmentVariables.VAR_NAME' or env.

Example:
{
  "name": "<block.agent.response.content>",
  "age": <block.function.output.age>,
  "success": true
}
`,
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  logger.info(`[${requestId}] Received code generation request`)

  if (!openai) {
    logger.error(`[${requestId}] OpenAI client not initialized. Missing API key.`)
    return NextResponse.json(
      { success: false, error: 'Code generation service is not configured.' },
      { status: 503 }
    )
  }

  try {
    const body = (await req.json()) as RequestBody
    noStore()

    // Destructure history along with other fields
    const { prompt, generationType, context, stream = false, history = [] } = body

    if (!prompt || !generationType) {
      logger.warn(`[${requestId}] Invalid request: Missing prompt or generationType.`)
      return NextResponse.json(
        { success: false, error: 'Missing required fields: prompt and generationType.' },
        { status: 400 }
      )
    }

    if (!systemPrompts[generationType]) {
      logger.warn(`[${requestId}] Invalid generationType: ${generationType}`)
      return NextResponse.json(
        { success: false, error: `Invalid generationType: ${generationType}` },
        { status: 400 }
      )
    }

    const systemPrompt = systemPrompts[generationType]

    // Construct the user message, potentially including context
    const currentUserMessageContent = context
      ? `Prompt: ${prompt}\\n\\nExisting Content/Context:\\n${context}`
      : `${prompt}` // Keep it simple for follow-ups, context is in history

    // Prepare messages for OpenAI API
    // Start with the system prompt
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }]

    // Add previous messages from history
    // Filter out any potential system messages from history if we always prepend a fresh one
    messages.push(...history.filter((msg) => msg.role !== 'system'))

    // Add the current user prompt
    messages.push({ role: 'user', content: currentUserMessageContent })

    logger.debug(`[${requestId}] Calling OpenAI API`, {
      generationType,
      stream,
      historyLength: history.length,
    })

    // For streaming responses
    if (stream) {
      try {
        const streamCompletion = await openai?.chat.completions.create({
          model: 'gpt-4o',
          messages: messages,
          temperature: 0.2,
          max_tokens: 1500,
          stream: true,
        })

        // Use ReadableStream for Edge runtime
        return new Response(
          new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder()
              let fullContent = generationType === 'json-schema' ? '' : undefined

              // Process each chunk
              for await (const chunk of streamCompletion) {
                const content = chunk.choices[0]?.delta?.content || ''
                if (content) {
                  // Only append if fullContent is defined (i.e., for json-schema)
                  if (fullContent !== undefined) {
                    fullContent += content
                  }

                  // Send the chunk to the client
                  controller.enqueue(
                    encoder.encode(
                      `${JSON.stringify({
                        chunk: content,
                        done: false,
                      })}\n`
                    )
                  )
                }
              }

              // Check JSON validity for json-schema type when streaming is complete
              if (generationType === 'json-schema' && fullContent) {
                try {
                  JSON.parse(fullContent)
                } catch (parseError: any) {
                  logger.error(`[${requestId}] Generated JSON schema is invalid`, {
                    error: parseError.message,
                    content: fullContent,
                  })

                  // Send error to client
                  controller.enqueue(
                    encoder.encode(
                      `${JSON.stringify({
                        error: 'Generated JSON schema was invalid.',
                        done: true,
                      })}\n`
                    )
                  )
                  controller.close()
                  return
                }
              }

              // Send the final done message
              controller.enqueue(
                encoder.encode(
                  `${JSON.stringify({
                    done: true,
                    ...(fullContent !== undefined && { fullContent: fullContent }),
                  })}\n`
                )
              )
              controller.close()
              logger.info(`[${requestId}] Code generation streaming completed`, { generationType })
            },
          }),
          {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
            },
          }
        )
      } catch (error: any) {
        logger.error(`[${requestId}] Streaming error`, {
          error: error.message || 'Unknown error',
          stack: error.stack,
        })

        return NextResponse.json(
          { success: false, error: 'An error occurred during code generation streaming.' },
          { status: 500 }
        )
      }
    }

    // For non-streaming responses (original implementation)
    const completion = await openai?.chat.completions.create({
      // Use non-null assertion
      model: 'gpt-4o',
      // Pass the constructed messages array
      messages: messages,
      temperature: 0.2,
      max_tokens: 1500,
      response_format: generationType === 'json-schema' ? { type: 'json_object' } : undefined,
    })

    const generatedContent = completion.choices[0]?.message?.content?.trim()

    if (!generatedContent) {
      logger.error(`[${requestId}] OpenAI response was empty or invalid.`)
      return NextResponse.json(
        { success: false, error: 'Failed to generate content. OpenAI response was empty.' },
        { status: 500 }
      )
    }

    logger.info(`[${requestId}] Code generation successful`, { generationType })

    if (generationType === 'json-schema') {
      try {
        JSON.parse(generatedContent)
        return NextResponse.json({ success: true, generatedContent })
      } catch (parseError: any) {
        logger.error(`[${requestId}] Generated JSON schema is invalid`, {
          error: parseError.message,
          content: generatedContent,
        })
        return NextResponse.json(
          { success: false, error: 'Generated JSON schema was invalid.' },
          { status: 500 }
        )
      }
    } else {
      return NextResponse.json({ success: true, generatedContent })
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Code generation failed`, {
      error: error.message || 'Unknown error',
      stack: error.stack,
    })

    let clientErrorMessage = 'Code generation failed. Please try again later.'
    // Keep original message for server logging
    let serverErrorMessage = error.message || 'Unknown error'

    let status = 500
    if (error instanceof OpenAI.APIError) {
      status = error.status || 500
      serverErrorMessage = error.message // Use specific API error for server logs
      logger.error(`[${requestId}] OpenAI API Error: ${status} - ${serverErrorMessage}`)
      // Optionally, customize client message based on status, but keep it generic
      if (status === 401) {
        clientErrorMessage = 'Authentication failed. Please check your API key configuration.'
      } else if (status === 429) {
        clientErrorMessage = 'Rate limit exceeded. Please try again later.'
      } else if (status >= 500) {
        clientErrorMessage =
          'The code generation service is currently unavailable. Please try again later.'
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: clientErrorMessage,
      },
      { status }
    )
  }
}
