import { useState } from 'react';
import type { Artifact, ProjectState, TaskRecord } from '../../shared/schemas.js';
import { mediaUrl } from '../api.js';
import { ScriptReview } from './ScriptReview.js';

export function CreativeCanvas(props: {
  state: ProjectState | null;
  tasks: TaskRecord[];
  artifacts: Artifact[];
  onCreateProject?:(brief: ProjectState['brief']) => void;
  onConfirmScript?(): void;
  onChangeSource?(sceneId: string, source: 'generated_video' | 'existing_asset'): void;
  busy?: boolean;
}) {
  const preview = props.state?.preview;
  const renderTask = props.tasks.find((task) => task.type === 'render' && task.stateVersion === props.state?.version);
  // phase 已 FAILED（如视频额度不足导致镜头全部失败）时，渲染永远不会执行，应直接提示失败
  const renderFailed = renderTask?.status === 'failed' || props.state?.phase === 'FAILED';
  return (
    <section className="panel canvas-panel">
      <div className="panel-heading canvas-heading">
        <div>
          <span className="eyebrow">创意画布</span>
          <h2>15 秒广告 · 9:16</h2>
        </div>
        <span className="version-pill">状态 v{props.state?.version ?? '—'}</span>
      </div>

      {!props.state ? (
        <div className="canvas-empty">
          <div className="empty-frame">＋</div>
          <h3>先描述你的广告需求</h3>
          <p>素材上传后，输入简报，AI 会先生成脚本和分镜供你确认。</p>
          <BriefForm onSubmit={props.onCreateProject} disabled={props.busy} />
        </div>
      ) : (
        <>
          {props.state.phase === 'SCRIPT_REVIEW' ? <ScriptReview state={props.state} onConfirm={() => props.onConfirmScript?.()} onChangeSource={props.onChangeSource} busy={props.busy} /> : <><div className="scene-grid">
            {props.state.scenes.map((scene, index) => {
              const task = latestSceneTask(props.tasks, scene.id);
              const artifact = findSceneArtifact(props.artifacts, task);
              return (
                <article className="scene-card" key={scene.id}>
                  <div className="scene-preview">
                    {artifact ? <video src={mediaUrl(artifact.uri)} muted playsInline controls preload="metadata" /> : <div className="scene-placeholder">0{index + 1}</div>}
                    <span className={`source-badge ${scene.source}`}>{scene.source === 'generated_video' ? 'AI 视频' : '真实素材'}</span>
                    {task && <span className={`task-chip ${task.status}`}>{taskStatusLabel(task.status)}</span>}
                  </div>
                  <div className="scene-meta">
                    <div><b>镜头 {index + 1}</b><span>{scene.durationSec} 秒</span></div>
                    <p>{scene.visualDescription}</p>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="final-preview">
            <div className="final-copy">
              <span className="eyebrow">最终输出</span>
              <h3>{preview ? `preview_v${props.state.version}.mp4` : renderFailed ? '预览生成失败' : '正在合成预览…'}</h3>
              <p>{preview ? 'FFmpeg · 720×1280 · MP4 成品' : renderFailed ? '请检查视频额度，或切换到混合模式继续演示。' : '等待当前版本的镜头素材。'}</p>
            </div>
            <div className="phone-preview">
              {preview ? (
                <video src={mediaUrl(preview.uri)} controls playsInline loop />
              ) : renderFailed ? (
                <div className="rendering-state">预览不可用</div>
              ) : (
                <div className="rendering-state"><span className="spinner" />正在渲染</div>
              )}
            </div>
          </div></>}
        </>
      )}
    </section>
  );
}

function BriefForm(props: { onSubmit?: (brief: ProjectState['brief']) => void; disabled?: boolean }) {
  const [brief, setBrief] = useState<ProjectState['brief']>({ product: '低糖气泡咖啡', audience: '大学生', platform: 'douyin', duration: 15 });
  return <form className="brief-form" onSubmit={(event) => { event.preventDefault(); props.onSubmit?.(brief); }}><label>产品<input value={brief.product} onChange={(event) => setBrief({ ...brief, product: event.target.value })} /></label><label>目标受众<input value={brief.audience} onChange={(event) => setBrief({ ...brief, audience: event.target.value })} /></label><label>平台<select value={brief.platform} onChange={(event) => setBrief({ ...brief, platform: event.target.value })}><option value="douyin">抖音</option><option value="xiaohongshu">小红书</option><option value="bilibili">B 站</option></select></label><label>时长<input type="number" min="5" max="60" value={brief.duration} onChange={(event) => setBrief({ ...brief, duration: Number(event.target.value) })} /></label><button className="primary-action" type="submit" disabled={props.disabled}>{props.disabled ? '正在生成脚本…' : '生成脚本并审阅'}</button></form>;
}

function latestSceneTask(tasks: TaskRecord[], sceneId: string): TaskRecord | undefined {
  return [...tasks]
    .filter((task) => task.type === `generated_scene:${sceneId}`)
    .sort((a, b) => b.stateVersion - a.stateVersion)[0];
}

function findSceneArtifact(artifacts: Artifact[], task?: TaskRecord): Artifact | undefined {
  const artifactId = task?.artifactIds?.at(-1);
  return artifactId ? artifacts.find((artifact) => artifact.id === artifactId) : undefined;
}

function taskStatusLabel(status: string) {
  return {
    queued: '排队中',
    running: '运行中',
    completed: '已完成',
    cancelled: '已取消',
    stale: '已过期',
    failed: '失败',
  }[status] ?? status;
}
