// 主进程统一的错误类型

/** 用户主动取消 / 流程被中断 */
export class CancelledError extends Error {
  constructor() {
    super('已取消')
    this.name = 'CancelledError'
  }
}

/** 业务流程错误（型号不匹配、写入失败等），消息直接面向用户 */
export class FlowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowError'
  }
}

/** 单条 adb 命令超时（按 FlowError 处理，向用户展示消息） */
export class TimeoutError extends FlowError {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}
