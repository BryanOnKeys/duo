---
id: ADR-015
type: decision
title: Team Mode의 Decision 승인 신뢰 경계
state: proposed
question: decision_authority_team_mode
answer: "Local Mode unchanged (label-based human confirm as mistake prevention); opt-in Team Mode via .duo-project/governance.yaml where team authority comes from a code-owner-reviewed merge to a protected branch plus a CI verifier, lockless or eventless Decisions fail closed, and Decision audit events are recorded in Git"
governs:
  requirements: [REQ-DECISION-002, REQ-DECISION-003, REQ-TRUTH-001]
supersedes: null
---

# ADR-015: Team Mode의 Decision 승인 신뢰 경계

상태: **Proposed**(T87 초안, Maintainer 승인 전). 승인 전에는 제품 규칙이 아니다. 근거와 비교는 [decision-rbac-design.md](../roadmap/decision-rbac-design.md), 감사 Gap은 [decision-audit-gap.md](../roadmap/decision-audit-gap.md)에 있다.

## 맥락

[ADR-013](ADR-013-decision-lifecycle.md)은 "AI는 제안하고 사람이 확정한다"를 actor kind로 나눈다. kind와 이름은 호출자가 정하고, CLI·UI는 human으로 고정한다. 같은 OS 사용자로 도는 셸 agent는 PTY로 CLI를, 로컬 HTTP로 UI API를 조작해 확정할 수 있고(T87 재현), lock 없는 Decision 파일을 직접 써서 확정 권한을 만들 수 있다. 로컬 도구만으로는 이를 막을 수 없다.

## 결정(제안)

1. **Local Mode(기본)는 ADR-013 그대로 둔다.** label 기반 human 확정은 실수 방지로 설명한다.
2. **Team Mode는 `.duo-project/governance.yaml`(`duo.governance/1`)로 켠다.** 역할(ADMIN, APPROVER, DEVELOPER, AI_AGENT, READ_ONLY)과 Decision 범위별 승인자를 적는다.
3. **Team Mode에서 팀 권한의 근거는 보호 branch 병합이다.**
   - `.duo-project/decisions/**`와 `governance.yaml`은 code owner 리뷰를 요구한다.
   - CI 검증이 lock, 확정 이벤트, 승인자 매핑을 확인한다.
4. **Team Mode에서 lock이나 확정 이벤트가 없는 Decision은 Truth 오류다.** ADR-013의 수동 fallback을 Team Mode에서는 제한한다.
5. **승인 이력은 Git이 추적하는 `.duo-project/decisions/events/`에 DecisionService가 append한다.**
   - 형식은 `duo.decision-event/1`이다.
   - 담는 내용: 조작, actor 표시값과 표면, Git identity, 본 preview digest, 사유, 이전 이벤트 해시.
   - 이벤트는 주장이며, 신뢰는 리뷰된 병합에서 나온다.
6. **서명 승인 검증은 후속 확장으로 둔다.**

## 결과

- 공개 `/1` Decision·Proposal 스키마, Decision Lock, MCP 9개 tool은 바뀌지 않는다.
- Local Mode 저장소는 아무것도 바뀌지 않는다.
- Team Mode는 GitHub(또는 같은 보호를 주는 호스트)에 의존하고, 병합 전 로컬 branch에서는 위조 Decision이 그 branch의 review·context에 영향을 줄 수 있다.

