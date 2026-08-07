# `@reef/orchestration-controller` 패키지 규칙

이 패키지는 foreground orchestrator가 소유한 한 실행의 private local
state와 recovery 경계만 담당합니다. `@reef/orchestrator`의 provider-neutral
`RunPlan`, phase, result, provider reference/artifact 타입에 단방향으로
의존하며 runtime이나 concrete provider에 persistence를 넣지 않습니다.

- 상태와 claim은 caller가 지정한 private filesystem root 아래의 strict
  version-1 JSON journal에만 저장합니다.
- 모든 상태 쓰기는 secret 검사, canonical serialization, 같은 디렉터리의
  exclusive temporary file, flush, atomic rename, directory sync, read-back
  순서를 지킵니다.
- workspace는 opaque provider reference와 caller가 준 typed cleanup callback으로만
  다룹니다. state에서 local path를 복원하거나 arbitrary path를 삭제하지
  않습니다.
- process identity를 PID 단독으로 판정하지 않습니다. identity가 불명확하면
  live 실행을 회수하지 않고 cleanup을 거부합니다.
- Reef/AKB persistence, CLI, scheduler, resume/retry, provider composition,
  compatibility alias, legacy migration, fallback store를 추가하지 않습니다.
- production source는 raw prompt, log, error/cause, environment, credential,
  process handle, provider payload를 state API에 받거나 저장하지 않습니다.

테스트는 실제 temporary root, atomic read race, concurrent claim, process
identity 분류, cleanup retry, symlink/path ownership, schema mismatch와 secret
canary를 포함해야 합니다.
