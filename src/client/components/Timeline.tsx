import type { RuntimeEvent } from '../../shared/events.js';
import { friendlyErrorMessage } from '../friendlyErrors.js';

export function Timeline({ events }: { events: RuntimeEvent[] }) {
  const visible = events.slice(-12);
  return (
    <div className="timeline-wrap">
      <div className="subheading">事件时间线</div>
      <div className="timeline">
        {visible.length === 0 ? <span className="timeline-empty">等待运行时事件…</span> : visible.map((event) => (
          <details className={`timeline-event ${event.type === 'STALE_RESULT_DROPPED' || isFailedEvent(event) ? 'danger' : ''}`} key={event.sequence}>
            <summary><span className="timeline-dot" /><b>{shortEvent(event)}</b><small>v{event.stateVersion ?? '—'} · #{event.sequence}</small></summary>
            {isFailedEvent(event) && (
              <p className="timeline-error-summary">{friendlyErrorMessage(typeof event.payload.error === 'string' ? event.payload.error : '')}</p>
            )}
            <pre>{JSON.stringify(event.payload, null, 2)}</pre>
          </details>
        ))}
      </div>
    </div>
  );
}

function isFailedEvent(event: RuntimeEvent): boolean {
  return event.type === 'VIDEO_JOB_COMPLETED' && event.payload.status === 'failed';
}

function shortEvent(event: RuntimeEvent) {
  if (event.type === 'VIDEO_JOB_COMPLETED' && event.payload.status === 'failed') return '视频任务失败';
  const labels: Partial<Record<RuntimeEvent['type'], string>> = {
    INTENT_PATCH_COMMITTED: '意图修改已提交',
    NEW_TASK_GRAPH_STARTED: '开始重规划',
    STALE_RESULT_DROPPED: '过期结果已丢弃',
    VIDEO_JOB_SUBMITTED: '视频任务已提交',
    VIDEO_JOB_PROGRESS: '视频任务处理中',
    VIDEO_JOB_COMPLETED: '视频任务完成',
    TASK_STARTED: '任务开始',
    TASK_COMPLETED: '任务完成',
    TASK_REUSED: '任务复用',
    TASK_CANCELLED: '任务取消',
    USER_SPEECH_START: '用户开始说话',
    USER_SPEECH_END: '用户结束说话',
    AGENT_RESPONSE_START: '代理开始响应',
    AGENT_INTERRUPTED: '代理响应已中断',
    STATE_UPDATED: '状态已更新',
    PREVIEW_READY: '预览已就绪',
  };
  return labels[event.type] ?? event.type.replaceAll('_', ' ');
}
