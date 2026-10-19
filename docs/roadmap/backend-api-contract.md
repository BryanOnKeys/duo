# Backend API 계약(로컬 UI 서버, T87)

대상: `duoctl ui`가 띄우는 로컬 HTTP 서버(`packages/integration/src/http/server.ts`)와 FE(`packages/ui`). 표시 규칙:

- **IMPLEMENTED:** 공개 0.3.3에 있음
- **PROPOSED:** 설계안이며 구현되지 않음. 대부분 [decision-rbac-design.md](decision-rbac-design.md)의 Human Decision을 기다린다

존재하지 않는 인증 서버나 엔드포인트를 구현된 것처럼 적지 않는다. OpenAPI 파일은 만들지 않았다. 서버가 하나의 프로세스 안에서 세션 쿠키와 CSRF로 동작하는 로컬 도구라, 별도 명세 파일이 실제 계약보다 앞서 나갈 위험이 더 크다. FE가 쓸 타입은 §7에 TypeScript로 둔다.

## 1. 공통 규칙(IMPLEMENTED)

| 항목 | 규칙 |
|---|---|
| 주소 | `127.0.0.1`의 임의 포트. Host 헤더는 `127.0.0.1:<port>` 또는 `localhost:<port>`만 |
| 세션 | launch URL의 `?session=`이 HttpOnly·SameSite=Strict 쿠키(`duo_ui_<port>`)가 됨. 모든 `/api/*`에 필요 |
| 변경 요청 | POST만. 같은 origin의 `Origin`, `Content-Type: application/json`, `X-DUO-CSRF`(`GET /api/session`에서 받은 값) 필수. 본문 최대 64 KiB |
| 성공 envelope | `{ "format": "duo.ui.<name>/1", "ok": true, "data": ..., "meta": { "durationMs" } }` |
| 도메인 결과 | HTTP 200. 실패도 `data.status: "failed"`와 `diagnostics[{code,message}]`. 초기화 전이면 `data.status: "not-initialized"` |
| 전송·보안 오류 | 4xx/5xx와 `{ "format": "duo.ui.error/1", "ok": false, "error": { code, message } }` |
| 버전 | `UI_API_VERSION = "1"`. 필드 추가는 같은 `/1` 안에서 additive로만 한다. 이름이나 의미를 바꾸면 `/2` |
| 권한 | 세션을 가진 같은 컴퓨터의 사용자. Decision actor는 `ui:<Git user.name>`이며 인증이 아님(docs/10-security.md) |

## 2. 현재 API 인벤토리(IMPLEMENTED)

| Method | Path | Request | Response(data) | 오류 | 권한 | Side effect | 멱등성 | 동시성 |
|---|---|---|---|---|---|---|---|---|
| GET | `/api/session` | 없음 | `{ csrf, version, apiVersion, root }` | 세션 오류 | 세션 | 없음 | 예 | 없음 |
| GET | `/api/overview` | 없음 | 프로젝트 개요 | 도메인 실패 | 세션 | 없음 | 예 | 읽기 전용 그래프 |
| GET | `/api/direction` | 없음 | Requirement·Decision·Constraint·Milestone·proposal 목록(권한 상태 포함) | 같음 | 세션 | 없음 | 예 | 없음 |
| GET | `/api/proposals` | 없음 | `{ proposals[], previews: { [P-id]: ConfirmPreview \| {error[]} } }`(pending만 preview) | 같음 | 세션 | 없음 | 예 | 없음 |
| POST | `/api/proposals/{P-id}/confirm` | `{ confirmId, previewDigest }`(둘 다 필수) | `{ status: "confirmed", result: { decisionId, path, from, supersedes?, stale?, indexRequired: true, repaired[] }, warnings[] }` 또는 `{ status: "failed", diagnostics[] }` | 400 `UI_CONFIRM_ID_MISMATCH`, `UI_REQUEST_INVALID`. 도메인: `DECISION_CONFIRM_PREVIEW_CHANGED`, `PROPOSAL_NOT_PENDING`, `DECISION_LOCK_BUSY` 등 | 세션 + CSRF. actor `ui:<user.name>`(human 고정) | `D-###.yaml` 생성, 대체 대상 표시, proposal 삭제, metrics 한 줄 | 아니오. 두 번째 호출은 `PROPOSAL_NOT_PENDING(... confirmed as D-###)` | decisions.lock(5000 ms). 본 digest와 다르면 아무것도 쓰지 않음 |
| POST | `/api/proposals/{P-id}/reject` | `{ reason? }`(최대 2000자) | `{ status: "rejected", result }` 또는 failed | `PROPOSAL_NOT_PENDING`, `DECISION_LOCK_BUSY` | 위와 같음 | proposal 파일에 rejected 기록 | 아니오. 두 번째는 `PROPOSAL_NOT_PENDING` | 같은 lock |
| GET | `/api/reviews`, `/api/reviews/{review-id}` | 없음 | 기록된 Review 목록·한 건 | 같음 | 세션 | 없음 | 예 | 없음 |
| GET | `/api/entity/{id}` | 없음 | Truth 정의(원문 slice) 또는 그래프 노드와 직접 관계 | 같음 | 세션 | 없음 | 예 | 없음 |
| GET | `/api/graph` | `node`, `kind=trace\|impact`, `depth 1~3` | 그래프 조회 | `UI_REQUEST_INVALID` | 세션 | 없음 | 예 | 없음 |
| GET | `/api/search` | `q`, `limit 1~50` | 근거 검색 | 같음 | 세션 | 없음 | 예 | 없음 |
| GET | `/api/source` | `path`, `start`, `end`(최대 120줄) | 인덱스된 파일의 줄 | 403 `UI_SOURCE_FORBIDDEN`(비밀 파일), 404 `UI_SOURCE_NOT_INDEXED` | 세션 | 없음 | 예 | 없음 |
| POST | `/api/context` | `{ task, budget? }` | Context 결과 | 도메인 실패(`index-required` 등) | 세션 + CSRF | metrics 한 줄 | 예(결과 동일) | 읽기 |
| POST | `/api/review` | `{ task?, from?, to?, includeSemanticAssist? }` | Review 결과 | 같음 | 세션 + CSRF | metrics 한 줄 | 예 | 읽기 |

없는 것: Decision 목록·상세 전용 엔드포인트(`direction`·`entity`가 대신함), 단건 preview, 감사 이력, 현재 사용자·권한, proposal 생성·취소, D-### 제자리 confirm(CLI에만 있음).

## 3. Confirm 계약에서 반드시 지킬 것

- confirm은 `previewDigest`가 lock 안에서 다시 읽은 candidate의 digest와 같을 때만 쓴다(`DECISION_CONFIRM_PREVIEW_CHANGED`). 새 API도 이 바인딩을 우회하는 경로를 만들지 않는다.
- digest에는 proposal의 제안자 표시값, stale 여부, 대체 대상의 현재 내용이 들어간다. 대상이 바뀌면 다시 preview해야 한다.
- 결과의 `decisionId`가 권위 있는 값이다. preview의 `expectedDecisionId`는 예상일 뿐이다.
- 확정 직후 그래프는 낡는다(`indexRequired: true`). FE는 "index 필요"를 보여 준다.

## 4. 제안 API(PROPOSED)

| ID | Method·Path | Request | Response(data) | 오류 | 권한 | Side effect | 멱등성·동시성 | 의존 |
|---|---|---|---|---|---|---|---|---|
| API-01 | GET `/api/me` → `duo.ui.me/1` | 없음 | `{ mode: "local"\|"team", actor: { kind: "human", label, source: "git-user-name", authenticated: false }, git: { name, email? }, roles[], capabilities: { confirm, reject, withdraw }, agentEnvironment: { detected, markers[] } }`. 각 capability는 `{ allowed, reason?, enforcement: "local-ux" \| "merge-review" }` | 세션 오류 | 세션 | 없음 | 예 | Local 부분은 BE-GOV-06, Team 부분은 H-88 |
| API-02 | GET `/api/decisions` → `duo.ui.decisions/1` | `state?`, `q?` | `{ decisions: [{ id, title, state, authority: "CONFIRMED"\|"SUPERSEDED"\|..., locked, lockStatus, supersedes, supersededBy, proposalId?, confirmedAt?, confirmedBy?, origin: "lifecycle"\|"manual" }] }` | 도메인 실패 | 세션 | 없음 | 예 | 없음(현재 데이터로 가능) |
| API-03 | GET `/api/decisions/{D-id}` | 없음 | API-02 항목 + `lock: LockVerification`, `chain: [{id, state}]`(대체 사슬), `location` | 404 대신 `data.status: "not-found"` | 세션 | 없음 | 예 | 없음 |
| API-04 | GET `/api/decisions/{D-id}/history` → `duo.ui.decision-history/1` | 없음 | `{ events: DecisionEvent[], derived: boolean, integrity: { chain: "valid"\|"broken"\|"absent" } }`. 이벤트가 없으면 파일에서 추론한 항목을 `derived: true`로 | 같음 | 세션 | 없음 | 예 | BE-AUD-01·05(H-88) |
| API-05 | GET `/api/proposals/{P-id}/preview` → `duo.ui.preview/1` | 없음 | `ConfirmPreview` | `PROPOSAL_NOT_FOUND`, `PROPOSAL_NOT_PENDING` | 세션 | 없음 | 예 | 없음 |
| API-06 | POST `/api/proposals/{P-id}/confirm`에 `reason?` 추가 | `{ confirmId, previewDigest, reason? }`(최대 2000자) | 지금과 같음 + `eventId?` | 지금과 같음 + Team Mode `DECISION_ROLE_FORBIDDEN`, `DECISION_AGENT_ENVIRONMENT` | 세션 + CSRF + (Team) 승인자 | 이벤트 1건 추가 | digest 바인딩 유지. 같은 요청 재시도는 `PROPOSAL_NOT_PENDING`이고 이벤트를 더 만들지 않음 | BE-AUD-02, H-88 |
| API-07 | POST `/api/proposals/{P-id}/withdraw` | `{ reason? }` | `{ status: "withdrawn", result }` | `PROPOSAL_NOT_PENDING`, `PROPOSAL_WITHDRAW_FORBIDDEN` | 세션 + CSRF, 제안자 또는 ADMIN(로컬 UX) | proposal 파일에 withdrawn 기록(스키마 확장 필요) + 이벤트 | 두 번째는 `PROPOSAL_NOT_PENDING` | 스키마 변경이라 H-88 |
| API-08 | POST `/api/proposals`(사람의 proposal 생성) | `ProposalInput` | `duo.proposal/1` | `PROPOSAL_INVALID` | 세션 + CSRF, actor human | proposal 생성 | 멱등 아님(호출마다 새 P) | ADR-009(UI 쓰기는 confirm·reject뿐) 변경이 필요해 1단계 범위에서 제외 권장 |

Supersede 전용 엔드포인트는 만들지 않는다. `supersedes`가 있는 proposal의 confirm이 곧 supersede이고, preview의 `supersedes` 항목이 대상을 보여 준다.

## 5. 오류 코드

IMPLEMENTED(전송·보안, HTTP 상태와 함께):

| code | HTTP | 뜻 |
|---|---|---|
| `UI_HOST_REJECTED` | 403 | Host가 이 서버가 아님(DNS rebinding 방지) |
| `UI_SESSION_REQUIRED` / `UI_SESSION_REJECTED` | 401 / 403 | 세션 쿠키 없음 / launch URL의 세션이 틀림 |
| `UI_ORIGIN_REJECTED`, `UI_CSRF_REJECTED` | 403 | 다른 origin, CSRF 토큰 없음·틀림 |
| `UI_CONTENT_TYPE` | 415 | JSON이 아님 |
| `UI_METHOD_NOT_ALLOWED` | 405 | 메서드 불일치 |
| `UI_REQUEST_INVALID`, `UI_REQUEST_TOO_LARGE` | 400, 413 | 입력 검증 실패, 64 KiB 초과 |
| `UI_CONFIRM_ID_MISMATCH` | 400 | 확정할 ID를 다시 입력하지 않음(실수 방지) |
| `UI_NOT_FOUND`, `UI_SOURCE_*` | 404, 403 | 경로 없음, 원문 열람 제한 |
| `UI_INTERNAL_ERROR` | 500 | 서버 내부 오류(콘솔에만 상세) |

IMPLEMENTED(도메인, HTTP 200 + `data.status: "failed"`): `DECISION_CONFIRM_PREVIEW_CHANGED`, `DECISION_LOCK_BUSY`, `DECISION_LOCKED`, `DECISION_ACTOR_FORBIDDEN`, `PROPOSAL_NOT_FOUND`, `PROPOSAL_NOT_PENDING`, `PROPOSAL_INVALID`, `DECISION_SUPERSEDE_TARGET_INVALID`, `DECISION_TARGET_UNSUPPORTED`, `BROKEN_REFERENCE`, `INVALID_ID`, Truth 권한 오류(`DECISION_INTEGRITY_INVALID` 등, `requireCompleteTruth`).

PROPOSED(도메인, 같은 방식): `DECISION_ROLE_FORBIDDEN`(Team Mode, 범위 밖 승인자), `DECISION_AGENT_ENVIRONMENT`(agent 실행 환경 감지, 실수 방지), `DECISION_TEAM_LOCK_REQUIRED`(Team Mode, lock 없는 Decision), `DECISION_EVENT_MISSING`(Team Mode, 확정 이벤트 없음), `PROPOSAL_WITHDRAW_FORBIDDEN`.

권한 부족을 HTTP 403으로 바꾸지 않는다. 기존 FE와 CLI·MCP가 같은 진단 코드를 공유하고, 도메인 판단은 200 + failed라는 현재 계약을 유지한다.

## 6. 동시성·복구 시나리오

| 상황 | 현재 동작(IMPLEMENTED) | 새 API에서 지킬 것 |
|---|---|---|
| 두 사람이 같은 proposal을 동시에 확정 | decisions.lock으로 직렬화. 먼저 끝난 쪽이 D-###를 만들고, 나중 쪽은 lock 안에서 다시 읽어 `PROPOSAL_NOT_PENDING(... confirmed as D-###)` | 이벤트는 성공한 쪽만 1건. 실패 쪽은 실패 이벤트(선택)로 남김 |
| 같은 요청 재전송(네트워크 재시도) | 위와 같음 | 중복 이벤트 없음(요청 ID 또는 proposal 상태로 판단) |
| 두 proposal이 같은 Decision을 supersede | 첫 확정 뒤 대상이 superseded가 되어 두 번째는 `DECISION_SUPERSEDE_TARGET_INVALID`. 세션 계획은 미리 거부(`DECISION_SESSION_CONFLICT`) | 같음 |
| 오래된 proposal(Truth가 바뀜) | `PROPOSAL_STALE` warning과 `stale` 정보. digest가 바뀌므로 다시 preview 필요 | Team Mode에서 stale 확정을 막을지는 H-88 이후 결정 |
| preview 뒤 내용 변경 | `DECISION_CONFIRM_PREVIEW_CHANGED`, 쓰기 없음 | 유지 |
| lock을 오래 잡은 다른 프로세스 | 5000 ms 뒤 `DECISION_LOCK_BUSY`. 같은 host의 죽은 pid lock은 깨뜨림 | 유지. 다른 host(공유 드라이브)의 lock은 깨뜨리지 않음 |
| commit 지점 뒤 실패(대체 표시·proposal 삭제) | 성공 + warning, 다음 쓰기 조작이 repair | repair도 이벤트로 기록(BE-DATA-02) |
| 권한이 없는 사용자 | Local: kind만 검사. Team: PROPOSED `DECISION_ROLE_FORBIDDEN` | 실수 방지라고 명시하고, 강제는 병합 리뷰 |

## 7. FE용 타입(PROPOSED, mock 작업용)

```ts
export type Enforcement = "local-ux" | "merge-review";
export interface Capability { readonly allowed: boolean; readonly reason?: string; readonly enforcement: Enforcement }
export interface MeData {
  readonly mode: "local" | "team";
  readonly actor: { readonly kind: "human"; readonly label: string; readonly source: "git-user-name"; readonly authenticated: false };
  readonly git: { readonly name: string | null; readonly email?: string | null };
  readonly roles: readonly ("ADMIN" | "APPROVER" | "DEVELOPER" | "AI_AGENT" | "READ_ONLY")[];
  readonly capabilities: { readonly confirm: Capability; readonly reject: Capability; readonly withdraw: Capability };
  readonly agentEnvironment: { readonly detected: boolean; readonly markers: readonly string[] };
}
export interface DecisionEvent {
  readonly format: "duo.decision-event/1";
  readonly eventId: string;
  readonly at: string;
  readonly op: "propose" | "confirm" | "reject" | "withdraw" | "supersede-mark" | "repair" | "confirm-failed";
  readonly decisionId?: string;
  readonly proposalId?: string;
  readonly actor: { readonly kind: "human" | "agent" | "system"; readonly label: string; readonly surface: "cli" | "ui" | "mcp" | "session" | "repair" };
  readonly git?: { readonly name: string | null; readonly email: string | null };
  readonly reviewedDigest?: string;
  readonly lockDigest?: string;
  readonly reason?: string;
  readonly supersedes?: string;
  readonly diagnostics?: readonly string[];
  readonly prev?: string;
}
export interface DecisionHistoryData {
  readonly id: string;
  readonly events: readonly DecisionEvent[];
  readonly derived: boolean;
  readonly integrity: { readonly chain: "valid" | "broken" | "absent" };
}
```

FE는 이 타입으로 mock을 만들어 화면(Jira S15P31A106-311·312·315·316)을 먼저 개발할 수 있다. 백엔드가 API-01·04를 구현하면 mock을 실제 호출로 바꾼다.

## 8. 표면별 대응

| 조작 | CLI | UI API | MCP |
|---|---|---|---|
| 목록·대기 | `decision list` | `GET /api/proposals`, `/api/direction` | `duo_get_status`, `duo_get_decision` |
| 제안 | 없음 | 없음(API-08 PROPOSED, 1단계 제외) | `duo_propose_decision`(agent) |
| preview | confirm·reject 안에서 표시 | `/api/proposals`의 `previews`(API-05 PROPOSED) | 없음 |
| 확정 | `decision confirm`(TTY), `review-pending` | `POST .../confirm` | **없음(유지)** |
| 거절 | `decision reject --reason` | `POST .../reject` | **없음(유지)** |
| 이력 | PROPOSED `decision history` | API-04 PROPOSED | `duo_get_decision`에 이력 요약 추가는 AI-2와 협의(스키마 additive) |
| 검증 | PROPOSED `decision verify [--ci]` | 없음 | 없음 |

