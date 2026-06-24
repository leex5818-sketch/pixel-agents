import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

// Load .env file from project root if present
const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && val && !process.env[key]) process.env[key] = val;
  }
}
import Anthropic from "@anthropic-ai/sdk";
import { JsonlWatcher, type WatchedFile } from "./watcher.js";
import { processTranscriptLine } from "./parser.js";
import {
  loadCharacterSprites,
  loadWallTiles,
  loadFloorTiles,
  loadFurnitureAssets,
  loadDefaultLayout,
} from "./assetLoader.js";
import type { TrackedAgent, ServerMessage } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3456", 10);
const IDLE_SHUTDOWN_MS = 600_000; // 10 minutes

// State
const agents = new Map<string, TrackedAgent>(); // sessionId -> agent
const closedSessionIds = new Set<string>(); // manually closed — won't reappear until restart
let nextAgentId = 1;
const clients = new Set<WebSocket>();
let lastActivityTime = Date.now();

// Load assets at startup
// In dev mode (tsx), __dirname is server/ so assets are at ../webview-ui/public/assets/
// In production (esbuild), __dirname is dist/ so assets are at ./public/assets/
const devAssetsRoot = join(__dirname, "..", "webview-ui", "public", "assets");
const prodAssetsRoot = join(__dirname, "public", "assets");
const assetsRoot = existsSync(devAssetsRoot) ? devAssetsRoot : prodAssetsRoot;

console.log(`[Server] Loading assets from: ${assetsRoot}`);

const characterSprites = loadCharacterSprites(assetsRoot);
const wallTiles = loadWallTiles(assetsRoot);
const floorTiles = loadFloorTiles(assetsRoot);
const furnitureAssets = loadFurnitureAssets(assetsRoot);

// Persistence directory
const persistDir = join(homedir(), ".pixel-agents");
const persistedLayoutPath = join(persistDir, "layout.json");
const persistedSeatsPath = join(persistDir, "agent-seats.json");

// Load layout: persisted first, then default
function loadLayout(): Record<string, unknown> | null {
  if (existsSync(persistedLayoutPath)) {
    try {
      const content = readFileSync(persistedLayoutPath, "utf-8");
      const layout = JSON.parse(content) as Record<string, unknown>;
      console.log(`[Server] Loaded persisted layout from ${persistedLayoutPath}`);
      return layout;
    } catch (err) {
      console.warn(`[Server] Failed to load persisted layout: ${err instanceof Error ? err.message : err}`);
    }
  }
  return loadDefaultLayout(assetsRoot);
}

function loadPersistedSeats(): Record<number, { palette: number; hueShift: number; seatId: string | null }> | null {
  if (existsSync(persistedSeatsPath)) {
    try {
      const content = readFileSync(persistedSeatsPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
  return null;
}

let currentLayout = loadLayout();
const persistedSeats = loadPersistedSeats();

// Anthropic client (lazy — only created if API key exists)
let anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic | null {
  if (anthropic) return anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  anthropic = new Anthropic({ apiKey });
  return anthropic;
}

// Cache for summarized session topics: sessionId -> Korean summary
const topicCachePath = join(homedir(), ".pixel-agents", "session-topics.json");
let topicCache: Record<string, string> = {};
try {
  if (existsSync(topicCachePath)) {
    topicCache = JSON.parse(readFileSync(topicCachePath, "utf-8"));
  }
} catch { /* ignore */ }

function saveTopicCache(): void {
  try {
    mkdirSync(join(homedir(), ".pixel-agents"), { recursive: true });
    writeFileSync(topicCachePath, JSON.stringify(topicCache, null, 2));
  } catch { /* ignore */ }
}

// Read the first meaningful human message from a JSONL session file
function extractSessionTopic(filePath: string): string | undefined {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj.type !== "user") continue;
        const msg = obj.message as Record<string, unknown> | undefined;
        const parts = msg?.content;
        if (Array.isArray(parts)) {
          for (const part of parts as Record<string, unknown>[]) {
            if (part?.type === "text" && typeof part.text === "string") {
              const text = (part.text as string).trim();
              // Skip system-injected content and very short messages
              if (
                text.length < 8 ||
                text.startsWith("[Request interrupted") ||
                text.startsWith("This session is being continued") ||
                text.startsWith("<") ||
                text.startsWith("#")
              ) continue;
              return text.slice(0, 120).replace(/\n/g, " ");
            }
          }
        } else if (typeof parts === "string" && (parts as string).length >= 8) {
          return (parts as string).slice(0, 120).replace(/\n/g, " ");
        }
      } catch { /* skip invalid JSON lines */ }
    }
  } catch { /* file may not exist or be unreadable */ }
  return undefined;
}

// Extract up to N user messages for summarization context
function extractUserMessages(filePath: string, maxMessages = 5): string[] {
  const msgs: string[] = [];
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj.type !== "user") continue;
        const parts = (obj.message as Record<string, unknown>)?.content;
        let text = "";
        if (Array.isArray(parts)) {
          for (const part of parts as Record<string, unknown>[]) {
            if (part?.type === "text" && typeof part.text === "string") {
              text = (part.text as string).trim();
              break;
            }
          }
        } else if (typeof parts === "string") {
          text = (parts as string).trim();
        }
        if (
          text.length < 8 ||
          text.startsWith("[Request interrupted") ||
          text.startsWith("This session is being continued") ||
          text.startsWith("<") ||
          text.startsWith("#")
        ) continue;
        msgs.push(text.slice(0, 300));
        if (msgs.length >= maxMessages) break;
      } catch { /* skip */ }
    }
  } catch { /* file unreadable */ }
  return msgs;
}

// Async: summarize session in Korean using Claude Haiku, with caching
async function summarizeSessionAsync(
  sessionId: string,
  filePath: string,
  agentId: number,
): Promise<void> {
  if (topicCache[sessionId]) {
    // Already cached — broadcast immediately
    broadcast({ type: "agentTopicLoaded", id: agentId, sessionTopic: topicCache[sessionId] });
    return;
  }

  const client = getAnthropicClient();
  if (!client) return;

  const messages = extractUserMessages(filePath, 5);
  if (messages.length === 0) return;

  const userText = messages.map((m, i) => `[메시지 ${i + 1}] ${m}`).join("\n");

  try {
    const resp = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 60,
      messages: [{
        role: "user",
        content: `아래는 Claude Code 세션의 첫 번째 대화 내용입니다. 이 세션이 어떤 작업을 하는 세션인지 한국어로 한 줄(30자 이내)로 요약해주세요. 작업 내용만 간결하게, 존댓말 없이 명사형으로 끝내세요.\n\n${userText}\n\n요약:`,
      }],
    });
    const summary = (resp.content[0] as { type: string; text: string }).text.trim();
    if (summary) {
      topicCache[sessionId] = summary;
      saveTopicCache();
      broadcast({ type: "agentTopicLoaded", id: agentId, sessionTopic: summary });
      console.log(`[Agent ${agentId}] 요약: ${summary}`);
    }
  } catch (err) {
    console.warn(`[Server] Failed to summarize session ${sessionId.slice(0, 8)}: ${err instanceof Error ? err.message : err}`);
  }
}

// Express app
const app = express();
// Serve production build
app.use(express.static(join(__dirname, "public")));

const server = createServer(app);

// WebSocket
const wss = new WebSocketServer({ server });

// Ping/pong heartbeat — keeps clients Set accurate for shutdown guard
const HEARTBEAT_INTERVAL_MS = 30_000;
setInterval(() => {
  for (const ws of clients) {
    if ((ws as unknown as Record<string, boolean>).__isAlive === false) {
      clients.delete(ws);
      ws.terminate();
      continue;
    }
    (ws as unknown as Record<string, boolean>).__isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function sendInitialData(ws: WebSocket): void {
  // Send settings
  ws.send(JSON.stringify({ type: "settingsLoaded", soundEnabled: false }));

  // Send character sprites
  if (characterSprites) {
    ws.send(JSON.stringify({ type: "characterSpritesLoaded", characters: characterSprites.characters }));
  }

  // Send wall tiles
  if (wallTiles) {
    ws.send(JSON.stringify({ type: "wallTilesLoaded", sprites: wallTiles.sprites }));
  }

  // Send floor tiles (optional)
  if (floorTiles) {
    ws.send(JSON.stringify({ type: "floorTilesLoaded", sprites: floorTiles.sprites }));
  }

  // Send furniture assets (optional)
  if (furnitureAssets) {
    ws.send(
      JSON.stringify({
        type: "furnitureAssetsLoaded",
        catalog: furnitureAssets.catalog,
        sprites: furnitureAssets.sprites,
      }),
    );
  }

  // Send existing agents with persisted seat metadata
  const agentList = Array.from(agents.values());
  const agentIds = agentList.map((a) => a.id);
  const folderNames: Record<number, string> = {};
  const agentMeta: Record<number, { palette?: number; hueShift?: number; seatId?: string }> = {};
  for (const a of agentList) {
    folderNames[a.id] = a.projectName;
    if (persistedSeats?.[a.id]) {
      const s = persistedSeats[a.id];
      agentMeta[a.id] = { palette: s.palette, hueShift: s.hueShift, seatId: s.seatId ?? undefined };
    }
  }
  ws.send(JSON.stringify({ type: "existingAgents", agents: agentIds, folderNames, agentMeta }));

  // Send cached session topics for existing agents
  for (const a of agentList) {
    const topic = topicCache[a.sessionId];
    if (topic) {
      ws.send(JSON.stringify({ type: "agentTopicLoaded", id: a.id, sessionTopic: topic }));
    }
  }

  // Send layout (must come after existingAgents — the hook buffers agents until layout arrives)
  if (currentLayout) {
    ws.send(JSON.stringify({ type: "layoutLoaded", layout: currentLayout, version: 1 }));
  } else {
    // Send null layout to trigger default layout creation in the UI
    ws.send(JSON.stringify({ type: "layoutLoaded", layout: null, version: 0 }));
  }
}

wss.on("connection", (ws) => {
  (ws as unknown as Record<string, boolean>).__isAlive = true;
  ws.on("pong", () => { (ws as unknown as Record<string, boolean>).__isAlive = true; });
  clients.add(ws);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "webviewReady" || msg.type === "ready") {
        sendInitialData(ws);
      } else if (msg.type === "saveLayout") {
        try {
          mkdirSync(persistDir, { recursive: true });
          writeFileSync(persistedLayoutPath, JSON.stringify(msg.layout, null, 2));
          currentLayout = msg.layout as Record<string, unknown>;
          // Broadcast to other clients for multi-tab sync
          const data = JSON.stringify({ type: "layoutLoaded", layout: msg.layout, version: 1 });
          for (const client of clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(data);
            }
          }
        } catch (err) {
          console.error(`[Server] Failed to save layout: ${err instanceof Error ? err.message : err}`);
        }
      } else if (msg.type === "closeAgent") {
        const targetId = msg.id as number;
        // Find and remove the agent by numeric id
        for (const [sessionId, agent] of agents) {
          if (agent.id === targetId) {
            closedSessionIds.add(sessionId);
            agents.delete(sessionId);
            broadcast({ type: "agentClosed", id: targetId });
            console.log(`Agent ${targetId} closed by user`);
            break;
          }
        }
      } else if (msg.type === "saveAgentSeats") {
        try {
          mkdirSync(persistDir, { recursive: true });
          writeFileSync(persistedSeatsPath, JSON.stringify(msg.seats, null, 2));
        } catch (err) {
          console.error(`[Server] Failed to save agent seats: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch {
      /* ignore invalid messages */
    }
  });

  ws.on("close", () => clients.delete(ws));
});

// Watcher
const watcher = new JsonlWatcher();

watcher.on("fileAdded", (file: WatchedFile) => {
  if (agents.has(file.sessionId)) return;
  if (closedSessionIds.has(file.sessionId)) return; // user manually closed
  lastActivityTime = Date.now();

  const sessionTopic = extractSessionTopic(file.path);

  const agent: TrackedAgent = {
    id: nextAgentId++,
    sessionId: file.sessionId,
    projectDir: dirname(file.path),
    projectName: file.projectName,
    jsonlFile: file.path,
    fileOffset: 0,
    lineBuffer: "",
    activity: "idle",
    activeTools: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastActivityTime: Date.now(),
  };

  agents.set(file.sessionId, agent);
  broadcast({ type: "agentCreated", id: agent.id, folderName: agent.projectName, sessionTopic });
  console.log(`Agent ${agent.id} joined: ${agent.projectName} (${file.sessionId.slice(0, 8)})${sessionTopic ? ` — "${sessionTopic.slice(0, 40)}"` : ""}`);

  // Async summarize in Korean (non-blocking)
  summarizeSessionAsync(file.sessionId, file.path, agent.id).catch(() => {});
});

watcher.on("fileRemoved", (file: WatchedFile) => {
  const agent = agents.get(file.sessionId);
  if (!agent) return;

  agents.delete(file.sessionId);
  broadcast({ type: "agentClosed", id: agent.id });
  console.log(`Agent ${agent.id} left: ${agent.projectName}`);
});

watcher.on("line", (file: WatchedFile, line: string) => {
  const agent = agents.get(file.sessionId);
  if (!agent) return;
  lastActivityTime = Date.now();

  processTranscriptLine(line, agent, broadcast);
});

// Start
watcher.start();
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Pixel Agents server running at http://localhost:${PORT}`);
  console.log(`Watching ~/.claude/projects/ for active sessions...`);
});

// Idle shutdown
setInterval(() => {
  if (agents.size === 0 && clients.size === 0 && Date.now() - lastActivityTime > IDLE_SHUTDOWN_MS) {
    console.log("No active sessions or clients for 10 minutes, shutting down...");
    watcher.stop();
    server.close();
    process.exit(0);
  }
}, 30_000);

// Graceful shutdown
process.on("SIGINT", () => {
  watcher.stop();
  server.close();
  process.exit(0);
});
