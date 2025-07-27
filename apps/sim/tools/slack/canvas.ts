import type { SlackCanvasParams, SlackCanvasResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackCanvasTool: ToolConfig<SlackCanvasParams, SlackCanvasResponse> = {
  id: 'slack_canvas',
  name: 'Slack Canvas Writer',
  description:
    'Create and share Slack canvases in channels. Canvases are collaborative documents within Slack.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'slack',
    additionalScopes: [
      'channels:read',
      'groups:read',
      'chat:write',
      'chat:write.public',
      'canvases:write',
      'files:write',
      'users:read',
    ],
  },

  params: {
    authMethod: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Authentication method: oauth or bot_token',
    },
    botToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Bot token for Custom Bot',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth access token or bot token for Slack API',
    },
    channel: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Target Slack channel (e.g., #general)',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the canvas',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Canvas content in markdown format',
    },
    document_content: {
      type: 'object',
      required: false,
      visibility: 'hidden',
      description: 'Structured canvas document content',
    },
  },

  request: {
    url: 'https://slack.com/api/canvases.create',
    method: 'POST',
    headers: (params: SlackCanvasParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackCanvasParams) => {
      // Use structured document content if provided, otherwise use markdown format
      if (params.document_content) {
        return {
          title: params.title,
          channel_id: params.channel,
          document_content: params.document_content,
        }
      }
      // Use the correct Canvas API format with markdown
      return {
        title: params.title,
        channel_id: params.channel,
        document_content: {
          type: 'markdown',
          markdown: params.content,
        },
      }
    },
  },

  transformResponse: async (response: Response, params?: SlackCanvasParams) => {
    if (!params) {
      throw new Error('Parameters are required for canvas creation')
    }
    const data = await response.json()
    if (!data.ok) {
      throw new Error(data.error || 'Slack Canvas API error')
    }

    // The canvas is created in the channel, so we just need to return the result
    // No need to post a separate message since the canvas appears in the channel
    return {
      success: true,
      output: {
        canvas_id: data.canvas_id || data.id,
        channel: params.channel,
        title: params.title,
      },
    }
  },

  transformError: (error: any) => {
    const message = error.message || 'Slack Canvas creation failed'
    return message
  },
}
