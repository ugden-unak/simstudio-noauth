import { SlackIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { SlackResponse } from '@/tools/slack/types'

export const SlackBlock: BlockConfig<SlackResponse> = {
  type: 'slack',
  name: 'Slack',
  description: 'Send messages to Slack',
  longDescription:
    "Comprehensive Slack integration with OAuth authentication. Send formatted messages using Slack's mrkdwn syntax.",
  docsLink: 'https://docs.simstudio.ai/tools/slack',
  category: 'tools',
  bgColor: '#611f69',
  icon: SlackIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Send Message', id: 'send' },
        { label: 'Create Canvas', id: 'canvas' },
        { label: 'Read Messages', id: 'read' },
      ],
      value: () => 'send',
    },
    {
      id: 'authMethod',
      title: 'Authentication Method',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Sim Studio Bot', id: 'oauth' },
        { label: 'Custom Bot', id: 'bot_token' },
      ],
      value: () => 'oauth',
    },
    {
      id: 'credential',
      title: 'Slack Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'slack',
      serviceId: 'slack',
      requiredScopes: [
        'channels:read',
        'channels:history',
        'groups:read',
        'groups:history',
        'chat:write',
        'chat:write.public',
        'users:read',
        'files:write',
        'canvases:write',
      ],
      placeholder: 'Select Slack workspace',
      condition: {
        field: 'authMethod',
        value: 'oauth',
      },
    },
    {
      id: 'botToken',
      title: 'Bot Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Slack bot token (xoxb-...)',
      password: true,
      condition: {
        field: 'authMethod',
        value: 'bot_token',
      },
    },
    {
      id: 'channel',
      title: 'Channel',
      type: 'channel-selector',
      layout: 'full',
      provider: 'slack',
      placeholder: 'Select Slack channel',
      mode: 'basic',
    },
    // Manual channel ID input (advanced mode)
    {
      id: 'manualChannel',
      title: 'Channel ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Slack channel ID (e.g., C1234567890)',
      mode: 'advanced',
    },
    {
      id: 'text',
      title: 'Message',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your message (supports Slack mrkdwn)',
      condition: {
        field: 'operation',
        value: 'send',
      },
    },
    // Canvas specific fields
    {
      id: 'title',
      title: 'Canvas Title',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter canvas title',
      condition: {
        field: 'operation',
        value: 'canvas',
      },
    },
    {
      id: 'content',
      title: 'Canvas Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter canvas content (markdown supported)',
      condition: {
        field: 'operation',
        value: 'canvas',
      },
    },
    // Message Reader specific fields
    {
      id: 'limit',
      title: 'Message Limit',
      type: 'short-input',
      layout: 'half',
      placeholder: '50',
      condition: {
        field: 'operation',
        value: 'read',
      },
    },
    {
      id: 'oldest',
      title: 'Oldest Timestamp',
      type: 'short-input',
      layout: 'half',
      placeholder: 'ISO 8601 timestamp',
      condition: {
        field: 'operation',
        value: 'read',
      },
    },
  ],
  tools: {
    access: ['slack_message', 'slack_canvas', 'slack_message_reader'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'send':
            return 'slack_message'
          case 'canvas':
            return 'slack_canvas'
          case 'read':
            return 'slack_message_reader'
          default:
            throw new Error(`Invalid Slack operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          credential,
          authMethod,
          botToken,
          operation,
          channel,
          manualChannel,
          title,
          content,
          limit,
          oldest,
          ...rest
        } = params

        // Handle channel input (selector or manual)
        const effectiveChannel = (channel || manualChannel || '').trim()

        if (!effectiveChannel) {
          throw new Error(
            'Channel is required. Please select a channel or enter a channel ID manually.'
          )
        }

        const baseParams: Record<string, any> = {
          channel: effectiveChannel,
        }

        // Handle authentication based on method
        if (authMethod === 'bot_token') {
          if (!botToken) {
            throw new Error('Bot token is required when using bot token authentication')
          }
          baseParams.accessToken = botToken
        } else {
          // Default to OAuth
          if (!credential) {
            throw new Error('Slack account credential is required when using Sim Studio Bot')
          }
          baseParams.credential = credential
        }

        // Handle operation-specific params
        switch (operation) {
          case 'send':
            if (!rest.text) {
              throw new Error('Message text is required for send operation')
            }
            baseParams.text = rest.text
            break

          case 'canvas':
            if (!title || !content) {
              throw new Error('Title and content are required for canvas operation')
            }
            baseParams.title = title
            baseParams.content = content
            break

          case 'read':
            if (limit) {
              const parsedLimit = Number.parseInt(limit, 10)
              baseParams.limit = !Number.isNaN(parsedLimit) ? parsedLimit : 10
            } else {
              baseParams.limit = 10
            }
            if (oldest) {
              baseParams.oldest = oldest
            }
            break
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    authMethod: { type: 'string', required: true },
    credential: { type: 'string', required: false },
    botToken: { type: 'string', required: false },
    channel: { type: 'string', required: false },
    manualChannel: { type: 'string', required: false },
    text: { type: 'string', required: false },
    title: { type: 'string', required: false },
    content: { type: 'string', required: false },
    limit: { type: 'string', required: false },
    oldest: { type: 'string', required: false },
  },
  outputs: {
    ts: 'string',
    channel: 'string',
    canvas_id: 'string',
    title: 'string',
    messages: 'json',
  },
}
