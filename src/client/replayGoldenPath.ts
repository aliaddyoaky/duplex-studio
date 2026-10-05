import {
  applyIntentPatch,
  createProject,
  fetchSnapshot,
  resetDemo,
  setDemoMode,
  confirmScript,
} from './api.js';
import type { IntentPatch, ProjectState } from '../shared/schemas.js';

const GOLDEN_BRIEF: ProjectState['brief'] = {
  product: '低糖气泡咖啡',
  audience: '大学生',
  platform: 'douyin',
  duration: 15,
};

const TURN_2: IntentPatch = {
  patchId: 'patch_02',
  baseVersion: 1,
  changes: {
    'creative.sellingPoint': 'low_sugar',
    'creative.style': 'campus_vlog',
    'creative.tone': 'authentic',
  },
  userSummary: '不要强调提神，重点突出低糖，而且像大学生真实生活记录',
};

const TURN_3: IntentPatch = {
  patchId: 'patch_03',
  baseVersion: 2,
  changes: { 'scenes.scene_3.source': 'existing_asset' },
  userSummary: '第三个镜头别生成了，换成真实产品素材',
};

export interface GoldenReplayApi {
  setMode(): Promise<unknown>;
  reset(): Promise<unknown>;
  create(brief: ProjectState['brief']): Promise<unknown>;
  confirm(): Promise<unknown>;
  patch(patch: IntentPatch): Promise<unknown>;
  waitForPreview(version: number): Promise<unknown>;
}

const defaultApi: GoldenReplayApi = {
  setMode: () => setDemoMode('REPLAY'),
  reset: resetDemo,
  create: createProject,
  confirm: async () => {
    const { state } = await fetchSnapshot();
    if (!state) throw new Error('No replay project');
    return confirmScript(state.projectId, state.version);
  },
  patch: applyIntentPatch,
  waitForPreview: waitForPreviewVersion,
};

export async function runGoldenReplay(api: GoldenReplayApi = defaultApi): Promise<void> {
  await api.setMode();
  await api.reset();
  await api.create(GOLDEN_BRIEF);
  await api.confirm();
  await api.waitForPreview(1);
  await api.patch(TURN_2);
  await api.confirm();
  await api.waitForPreview(2);
  await api.patch(TURN_3);
  await api.confirm();
  await api.waitForPreview(3);
}

async function waitForPreviewVersion(version: number): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const snapshot = await fetchSnapshot();
    if (snapshot.state?.preview?.stateVersion === version) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for replay preview v${version}`);
}
