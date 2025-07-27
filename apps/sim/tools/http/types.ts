import type { HttpMethod, TableRow, ToolResponse } from '@/tools/types'

export interface RequestParams {
  url: string
  method?: HttpMethod
  headers?: TableRow[]
  body?: any
  params?: TableRow[]
  pathParams?: Record<string, string>
  formData?: Record<string, string | Blob>
  timeout?: number
  validateStatus?: (status: number) => boolean
}

export interface RequestResponse extends ToolResponse {
  output: {
    data: any
    status: number
    headers: Record<string, string>
  }
}
