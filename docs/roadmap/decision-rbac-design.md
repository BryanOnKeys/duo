# Decision 승인 권한(RBAC)과 신뢰 경계 설계(#25, T87)

상태: **제안(Maintainer 승인 전)**. 이 문서는 [Issue #25](https://github.com/kanghyunsoon/duo/issues/25)의 설계 산출물이다. 제품 규칙은 바뀌지 않았고, 승인되면 [ADR-015](../adr/ADR-015-decision-authority-team-mode.md)(proposed)와 Human Decision으로 확정한다. 현재 구조는 [backend-architecture-current.md](backend-architecture-current.md), 감사 Gap은 [decision-audit-gap.md](decision-audit-gap.md)에 있다.

## 1. 권장안 요약

**C(GitHub CODEOWNERS + ruleset의 필수 리뷰)를 팀의 실제 신뢰 경계로 쓰고, 로컬 DUO는 실수 방지와 감사 기록을 맡는다.** 구체적으로는 다음 네 가지를 묶는다.

1. **Local Mode(기본값)는 지금 동작을 유지한다.** human만 확정하는 규칙, TTY와 ID 재입력, preview digest 바인딩을 그대로 둔다. 문구도 "인증이 아니다"를 유지한다.
2. **Team Mode(선택)를 `.duo-project/governance.yaml`로 켠다.** 역할과 Decision 범위별 승인자를 적는다. 로컬 승인자 검사는 실수 방지용 경고·거부이며 보안 통제라고 부르지 않는다.
3. **Team Mode에서 Decision의 팀 권한은 보호 branch에 병합될 때 생긴다.**
   - `.duo-project/decisions/**`와 `governance.yaml`은 CODEOWNERS 승인자의 리뷰 없이는 병합되지 않게 한다.
   - CI 검증(`duoctl decision verify --ci`)이 lock, 확정 이벤트, 승인자 매핑을 확인한다.
   - lock이 없거나 이벤트가 없는 Decision 파일은 Team Mode에서 오류(fail-closed)다.
4. **감사 이벤트(BE-AUD)를 추가한다.** 실패와 복구를 포함해 승인 이력을 Git이 추적하는 이벤트 파일로 남긴다. 이벤트는 "주장"이고, 신뢰는 그 이벤트가 리뷰를 거쳐 병합됐다는 사실에서 나온다.

서명 승인(D)은 GitHub를 쓰지 않거나 오프라인 증명이 필요한 팀을 위한 후속 확장으로 미룬다.

**이유:** 같은 OS 사용자로 도는 에이전트는 로컬 파일, PTY, 로컬 HTTP를 모두 쓸 수 있다(T87 재현). 그래서 로컬에서 할 수 있는 것은 실수 방지와 변조 감지뿐이다. 에이전트의 OS 권한 밖에서 사람을 인증하는 곳은 Git 호스팅 서버다. DUO 저장소도 이미 GitHub ruleset을 쓴다.

## 2. 위협 모델

| 행위자 | 가진 능력 | 예 |
|---|---|---|
| Maintainer | 저장소 쓰기, GitHub 관리자 | BE-1 |
| Developer | 저장소 쓰기(collaborator) | FE-1, AI-1~4 |
| AI agent(MCP만) | MCP 9개 tool | 샌드박스가 셸을 막은 agent |
| AI agent(셸 포함) | 같은 OS 사용자의 파일 쓰기, PTY, 로컬 HTTP, 사용자의 `gh` 인증을 그대로 쓸 수 있음 | Codex·Claude Code의 셸 도구 |
| 사칭하는 팀원 | 자기 컴퓨터에서 Git `user.name`·파일을 마음대로 설정 | |
| 저장소 권한이 없는 외부인 | 없음(로컬 UI는 127.0.0.1, 세션·CSRF로 다른 웹 페이지 차단) | |

| 위협 | 설명 | 지금(0.3.3) |
|---|---|---|
| W1 정직한 실수 | 잘못된 사람이 확정, agent가 의도치 않게 확정 시도 | MCP에는 확정 도구가 없고 서비스가 agent kind를 거부. CLI는 TTY와 ID 재입력 |
| W2 agent가 사람용 표면을 조작 | PTY로 CLI 확정, 셸에서 `duoctl ui`를 띄워 API 호출 | **막지 못함**(T87 재현 S2, S4) |
| W3 팀원 사칭 | `git config user.name`을 바꿔 확정 | **막지 못함**(S7b, `confirmed_by: ui:Mallory`) |
| W4 파일 직접 작성 | lock 없는 `D-###.yaml` 작성, lock digest 재계산 | **막지 못함**(S7c). lock은 실수 감지용 |
| W5 이력 조작 | rebase, force push로 Decision commit 지우기 | DUO 범위 밖. GitHub ruleset(force push 금지)이 막음 |
| W6 본 것과 다른 내용 확정 | preview 뒤 proposal 변경 | **막음**(`DECISION_CONFIRM_PREVIEW_CHANGED`, S2) |

**핵심 한계:** 공격자(agent 포함)가 같은 파일 시스템 권한을 가지면 로컬 DUO는 완전한 RBAC를 강제할 수 없다. 로컬에서 "관리자 플래그"나 역할 설정을 확인하는 기능은 실수 방지(UX)로만 설명한다.

## 3. 현재 권한(0.3.3)

| 조작 | human | agent | system | 실제 강제 위치 | 우회 |
|---|---|---|---|---|---|
| propose | O | O | O | `DECISION_PERMISSIONS.propose` | 해당 없음 |
| confirm | O | X | X | 서비스 kind 검사 + `guardDecisionWrite`(Decision 파일은 human만) | kind는 호출자가 정함. CLI·UI는 human 고정이라 조작하면 통과(W2) |
| reject | O | X | X | 서비스 kind 검사 | 같음 |
| supersede | confirm과 같음 | | | | 같음 |
| Decision 파일 직접 편집 | 허용(ADR-013 fallback) | 막는 장치 없음 | | OS 권한 | W4 |

## 4. 역할과 권한 매트릭스(제안)

역할 정의:

- **ADMIN(Maintainer):** 모든 Decision 확정과 거버넌스 변경
- **APPROVER:** `governance.yaml`에서 특정 Decision 범위의 승인자로 지정된 DEVELOPER
- **DEVELOPER:** 제안만 가능
- **AI_AGENT:** 제안만 가능
- **READ_ONLY:** 조회만 가능

"강제 위치"의 **로컬**은 같은 OS 사용자가 우회할 수 있는 실수 방지다. **GitHub**는 병합 시 인증된 리뷰다.

| 조작 | ADMIN | APPROVER | DEVELOPER | AI_AGENT | READ_ONLY | 강제 위치(Team Mode) |
|---|---|---|---|---|---|---|
| Project Truth 조회 | O | O | O | O | O | 없음(공개 파일) |
| Decision 조회 | O | O | O | O | O | 없음 |
| Proposal 생성 | O | O | O | O | X | 로컬(READ_ONLY는 저장소 쓰기 권한이 없음) |
| Proposal 취소(withdraw, 신규 조작) | O(모두) | 자기 것 | 자기 것 | 자기 label 것 | X | 로컬. 0.3.3에는 취소 조작이 없다 |
| Confirm | O | 자기 범위 | X | **X** | X | 로컬 경고·거부 + **GitHub code owner 리뷰** |
| Reject | O | 자기 범위 | X | **X** | X | 같음 |
| Supersede | O | 대상과 새 Decision 모두 자기 범위 | X | **X** | X | 같음 |
| Audit 조회 | O | O | O | O | O | 없음 |
| 권한 설정 변경(`governance.yaml`) | O | X | X | X | X | **GitHub CODEOWNERS(maintainer)** |
| 보안 정책 변경(ruleset, CODEOWNERS, release 정책) | O | X | X | X | X | **GitHub 관리자 권한** |

AI_AGENT가 Confirm·Reject·Supersede를 끝내지 못하게 하는 장치는 두 겹이다.

1. **로컬(실수 방지):** MCP에는 확정 도구가 없고, 서비스는 agent kind를 거부한다. 신규로 agent 실행 환경 감지 거부(BE-GOV-06)를 둔다.
2. **팀(강제):** agent가 셸로 사람용 표면을 조작해 Decision 파일을 만들더라도, 보호 branch에 들어가려면 code owner인 사람의 GitHub 리뷰가 필요하다.

## 5. 옵션 비교

A: 현재 actor label 정책 유지. B: Decision별 owner·approver 목록과 Git identity 확인. C: GitHub CODEOWNERS·ruleset·필수 리뷰를 신뢰 경계로 사용. D: 서명된 승인 이벤트(SSH/GPG) 또는 별도 승인 서비스.

| 기준 | A label | B approver + Git identity | C CODEOWNERS + ruleset | D 서명 승인 |
|---|---|---|---|---|
| 실제 강제 범위 | 없음(기록만) | 정직한 실수(범위 밖 승인자) | 보호 branch 병합 시 인증된 사람의 리뷰 | 서명 키 보유자만 승인 이벤트 생성 |
| agent가 OS 파일에 직접 쓸 때 | 우회 | 우회 | 로컬은 우회, 병합에서 막힘 | 키가 잠겨 있거나 하드웨어 키 터치가 필요하면 막힘. ssh-agent에 풀린 키가 있으면 우회 |
| 다른 개발자의 사람 사칭 | 가능 | 가능(`user.name`·`user.email`은 자유) | 병합 단계에서 불가(GitHub 계정 인증) | 불가(상대 개인 키 필요) |
| 오프라인 사용 | O | O | 로컬 작업은 O, 팀 권한은 push·병합 때 | O(검증도 로컬) |
| 기존 CLI 호환 | 그대로 | 추가 경고·거부만 | 그대로(CI 명령 추가) | confirm마다 서명 단계 추가 |
| MCP·UI 호환 | 그대로 | UI에 승인 가능 여부 표시 | 그대로 | UI가 서명을 대신 못 함(CLI로 넘겨야 함) |
| 초기 설치 복잡도 | 없음 | `governance.yaml` 작성 | CODEOWNERS·ruleset(관리자 1회) + CI step | 사람마다 키, allowed_signers 관리, OS별 `ssh-keygen -Y` 지원 확인 |
| 사용자 승인 횟수 | 확정 1회 | 확정 1회 | 확정 1회 + PR 리뷰 1회(여러 Decision 묶음 가능) | 확정 1회 + 서명(패스프레이즈·터치) |
| GitHub 의존 | 없음 | 없음 | 있음(GitLab은 CODEOWNERS·approval rule로 대응 가능, 미검증) | 없음 |
| 구현 비용 | 0 | 중간(스키마, 검사, UI 표시) | 작음~중간(CI 검증, 문서. 강제는 GitHub가 함) | 큼(이벤트 형식, 서명·검증, 키 관리 UX) |
| 데이터 마이그레이션 | 없음 | `governance.yaml` 신규(선택) | 없음 | 기존 Decision은 서명 없음(legacy 표시) |
| 운영 위험 | 보안이 있다고 오해 | B를 보안으로 오해 | 로컬 branch의 미병합 Decision은 병합 전까지 그 branch에서 권한을 가짐. agent가 maintainer의 `gh` 토큰으로 GitHub를 조작할 수 있으면 우회 | 키 분실·유출, 키 회전 |

각 옵션이 **막지 못하는 것**:

- **A:** W2, W3, W4 전부. 감사 기록의 승인자 이름을 믿을 수 없다.
- **B:**
  - W3: 팀원이 `user.email`을 승인자의 것으로 바꾸면 통과한다.
  - W2, W4: 같은 OS 사용자의 agent는 둘 다 할 수 있다.
  - B는 "범위 밖 사람이 실수로 확정"만 줄인다.
- **C:**
  - 병합 전 로컬 branch: 위조된 Decision이 그 branch의 review·context에서는 권한으로 쓰인다.
  - 관리자 bypass: ruleset bypass를 가진 사람이 리뷰 없이 병합할 수 있다.
  - 사용자의 `gh` 토큰을 쓰는 agent:
    - 토큰이 PR 승인·병합 권한을 가지면 사람처럼 행동할 수 있다.
    - 이 작업 환경도 셸 agent가 maintainer 계정의 `gh` 인증을 쓴다. 리뷰 규칙("작성자 아닌 승인자")과 bypass 금지가 함께 있어야 한다.
  - GitHub 밖으로 복사된 저장소: 보호가 없다.
- **D:**
  - 같은 사용자 세션에서 풀려 있는 서명 키: agent가 서명할 수 있다.
  - allowed_signers 파일: 그 파일 자체를 C나 다른 방법으로 보호해야 한다.
  - 승인 내용과 무관한 정책 판단: 서명은 "누가"를 증명할 뿐 "그 사람이 그 범위의 승인자인가"는 따로 검사해야 한다.

## 6. 운영 모델(제안, 승인 전)

| | Local Mode(기본) | Team Mode(선택) |
|---|---|---|
| 켜는 방법 | 아무것도 하지 않음 | `.duo-project/governance.yaml`(형식 `duo.governance/1`, 사람이 작성, CODEOWNERS로 보호) |
| 확정 규칙 | 지금과 같음(human kind) | 지금 규칙 + 로컬 승인자 검사(Git email이 해당 범위 승인자가 아니면 거부, 실수 방지) |
| lock 없는 Decision 파일 | ADR-013 수동 fallback으로 인정 | 오류(`DECISION_TEAM_LOCK_REQUIRED`, fail-closed). 기존 파일은 확정 이벤트와 lock을 받는 이전 절차 제공 |
| 감사 이벤트 | 기록(`decisions/events/`) | 기록 + 이벤트 없는 확정 Decision은 오류 |
| 팀 권한의 근거 | 로컬 파일 | 보호 branch 병합(code owner 리뷰) + CI 검증 |
| agent 실행 환경 감지 | 확정 거부(실수 방지, 우회 가능하다고 명시) | 같음 |
| 필요한 외부 설정 | 없음 | CODEOWNERS, ruleset(required review, code owner review, bypass 없음), CI의 `pull-requests: read` |

## 7. 권장안의 근거

1. **신뢰 경계를 실제로 강제할 수 있는 곳에 둔다.**
   - 로컬에서 인증을 흉내 내면(B 단독) 사용자가 보안이 있다고 오해한다(A·B의 운영 위험).
   - C는 이미 인증된 GitHub 계정과 ruleset을 쓰므로 DUO가 인증 서버를 만들 필요가 없다.
2. **Local-first를 지킨다.**
   - Local Mode는 바뀌지 않는다.
   - Team Mode도 로컬 작업과 오프라인 확정을 그대로 허용한다. 팀 권한만 병합 때 생긴다.
3. **공개 /1 형식을 깨지 않는다.**
   - Decision·Proposal 스키마는 1단계에서 바꾸지 않는다.
   - 이벤트와 `governance.yaml`은 새 선택 파일이다.
   - MCP 9개 tool도 그대로다.
4. **감사 Gap의 CRITICAL 두 개를 직접 다룬다.**
   - 승인자 신원: 병합 리뷰로 다룬다.
   - lock 없는 위조 Decision: Team Mode fail-closed로 다룬다.
   - HIGH Gap(사유, 본 digest, 복구 이력)은 이벤트로 다룬다.
5. **D를 막지 않는다.** 이벤트 형식에 서명 필드를 넣을 자리를 두면, 나중에 GitHub 밖의 팀을 위해 서명 검증을 더할 수 있다.

## 8. 호환성

| 대상 | 변화 |
|---|---|
| `D-###.yaml`, `P-###.yaml` 스키마 | 1단계 변화 없음. 대체 시각·승인 사유는 이벤트에 기록 |
| `governance.yaml` | 신규 선택 파일. loader 스키마와 쓰기 경계(project-truth, DUO는 쓰지 않음)에 추가 |
| `decisions/events/` | 신규 tracked 영역(project-truth 안, DecisionService만 append) |
| Decision Lock | 변화 없음(대상 필드 그대로) |
| UI API | additive(`/api/me`, 이력 조회, confirm 사유 선택 필드). [backend-api-contract.md](backend-api-contract.md) |
| MCP | 9개 tool 이름·스키마 그대로. 확정 도구 없음 유지 |
| CLI | 신규 하위 명령(`decision history`, `decision verify`, `decision withdraw`), 신규 진단 코드. 기존 종료 코드 의미 유지 |
| 기존 저장소 | Local Mode 기본이라 아무것도 바뀌지 않음 |

## 9. 구현에 필요한 테스트

- agent actor는 서비스, CLI, UI 서버, MCP, 세션 계획 어느 경로로도 confirm·reject·supersede를 끝내지 못한다(기존 테스트 확장).
- agent 실행 환경으로 감지되면 CLI·UI 확정이 거부되고, 메시지가 "인증이 아니다"를 말한다.
- Team Mode: 승인자가 아닌 Git email의 확정은 거부, 범위 밖 supersede도 거부.
- Team Mode: lock 없는 Decision과 이벤트 없는 확정 Decision은 `requireCompleteTruth` 오류.
- Local Mode: 기존 저장소와 0.3.3 fixture가 그대로 통과(회귀).
- 이벤트: confirm·reject·repair·실패마다 이벤트 1개, 같은 요청 재시도는 중복 이벤트 없음, 해시 체인 깨짐 감지.
- CI 검증: Decision 파일이 바뀐 PR에서 lock·이벤트·승인자 매핑을 검사하고, 위반 시 실패.
- 동시 확정: 같은 proposal 두 번, 같은 대상을 두 proposal이 supersede(#34와 공유).

## 10. Maintainer가 승인해야 할 결정(초안 H-88)

1. 권장안(C를 신뢰 경계로 쓰고, B는 실수 방지, 감사 이벤트 추가, D는 후속) 채택 여부
2. Team Mode를 `governance.yaml`로 여는 선택 기능으로 만들지, 역할 이름(ADMIN·APPROVER·DEVELOPER·AI_AGENT·READ_ONLY)
3. Team Mode에서 lock·이벤트 없는 Decision을 오류로 할지(ADR-013 수동 fallback을 Team Mode에서 제한)
4. 감사 이벤트를 Git이 추적하는 `decisions/events/`에 둘지, 저장할 개인정보 범위(표시 이름, Git email)
5. agent 실행 환경 감지 거부를 실수 방지 기능으로 넣을지
6. DUO 저장소 자체에 CODEOWNERS·code owner review를 적용할지(Jira S15P31A106-246)

## 11. 구현 전에 확인할 사실

- 각 agent가 공식 문서에 남긴 실행 환경 변수(감지 기준). 추측한 변수 이름으로 구현하지 않는다.
- CI에서 PR 리뷰를 읽는 데 필요한 GitHub 권한과 fork PR에서의 동작
- GitLab mirror(SSAFY)에서 같은 보호를 쓸 수 있는지
- Windows·macOS·Linux에서 `ssh-keygen -Y sign/verify` 사용 가능 여부(D를 할 때)

