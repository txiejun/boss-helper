// import axios from 'axios'

import {
  GreetError,
  LimitError,
  PublishError,
  RateLimitError,
} from '@/composables/useApplying/deliverError'
import { calculateFileMD5 } from '@/utils/file'

import type { BossZpBossData, BossZpDetailData } from './types'

// const { userInfo } = useStore()

export const sameCompanyKey = 'local:sameCompany'
export const sameHrKey = 'local:sameHr'

export async function getJobDetail(params: { securityId: string; lid: string }): Promise<{
  code: number
  message: string
  zpData: BossZpDetailData
}> {
  const token = window?.Cookie.get('bst')
  if (!token) {
    throw Object.assign(new PublishError('登录已失效，请重新登录'), { fatal: true })
  }
  const url = new URL('https://www.zhipin.com/wapi/zpgeek/job/detail.json')
  url.searchParams.set('securityId', params.securityId)
  url.searchParams.set('lid', params.lid)
  url.searchParams.set('_', String(Date.now()))

  return fetch(url.toString(), {
    headers: { Zp_token: token },
    signal: AbortSignal.timeout(5000),
  }).then((r) => r.json())
}

let pageController = new AbortController()
pageController.abort()
export function beginPageOperations() {
  pageController = new AbortController()
}
export function cancelPageOperations() {
  pageController.abort()
}
export function assertPageActive() {
  pageController.signal.throwIfAborted()
}
export function pageSignal() {
  return pageController.signal
}
function classify(code: number, message: string) {
  if (code === 0) return
  if (/频繁|限流|稍后再试/.test(message))
    throw Object.assign(new RateLimitError(message), { fatal: true })
  if (/上限|限制|限额|今天已与|今日已与/.test(message))
    throw Object.assign(new LimitError(message), { fatal: true })
  throw Object.assign(new PublishError(message || `平台返回错误 ${code}`), { fatal: true })
}
async function pageFetch(
  url: string | URL,
  init: RequestInit = {},
  readOnly = false,
  allowCacheMiss = false,
): Promise<any> {
  const attempts = readOnly ? 3 : 1
  for (let i = 0; i < attempts; i++) {
    assertPageActive()
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.any([pageController.signal, AbortSignal.timeout(15000)]),
      })
      if (!response.ok)
        throw Object.assign(new Error(`平台请求失败 HTTP ${response.status}`), {
          fatal: true,
          uncertain: !readOnly,
        })
      const result = await response.json()
      if (typeof result?.code !== 'number')
        throw Object.assign(new Error('平台响应格式异常'), { fatal: true, uncertain: !readOnly })
      const message = String(
        result?.zpData?.bizData?.chatRemindDialog?.content || result.message || '',
      )
      if (!allowCacheMiss || /频繁|限流|限制|上限|限额|登录|验证|权限/.test(message))
        classify(result.code, message)
      return result
    } catch (e) {
      if ((e as any)?.fatal) throw e
      if (!readOnly)
        throw Object.assign(new Error('操作结果不确定，请核实平台状态；未自动重试'), {
          fatal: true,
          uncertain: true,
        })
      if (pageController.signal.aborted) throw e
      if (i === attempts - 1) throw e
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer)
          reject(pageController.signal.reason)
        }
        const timer = setTimeout(
          () => {
            pageController.signal.removeEventListener('abort', onAbort)
            resolve()
          },
          500 * 2 ** i,
        )
        pageController.signal.addEventListener('abort', onAbort, { once: true })
      })
    }
  }
}
export async function sendPublishReq(data: { securityId: string; encryptJobId: string }) {
  assertPageActive()
  const token = window.Cookie?.get('bst')
  if (!token) throw Object.assign(new PublishError('登录已失效，请重新登录'), { fatal: true })
  const url = new URL('https://www.zhipin.com/wapi/zpgeek/friend/add.json')
  url.searchParams.set('securityId', data.securityId)
  url.searchParams.set('jobId', data.encryptJobId)
  return pageFetch(url, { method: 'POST', headers: { Zp_token: token } })
}

export async function getBossData(job: {
  encryptUserId: string
  securityId: string
}): Promise<BossZpBossData> {
  const token = window.Cookie?.get('bst')
  if (!token) throw Object.assign(new GreetError('登录已失效，请重新登录'), { fatal: true })
  const body = new FormData()
  body.append('bossId', job.encryptUserId)
  body.append('securityId', job.securityId)
  body.append('bossSrc', '0')
  const result = await pageFetch(
    'https://www.zhipin.com/wapi/zpchat/geek/getBossData',
    { method: 'POST', headers: { Zp_token: token }, body },
    true,
  )
  return result.zpData
}

export async function uploadImage(securityId: string, file: File) {
  const token = window?.Cookie.get('bst')
  if (!token) {
    throw Object.assign(new Error('登录已失效，请重新登录'), { fatal: true })
  }

  const params = new URLSearchParams()
  params.append('fileMd5', await calculateFileMD5(file))
  params.append('fileSize', file.size.toString())
  params.append('source', 'chat_file')
  params.append('securityId', securityId)

  const quickRes: {
    code: number
    message: string
    zpData?: {
      metadata: {
        width: number
        height: number
        fileSize: number
        contentMd5: string
        originFilename: string
        aigcMetadataBO: {
          label: number
          contentProducer: any
          produceID: any
          reserveCode1: any
          contentPropagator: any
          propagateID: any
          reserveCode2: any
          aigcempty: boolean
          aigcnotEmpty: boolean
        }
      }
      url: string
      relativeUrl: string
      source: string
      tinyUrl: string
      relativeTinyUrl: string
      waterUrl: any
      relativeWaterUrl: any
      flagKey: any
      fileName: any
    }
  } = await pageFetch(
    'https://www.zhipin.com/wapi/zpupload/quicklyUpload',
    {
      headers: {
        zp_token: token,
      },
      referrer: 'https://www.zhipin.com/web/geek/chat',
      body: params,
      method: 'POST',
    },
    true,
    true,
  )
  assertPageActive()
  if (quickRes.code === 0 && quickRes.zpData && quickRes.zpData.url) {
    return {
      tinyImage: {
        url: quickRes.zpData.tinyUrl,
        width: 200,
        height: 118,
      },
      originImage: {
        url: quickRes.zpData.url,
        width: quickRes.zpData.metadata.width,
        height: quickRes.zpData.metadata.height,
      },
    }
  }
  assertPageActive()
  const body = new FormData()
  body.append('securityId', securityId)

  body.append('source', 'chat_file')
  body.append('file', file, file.name)

  const res: {
    code: number
    message: string
    zpData: {
      metadata: {
        width: number
        height: number
        fileSize: number
        contentMd5: string
        originFilename: string
        aigcMetadataBO: {
          label: number
          contentProducer: any
          produceID: any
          reserveCode1: any
          contentPropagator: any
          propagateID: any
          reserveCode2: any
          aigcnotEmpty: boolean
          aigcempty: boolean
        }
      }
      url: string
      relativeUrl: string
      source: string
      tinyUrl: string
      relativeTinyUrl: string
      waterUrl: any
      relativeWaterUrl: any
      flagKey: any
      fileName: any
    }
  } = await pageFetch('https://www.zhipin.com/wapi/zpupload/image/uploadSingle', {
    headers: {
      zp_token: token,
    },
    referrer: 'https://www.zhipin.com/web/geek/chat',
    body: body,
    method: 'POST',
  })
  if (res.code !== 0) {
    throw new Error('上传图片失败:' + res.message)
  }
  return {
    tinyImage: {
      url: res.zpData.tinyUrl,
      width: 200,
      height: 118,
    },
    originImage: {
      url: res.zpData.url,
      width: res.zpData.metadata.width,
      height: res.zpData.metadata.height,
    },
  }
}
