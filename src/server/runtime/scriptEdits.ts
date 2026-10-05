import type { ProjectState } from '../../shared/schemas.js';

// Both public path formats are supported; edited fields always win over their stored mirrors.
export function reconcileScriptEdits(state: ProjectState, fields: string[]): void {
  const script = state.script;
  if (!script) return;
  for (const [index, scene] of state.scenes.entries()) {
    const shot = script.shots.find((item) => item.id === scene.id);
    if (!shot) continue;
    const sceneChanged = (field: string) => fields.some((path) => path === `scenes.${scene.id}.${field}` || path === `scenes.${index}.${field}`);
    const shotChanged = (field: string) => fields.some((path) => path === `script.shots.${scene.id}.${field}` || path === `script.shots.${index}.${field}` || path === 'script.shots');
    if (shotChanged('visualDescription')) scene.visualDescription = shot.visualDescription;
    if (shotChanged('durationSec')) scene.durationSec = shot.durationSec;
    if (shotChanged('voiceover')) scene.narration = shot.voiceover;
    if (shotChanged('sourceDecision.kind') || shotChanged('sourceDecision')) scene.source = shot.sourceDecision.kind;
    if (shotChanged('existingClip') || fields.some((p) => p.startsWith(`script.shots.${scene.id}.existingClip.`) || p.startsWith(`script.shots.${index}.existingClip.`))) {
      scene.assetId = shot.existingClip?.assetId;
      scene.startSec = shot.existingClip?.startSec;
    }
    if (shotChanged('aigcPrompt')) scene.generationPrompt = shot.aigcPrompt;
    else if ((shotChanged('visualDescription') || sceneChanged('visualDescription')) && !sceneChanged('generationPrompt')) {
      scene.generationPrompt = scene.visualDescription;
    }
    shot.visualDescription = scene.visualDescription;
    shot.durationSec = scene.durationSec;
    shot.aigcPrompt = scene.source === 'generated_video' ? scene.generationPrompt ?? scene.visualDescription : undefined;
    shot.sourceDecision.kind = scene.source;
    if (sceneChanged('narration')) shot.voiceover = scene.narration ?? '';
    if (sceneChanged('assetId') || sceneChanged('startSec')) {
      shot.existingClip = scene.assetId ? { assetId: scene.assetId, startSec: scene.startSec } : undefined;
    }
  }
  if (fields.some((path) => /(^script\.shots($|\.)|^scenes\.)/.test(path)) && !fields.includes('script.voiceover')) {
    script.voiceover = script.shots.map((shot) => shot.voiceover).filter(Boolean).join('\n');
  }
  script.durationSec = state.scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
}
