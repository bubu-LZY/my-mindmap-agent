export async function execute(args, context) {
  const ms = Number(args.sleep_ms)
  if (!Number.isFinite(ms) || ms < 0) {
    return { success: false, message: 'sleep_ms 必须是大于等于 0 的数字' }
  }
  await new Promise((resolve) => setTimeout(resolve, ms))
  return {
    success: true,
    message: `已等待 ${ms}ms（未超时）`,
    data: { sleptMs: ms }
  }
}
