import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfigField } from '../ui/config-field'
import { ConfigSection } from '../ui/config-section'
import { InstructionsSection } from '../ui/instructions-section'
import { TestResultDisplay as WebhookTestResult } from '../ui/test-result'

interface TelegramConfigProps {
  botToken: string
  setBotToken: (value: string) => void
  isLoadingToken: boolean
  testResult: any
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
  testWebhook?: () => void // Optional test function
  webhookId?: string // Webhook ID to enable testing
  webhookUrl: string // Added webhook URL
}

export function TelegramConfig({
  botToken,
  setBotToken,
  isLoadingToken,
  testResult,
  copied,
  copyToClipboard,
  testWebhook,
  webhookId,
  webhookUrl,
}: TelegramConfigProps) {
  return (
    <div className='space-y-4'>
      <ConfigSection title='Telegram Configuration'>
        <ConfigField
          id='telegram-bot-token'
          label='Bot Token *'
          description='Your Telegram Bot Token from BotFather'
        >
          {isLoadingToken ? (
            <Skeleton className='h-10 w-full' />
          ) : (
            <Input
              id='telegram-bot-token'
              value={botToken}
              onChange={(e) => {
                setBotToken(e.target.value)
              }}
              placeholder='123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
              type='password'
              required
            />
          )}
        </ConfigField>
      </ConfigSection>

      {testResult && (
        <WebhookTestResult
          testResult={testResult}
          copied={copied}
          copyToClipboard={copyToClipboard}
        />
      )}

      <InstructionsSection>
        <ol className='list-inside list-decimal space-y-2'>
          <li>
            Message "/newbot" to{' '}
            <a
              href='https://t.me/BotFather'
              target='_blank'
              rel='noopener noreferrer'
              className='link text-primary underline transition-colors hover:text-primary/80'
              onClick={(e) => {
                e.stopPropagation()
                window.open('https://t.me/BotFather', '_blank', 'noopener,noreferrer')
                e.preventDefault()
              }}
            >
              @BotFather
            </a>{' '}
            in Telegram to create a bot and copy its token.
          </li>
          <li>Enter your Bot Token above.</li>
          <li>Save settings and any message sent to your bot will trigger the workflow.</li>
        </ol>
      </InstructionsSection>
    </div>
  )
}
