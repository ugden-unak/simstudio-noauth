import { MicrosoftTeamsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { MicrosoftTeamsResponse } from '@/tools/microsoft_teams/types'

export const MicrosoftTeamsBlock: BlockConfig<MicrosoftTeamsResponse> = {
  type: 'microsoft_teams',
  name: 'Microsoft Teams',
  description: 'Read, write, and create messages',
  longDescription:
    'Integrate Microsoft Teams functionality to manage messages. Read content from existing messages and write to messages using OAuth authentication. Supports text content manipulation for message creation and editing.',
  docsLink: 'https://docs.simstudio.ai/tools/microsoft_teams',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: MicrosoftTeamsIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Read Chat Messages', id: 'read_chat' },
        { label: 'Write Chat Message', id: 'write_chat' },
        { label: 'Read Channel Messages', id: 'read_channel' },
        { label: 'Write Channel Message', id: 'write_channel' },
      ],
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'microsoft-teams',
      serviceId: 'microsoft-teams',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'User.Read',
        'Chat.Read',
        'Chat.ReadWrite',
        'Chat.ReadBasic',
        'Channel.ReadBasic.All',
        'ChannelMessage.Send',
        'ChannelMessage.Read.All',
        'Group.Read.All',
        'Group.ReadWrite.All',
        'Team.ReadBasic.All',
        'offline_access',
      ],
      placeholder: 'Select Microsoft account',
    },
    {
      id: 'teamId',
      title: 'Select Team',
      type: 'file-selector',
      layout: 'full',
      provider: 'microsoft-teams',
      serviceId: 'microsoft-teams',
      requiredScopes: [],
      placeholder: 'Select a team',
      mode: 'basic',
      condition: { field: 'operation', value: ['read_channel', 'write_channel'] },
    },
    {
      id: 'manualTeamId',
      title: 'Team ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter team ID',
      mode: 'advanced',
      condition: { field: 'operation', value: ['read_channel', 'write_channel'] },
    },
    {
      id: 'chatId',
      title: 'Select Chat',
      type: 'file-selector',
      layout: 'full',
      provider: 'microsoft-teams',
      serviceId: 'microsoft-teams',
      requiredScopes: [],
      placeholder: 'Select a chat',
      mode: 'basic',
      condition: { field: 'operation', value: ['read_chat', 'write_chat'] },
    },
    {
      id: 'manualChatId',
      title: 'Chat ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter chat ID',
      mode: 'advanced',
      condition: { field: 'operation', value: ['read_chat', 'write_chat'] },
    },
    {
      id: 'channelId',
      title: 'Select Channel',
      type: 'file-selector',
      layout: 'full',
      provider: 'microsoft-teams',
      serviceId: 'microsoft-teams',
      requiredScopes: [],
      placeholder: 'Select a channel',
      mode: 'basic',
      condition: { field: 'operation', value: ['read_channel', 'write_channel'] },
    },
    {
      id: 'manualChannelId',
      title: 'Channel ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter channel ID',
      mode: 'advanced',
      condition: { field: 'operation', value: ['read_channel', 'write_channel'] },
    },
    // Create-specific Fields
    {
      id: 'content',
      title: 'Message',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter message content',
      condition: { field: 'operation', value: ['write_chat', 'write_channel'] },
    },
  ],
  tools: {
    access: [
      'microsoft_teams_read_chat',
      'microsoft_teams_write_chat',
      'microsoft_teams_read_channel',
      'microsoft_teams_write_channel',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read_chat':
            return 'microsoft_teams_read_chat'
          case 'write_chat':
            return 'microsoft_teams_write_chat'
          case 'read_channel':
            return 'microsoft_teams_read_channel'
          case 'write_channel':
            return 'microsoft_teams_write_channel'
          default:
            return 'microsoft_teams_read_chat'
        }
      },
      params: (params) => {
        const {
          credential,
          operation,
          teamId,
          manualTeamId,
          chatId,
          manualChatId,
          channelId,
          manualChannelId,
          ...rest
        } = params

        // Use the selected IDs or the manually entered ones
        const effectiveTeamId = (teamId || manualTeamId || '').trim()
        const effectiveChatId = (chatId || manualChatId || '').trim()
        const effectiveChannelId = (channelId || manualChannelId || '').trim()

        // Build the parameters based on operation type
        const baseParams = {
          ...rest,
          credential,
        }

        // For chat operations, we need chatId
        if (operation === 'read_chat' || operation === 'write_chat') {
          if (!effectiveChatId) {
            throw new Error(
              'Chat ID is required for chat operations. Please select a chat or enter a chat ID manually.'
            )
          }
          return {
            ...baseParams,
            chatId: effectiveChatId,
          }
        }

        // For channel operations, we need teamId and channelId
        if (operation === 'read_channel' || operation === 'write_channel') {
          if (!effectiveTeamId) {
            throw new Error(
              'Team ID is required for channel operations. Please select a team or enter a team ID manually.'
            )
          }
          if (!effectiveChannelId) {
            throw new Error(
              'Channel ID is required for channel operations. Please select a channel or enter a channel ID manually.'
            )
          }
          return {
            ...baseParams,
            teamId: effectiveTeamId,
            channelId: effectiveChannelId,
          }
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    messageId: { type: 'string', required: false },
    chatId: { type: 'string', required: false },
    manualChatId: { type: 'string', required: false },
    channelId: { type: 'string', required: false },
    manualChannelId: { type: 'string', required: false },
    teamId: { type: 'string', required: false },
    manualTeamId: { type: 'string', required: false },
    content: { type: 'string', required: false },
  },
  outputs: {
    content: 'string',
    metadata: 'json',
    updatedContent: 'boolean',
  },
}
