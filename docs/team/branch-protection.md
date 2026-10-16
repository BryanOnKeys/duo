# Branch 보호 제안(T83, 적용하지 않음)

`main`과 `next`에는 지금 보호 규칙이 없다. write 권한을 가진 팀원 누구나 두 branch에 직접 push하거나 force push할 수 있고, `v*` tag도 만들 수 있다. 이 문서는 GitHub repository ruleset 세 개를 제안한다. 적용은 maintainer의 별도 승인 뒤에 한다.

## 1. 원칙

- `main`: stable release 기준선. maintainer가 release gate를 통과한 commit으로 fast-forward할 때만 움직인다. PR merge를 받지 않는다.
- `next`: 개발 통합. 모든 변경은 PR로 들어오고, 작성자가 아닌 1명 이상의 승인과 CI `verify` 3 OS 통과가 필요하다.
- `v*` tag: release tag는 maintainer만 만들고 옮기거나 지울 수 없다.
- 기존 release 절차(next → main fast-forward, release 기록 commit, annotated tag push)는 maintainer의 admin bypass로 그대로 동작한다.

## 2. Ruleset 초안

Repository admin 역할(`actor_type: RepositoryRole`, `actor_id: 5`)을 bypass actor로 둔다. 지금 admin은 owner 한 명뿐이다. `actor_id`와 status check 이름은 적용 직전에 API로 다시 확인한다.

**next-integration** (`refs/heads/next`)

```json
{
  "name": "next-integration",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }],
  "conditions": { "ref_name": { "include": ["refs/heads/next"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": true,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash"] } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "verify (ubuntu-latest, node 24)", "integration_id": 15368 },
          { "context": "verify (windows-latest, node 24)", "integration_id": 15368 },
          { "context": "verify (macos-latest, node 24)", "integration_id": 15368 } ] } }
  ]
}
```

**main-stable** (`refs/heads/main`)

```json
{
  "name": "main-stable",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }],
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "update" },
    { "type": "required_linear_history" }
  ]
}
```

`update` 규칙은 bypass actor가 아닌 모든 push와 PR merge를 막는다. 그래서 `main`은 maintainer의 fast-forward로만 움직인다. `main`에 올라가는 commit은 이미 `next`에서 3 OS CI를 통과한 같은 SHA이므로, `main`에 required status check를 따로 걸지 않는다. release 절차가 그 SHA의 CI 성공을 확인한다.

**release-tags** (`refs/tags/v*`)

```json
{
  "name": "release-tags",
  "target": "tag",
  "enforcement": "active",
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }],
  "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
  "rules": [{ "type": "creation" }, { "type": "update" }, { "type": "deletion" }]
}
```

적용 명령(승인 뒤): `gh api -X POST repos/kanghyunsoon/duo/rulesets --input <file>.json`. 처음 1주일은 `"enforcement": "evaluate"`로 두는 방법도 있지만, 이 기능은 GitHub 요금제에 따라 쓸 수 없을 수 있으므로 적용 때 확인한다.

## 3. 기존 release 절차와의 대조

| 절차 | 규칙 적용 뒤 |
|---|---|
| 팀원 PR → `next` squash merge | 작성자 아닌 승인 1 + 3 OS check 통과 뒤 가능 |
| 팀원이 `next`·`main`에 직접 push, force push, branch 삭제 | 막힘 |
| maintainer의 release 기록 commit을 `next`·`main`에 직접 push | admin bypass로 가능. GitHub rule insights에 bypass로 기록된다 |
| `next` → `main` fast-forward(`git push origin <sha>:main`) | admin bypass로 가능. force push는 계속 쓰지 않는다 |
| `main` → `next` fast-forward(T64 방식) | admin bypass로 가능 |
| annotated `v*` tag 생성·push | maintainer만 가능. 이미 만든 tag의 이동·삭제는 막힘(bypass 제외) |
| npm publish, GitHub Release 생성 | ruleset과 무관 |
| GitLab mirror(`ssafy` remote) push | GitHub ruleset과 무관 |

## 4. 운영 규칙과 남은 위험

- maintainer 자신의 기능·문서 PR도 팀원 review를 받는다. bypass는 release 기록, branch 동기화, 긴급 복구에만 쓰고, 쓴 경우 관련 Issue나 PR에 남긴다.
- `strict_required_status_checks_policy: false`: merge 전에 branch를 최신 `next`로 맞추라고 요구하지 않는다. Windows job이 40~60분이라 strict로 두면 merge마다 CI를 다시 기다려야 한다. 대신 두 PR이 따로는 통과했지만 합쳐서 깨지는 경우는 merge 뒤 `next` push CI에서 잡고, 깨지면 바로 고치는 PR을 우선한다.
- #37(Windows project-local install 간헐적 시간 초과)이 남아 있으면 required check 때문에 문서 PR도 막힌다. #37 수정이 merge된 뒤 적용하거나, 적용하더라도 그 테스트 하나만 실패한 경우 재실행한다는 규칙을 함께 둔다.
- code owner review는 처음에는 끈다. 지금 code owner가 maintainer 한 명뿐이라, maintainer가 Decision·release 경로를 고치는 PR은 승인할 사람이 없어 bypass만 남는다. 팀원 계정과 역할이 정해지면 영역별 공동 owner와 함께 켠다.
- 같은 승인에 포함하면 좋은 저장소 설정: merge 방식을 squash만 허용, merge 뒤 branch 자동 삭제(`delete_branch_on_merge`). 둘 다 지금은 꺼져 있거나 모두 허용이다.

