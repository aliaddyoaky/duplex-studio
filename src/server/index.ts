import goldenProject from '../../demo/fixtures/golden-project.json';
import { createApp } from './app.js';
import { CreativeBrain } from './agents/creativeBrain.js';
import { loadConfig } from './config.js';
import {
  DemoOrchestrator,
  type DemoPlanner,
} from './demo/orchestrator.js';
import { ReplayCatalog } from './demo/replay.js';
import { GeminiLiveTokenProvider } from './providers/liveTokenProvider.js';
import { DeepSeekReasoningProvider } from './providers/reasoningProvider.js';
import { MiniMaxVideoProvider, type VideoArtifact, type VideoProvider } from './providers/videoProvider.js';
import { CreativePlanSchema } from './tools/creativeTools.js';
import { AssetLibrary } from './assets/assetLibrary.js';

try {
  process.loadEnvFile?.('.env.local');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const config = loadConfig();
const replayCatalog = new ReplayCatalog(goldenProject.replayVideos);
const fallbackVideoByScene = Object.fromEntries(
  Object.entries(goldenProject.replayVideos).map(([sceneId, uri]) => [
    sceneId,
    {
      id: `fallback_${sceneId}`,
      type: 'video',
      uri,
      source: 'fallback',
      stateVersion: 0,
      sessionEpoch: 0,
    } satisfies VideoArtifact,
  ]),
);

const fixturePlanner: DemoPlanner = {
  plan: async (state) =>
    CreativePlanSchema.parse(state.version === 1 ? goldenProject.initialPlan : goldenProject.turn2Plan),
};

let planner: DemoPlanner;
let videoProvider: VideoProvider;
if (config.server.deepseekApiKey) {
  planner = new CreativeBrain(
    new DeepSeekReasoningProvider({
      apiKey: config.server.deepseekApiKey,
      model: config.server.reasoningModel,
      reasoningEffort: 'low',
    }),
  );
} else {
  planner = fixturePlanner;
}

if (config.server.minimaxApiKey) {
  videoProvider = new MiniMaxVideoProvider({
    apiKey: config.server.minimaxApiKey,
    apiHost: config.server.minimaxApiHost,
    model: config.server.videoModel,
  });
} else {
  videoProvider = {
    generate: async () => {
      throw new Error('Live video generation requires MINIMAX_API_KEY');
    },
  };
}

const assetLibrary = new AssetLibrary();
const orchestrator = new DemoOrchestrator({
  assetLibrary,
  planner,
  replayPlanner: fixturePlanner,
  videoProvider,
  replayCatalog,
  fallbackVideoByScene,
  allowHybridFallback: true,
});
const allLiveProvidersReady = Boolean(
  config.server.geminiApiKey && config.server.deepseekApiKey && config.server.minimaxApiKey,
);
orchestrator.setMode(
  config.server.demoMode === 'REPLAY'
    ? 'REPLAY'
    : allLiveProvidersReady
      ? config.server.demoMode
      : 'HYBRID',
);

const app = createApp({
  assetLibrary,
  liveTokenProvider: config.server.geminiApiKey
    ? new GeminiLiveTokenProvider({ apiKey: config.server.geminiApiKey })
    : undefined,
  demoOrchestrator: orchestrator,
  eventLog: orchestrator.eventLog,
  getSnapshot: () => {
    const snapshot = orchestrator.snapshot();
    return {
      state: snapshot.state,
      tasks: snapshot.tasks,
      artifacts: snapshot.artifacts,
      mode: snapshot.mode,
      sessionEpoch: snapshot.sessionEpoch,
      graph: snapshot.graph,
      rejectedArtifacts: snapshot.rejectedArtifacts,
    };
  },
});

app.listen(config.server.port, () => {
  console.log(`Duplex Studio runtime listening on http://localhost:${config.server.port}`);
});
