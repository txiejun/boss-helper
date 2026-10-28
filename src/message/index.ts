import type { StorageLikeAsync } from '@vueuse/core'

import { ContentCounter } from './contentScript'
export const counter = new ContentCounter()
export function initCounter() {
  /* Counter runs only in the extension isolated world. */
}
export const ExtStorage: StorageLikeAsync = {
  getItem: (key) => counter.storageGet(key) as Promise<any>,
  setItem: (key, value) => counter.storageSet(key, value),
  removeItem: (key) => counter.storageRm(key),
}
