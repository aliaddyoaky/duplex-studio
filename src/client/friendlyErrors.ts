// 供应商原始错误 → 用户可读的中文提示。
// 匹配不到已知模式时原样返回（保留调试价值），调用方负责截断展示。
export function friendlyErrorMessage(message: string): string {
  if (/insufficient_balance|余额不足|402/i.test(message)) {
    return '视频生成失败：MiniMax 账户余额不足。请充值后重试，或切换到混合模式继续演示。';
  }
  if (/invalid api key|401/i.test(message)) {
    return '视频生成失败：MiniMax API Key 无效或区域主机不匹配。';
  }
  if (/429|rate.?limit|限流/i.test(message)) {
    return '视频生成失败：请求过于频繁被限流，请稍后重试。';
  }
  if (/timeout|超时|ETIMEDOUT/i.test(message)) {
    return '视频生成失败：请求超时，请重试。';
  }
  if (/insufficient_quota|RESOURCE_EXHAUSTED/i.test(message)) {
    return '生成失败：API 配额不足。';
  }
  return message;
}
