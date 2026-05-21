# Pixel Agents

Claude Code 에이전트들을 픽셀아트 오피스에서 실시간으로 시각화하는 도구입니다.

각 Claude Code 세션이 오피스 캐릭터가 되어 — 코드 작성, 파일 읽기, 명령어 실행, 권한 대기, 휴식 등을 픽셀 애니메이션으로 표현합니다.

> Based on [pixel-agents](https://github.com/pablodelucca/pixel-agents) by Pablo De Lucca (MIT License).
> The original is a VS Code extension. This fork runs as a **standalone web app** — no VS Code required.

---

## 기능

| 기능 | 설명 |
|------|------|
| 🏢 **방 배치** | 일반 에이전트 → 개인 오피스/메인, 서브에이전트 → Conference Room |
| 🔍 **Hover 툴팁** | 도구 아이콘 + 현재 파일 경로/명령어 전체 표시 |
| 💬 **세션 요약** | Claude Haiku가 세션 내용을 한 줄로 자동 요약 (캐시됨) |
| ☕ **Break Room** | idle 3초 후 자동 이동, 작업 시작 시 자리 복귀 |
| 🏷️ **방 이름 라벨** | Conference / Office 1~4 / Main / Entry / Break |

---

## 설치 방법

### 1. 저장소 클론 & 빌드

```bash
git clone https://github.com/leex5818-sketch/pixel-agents.git
cd pixel-agents
npm install
npm run build
```

### 2. API 키 설정 (세션 요약 기능용)

```bash
cp .env.example .env
```

`.env` 파일을 열어 `ANTHROPIC_API_KEY` 입력:

```
ANTHROPIC_API_KEY=sk-ant-...
```

> API 키 없이도 기본 시각화 기능은 동작합니다.

### 3. 실행

```bash
npm start
```

브라우저에서 **http://localhost:3456** 접속

---

## macOS 로그인 시 자동 시작 (선택)

```bash
bash scripts/install-launchagent.sh
```

컴퓨터를 켜면 백그라운드에서 자동 실행됩니다.

제거하려면:

```bash
bash scripts/uninstall-launchagent.sh
```

---

## IDE에서 자동 시작 (VSCode / Cursor / Windsurf 등)

`.vscode/tasks.json`이 포함되어 있어 프로젝트 폴더를 IDE에서 열면 자동 실행 여부를 묻습니다. **Allow** 선택 시 자동 시작.

---

## 환경변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `ANTHROPIC_API_KEY` | 세션 요약용 Claude Haiku API 키 | (선택) |
| `PORT` | 서버 포트 | `3456` |

---

## 개발 모드

```bash
npm run dev   # 서버 + UI 동시 실행 (hot reload)
```

---

## 아키텍처

- **Server** (`server/`) — Express + WebSocket. JSONL 파일 감시, 에이전트 활동 파싱, UI 서빙
- **Watcher** — chokidar로 `~/.claude/projects/` 세션 파일 감시 (1시간 이내 수정된 파일)
- **Parser** — JSONL 라인에서 도구 사용, 서브에이전트, 권한 요청, idle 상태 감지
- **UI** (`webview-ui/`) — React + Canvas 2D 게임 엔진 (경로탐색, 스프라이트 애니메이션, 오피스 편집기)

---

## Credits

- **[pixel-agents](https://github.com/pablodelucca/pixel-agents)** by Pablo De Lucca — 원본 VS Code 익스텐션 (MIT)
- **[Office Interior Tileset](https://donarg.itch.io/office-interior-tileset-16x16)** by Donarg — 픽셀아트 가구 (별도 구매)

## License

MIT
