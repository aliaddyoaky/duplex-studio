import type { ProjectState, ScriptPlan } from '../../shared/schemas.js';

export function ScriptReview(props: { state: ProjectState; onConfirm(): void; onChangeSource?(sceneId: string, source: 'generated_video' | 'existing_asset'): void; busy?: boolean }) {
  const script = props.state.script;
  if (!script) return <div className="script-review empty-copy">脚本正在生成…</div>;
  return (
    <div className="script-review">
      <div className="review-banner"><div><span className="eyebrow">脚本审阅 · 等待确认</span><h3>{props.state.brief.product} · {script.durationSec} 秒</h3><p>{script.compliance.passed ? '口播时长与平台约束已通过' : script.compliance.notes.join('；')}</p></div><button className="primary-action" onClick={props.onConfirm} disabled={props.busy}>开始制作</button></div>
      <div className="review-grid"><div><span className="eyebrow">统一音频方案</span><p className="review-copy">BGM：{script.audioPlan.bgm.style} · {script.audioPlan.bgm.intensity}</p><p className="review-copy">口播 {script.audioPlan.ducking.voiceoverDb} dB · BGM {script.audioPlan.ducking.bgmDb} dB · 音效 {script.audioPlan.soundEffects.length} 个</p></div><div><span className="eyebrow">制作方向</span><p className="review-copy">{props.state.creative.style || '等待创意方向'} · {props.state.creative.sellingPoint || '待提炼卖点'}</p><p className="review-copy">开场钩子：{props.state.creative.hook || '暂无'}<br />判断依据：{props.state.creative.rationale || '暂无'}</p></div></div>
      <div className="shot-review"><div className="eyebrow">分镜与素材决策</div>{script.shots.map((shot) => <ShotRow key={shot.id} shot={shot} currentSource={props.state.scenes[shot.order - 1]?.source} onChange={(source) => props.onChangeSource?.(props.state.scenes[shot.order - 1]?.id ?? shot.id, source)} />)}</div>
    </div>
  );
}

function ShotRow(props: { shot: ScriptPlan['shots'][number]; currentSource?: 'generated_video' | 'existing_asset'; onChange(source: 'generated_video' | 'existing_asset'): void }) {
  const existing = (props.currentSource ?? props.shot.sourceDecision.kind) === 'existing_asset';
  return <article className="shot-row"><span className="shot-number">{String(props.shot.order).padStart(2, '0')}</span><div className="shot-copy"><b>{props.shot.visualDescription}</b><p>口播：{props.shot.voiceover || '无'} · {props.shot.musicAndSfx}</p><small>{existing ? `匹配真实素材${props.shot.sourceDecision.candidates.length ? `：${props.shot.sourceDecision.candidates.join('、')}` : ''}` : `AIGC 生成：${props.shot.aigcPrompt ?? props.shot.sourceDecision.reason}`}</small></div><button className={`source-toggle ${existing ? 'existing' : ''}`} title="切换素材来源" onClick={() => props.onChange(existing ? 'generated_video' : 'existing_asset')}>{existing ? '真实素材' : 'AI 生成'}</button></article>;
}
