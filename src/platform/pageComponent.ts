// BOSS mounts the route's Vue component after the outer application root.
// Check every matching element: an earlier layout wrapper may not own a VM.
const selectors = '#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main'

export function findJobComponent(): any | undefined {
  for (const element of document.querySelectorAll<any>(selectors)) {
    const vm = element.__vue__
    if (vm && Array.isArray(vm.jobList)) return vm
  }
}

export async function waitForJobComponent(timeout = 20000): Promise<any> {
  const deadline = Date.now() + timeout
  do {
    const vm = findJobComponent()
    if (vm) return vm
    await new Promise((resolve) => setTimeout(resolve, 100))
  } while (Date.now() < deadline)
  throw new Error('未找到 BOSS 岗位组件，请进入职位列表后刷新页面')
}
